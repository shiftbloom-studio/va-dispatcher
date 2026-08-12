import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
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
  CRON_SECRET: z.string().min(1).default("dev-cron-secret-change-me"),
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
  cachedEnv = parsed.data;
  return parsed.data;
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
