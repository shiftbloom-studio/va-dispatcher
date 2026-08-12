import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  ACARS_PROVIDER: z.enum(["mock", "hoppie"]).default("mock"),
  TENANT_SECRETS_KEY: z.string().optional(),
  CRON_SECRET: z.string().min(1).default("dev-cron-secret-change-me"),
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  VSAS_CLERK_ORG_ID: z.string().optional(),
  /** When true, skip Clerk and use X-Dev-* headers (local/dev only). */
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function env(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
