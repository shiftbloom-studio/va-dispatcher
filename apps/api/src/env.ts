import { z } from "zod";

const DEFAULT_CRON_SECRET = "dev-cron-secret-change-me";

/** Deploy templates render unset optional values as empty strings. */
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /**
   * Deployment environment. Defaults from NODE_ENV; set `preview` on preview
   * Workers so production-only requirements stay relaxed there.
   */
  APP_ENV: z.enum(["development", "preview", "production"]).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Public web origin used for provider callbacks and invitation links. */
  APP_ORIGIN: z.string().url().optional(),
  /** OIDC issuer of the identity provider (stem), for example https://stem.example.com. */
  AUTH_ISSUER: z.string().url().optional(),
  /** Expected `aud` claim of access tokens issued for this API. */
  AUTH_AUDIENCE: z.string().min(1).optional(),
  /** JWKS endpoint; defaults to the issuer's OIDC discovery document. */
  AUTH_JWKS_URL: optionalUrl,
  /**
   * The app's confidential OIDC client. The API uses it with the client
   * credentials grant for stem's directory API (invitations, member sync).
   */
  AUTH_CLIENT_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  AUTH_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Sensitive admin actions need a passkey sign-in at most this many seconds
   * old. 0 turns the check off.
   */
  AUTH_STEP_UP_SECONDS: z.coerce.number().int().min(0).max(86_400).default(600),
  // Internal local/test transport selector. Production always resolves to
  // Hoppie and fails closed until the tenant credential is configured.
  ACARS_PROVIDER: z.enum(["mock", "hoppie"]).default("mock"),
  TENANT_SECRETS_KEY: z.string().optional(),
  /** Application key issued by SimBrief for the Dispatch Redirect API. */
  SIMBRIEF_API_KEY: z.string().min(1).optional(),
  /** Public API callback reached after the SimBrief worker finishes. */
  SIMBRIEF_CALLBACK_URL: z.string().url().optional(),
  /** OAuth client credentials issued by Navigraph for this application. */
  NAVIGRAPH_CLIENT_ID: z.string().min(1).optional(),
  NAVIGRAPH_CLIENT_SECRET: z.string().min(1).optional(),
  /** Exact registered Authorization Code redirect URI. */
  NAVIGRAPH_REDIRECT_URI: z.string().url().optional(),
  AVIATION_WEATHER_API_ORIGIN: z
    .string()
    .url()
    .default("https://aviationweather.gov/api/data"),
  AVIATION_WEATHER_USER_AGENT: z
    .string()
    .min(1)
    .default(
      "va-dispatch/0.1 (+https://github.com/shiftbloom-studio/va-dispatcher)",
    ),
  CRON_SECRET: z.string().min(1).default(DEFAULT_CRON_SECRET),
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  VSAS_AUTH_ORG_ID: z.string().optional(),
  /** When true, skip token verification and use X-Dev-* headers (local/dev only). */
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Dedicated integrated-E2E process mode. Never enabled in production. */
  E2E_FIXTURE_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  E2E_FIXTURE_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const validationMessage = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${validationMessage}`);
  }
  validateRuntimeEnvironment(parsed.data);
  cachedEnv = parsed.data;
  return parsed.data;
}

function validateRuntimeEnvironment(config: Env): void {
  validateConfiguredAppOrigin(config.APP_ORIGIN);

  const productionRuntime =
    config.APP_ENV === "production" ||
    (config.APP_ENV !== "preview" && config.NODE_ENV === "production");
  const productionDeployment =
    productionRuntime && config.APP_ENV !== "preview";

  if (config.E2E_FIXTURE_MODE) {
    if (productionRuntime) {
      throw new Error(
        "Invalid production environment: E2E fixture mode is forbidden",
      );
    }
    const missing = [["E2E_FIXTURE_SECRET", config.E2E_FIXTURE_SECRET]].flatMap(
      ([name, value]) => (value ? [] : [name]),
    );
    if (missing.length) {
      throw new Error(
        `Invalid E2E fixture environment: missing ${missing.join(", ")}`,
      );
    }
    if (!config.AUTH_DEV_BYPASS) {
      throw new Error(
        "Invalid E2E fixture environment: AUTH_DEV_BYPASS must be enabled",
      );
    }
  }

  if (!productionRuntime) return;

  const missing = [
    ...(productionDeployment
      ? ([["APP_ORIGIN", config.APP_ORIGIN]] as const)
      : []),
    ["AUTH_ISSUER", config.AUTH_ISSUER],
    ["AUTH_AUDIENCE", config.AUTH_AUDIENCE],
    ["AUTH_CLIENT_ID", config.AUTH_CLIENT_ID],
    ["TENANT_SECRETS_KEY", config.TENANT_SECRETS_KEY],
  ].flatMap(([name, value]) => (value ? [] : [name]));
  if (missing.length) {
    throw new Error(
      `Invalid production environment: missing ${missing.join(", ")}`,
    );
  }
  if (
    productionDeployment &&
    new URL(config.APP_ORIGIN!).protocol !== "https:"
  ) {
    throw new Error(
      "Invalid production environment: APP_ORIGIN must use HTTPS",
    );
  }
  if (config.CRON_SECRET === DEFAULT_CRON_SECRET) {
    throw new Error(
      "Invalid production environment: CRON_SECRET must not use the development default",
    );
  }
  if (config.AUTH_DEV_BYPASS) {
    throw new Error(
      "Invalid production environment: AUTH_DEV_BYPASS is forbidden",
    );
  }
}

function validateConfiguredAppOrigin(value: string | undefined): void {
  if (!value) return;
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    value !== url.origin
  ) {
    throw new Error(
      "Invalid environment: APP_ORIGIN must be a canonical HTTP(S) origin without credentials, path, query, or fragment",
    );
  }
}

/** The one canonical public origin used in provider redirects. */
export function resolveAppOrigin(config: Env = env()): string | null {
  return config.APP_ORIGIN ? new URL(config.APP_ORIGIN).origin : null;
}

export function env(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
