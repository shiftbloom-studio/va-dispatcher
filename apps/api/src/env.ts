import { z } from "zod";

const DEFAULT_CRON_SECRET = "dev-cron-secret-change-me";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Public web origin used for provider callback completion redirects. */
  APP_ORIGIN: z.string().url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
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
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
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
  VSAS_CLERK_ORG_ID: z.string().optional(),
  /** When true, skip Clerk and use X-Dev-* headers (local/dev only). */
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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
  validateProductionEnvironment(parsed.data);
  cachedEnv = parsed.data;
  return parsed.data;
}

function validateProductionEnvironment(config: Env): void {
  if (config.NODE_ENV !== "production") return;

  const missing = [
    ["DATABASE_URL", config.DATABASE_URL],
    ["CLERK_SECRET_KEY", config.CLERK_SECRET_KEY],
    ["TENANT_SECRETS_KEY", config.TENANT_SECRETS_KEY],
  ].flatMap(([name, value]) => (value ? [] : [name]));

  if (missing.length) {
    throw new Error(
      `Invalid production environment: missing ${missing.join(", ")}`,
    );
  }
  if (config.CRON_SECRET === DEFAULT_CRON_SECRET) {
    throw new Error(
      "Invalid production environment: CRON_SECRET must not use the development default",
    );
  }
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
