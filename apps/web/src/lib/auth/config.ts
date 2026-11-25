import "server-only";

/** OIDC settings for the identity provider (stem), read per request. */
export type AuthConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** API resource (RFC 8707); access tokens are JWTs for this audience. */
  resource: string;
  sessionSecret: string;
};

export class AuthNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Sign-in is not configured: set ${missing.join(", ")}`);
    this.name = "AuthNotConfiguredError";
  }
}

export function authConfig(): AuthConfig {
  const values = {
    AUTH_ISSUER: process.env.AUTH_ISSUER?.trim(),
    AUTH_CLIENT_ID: process.env.AUTH_CLIENT_ID?.trim(),
    AUTH_CLIENT_SECRET: process.env.AUTH_CLIENT_SECRET?.trim(),
    AUTH_AUDIENCE: process.env.AUTH_AUDIENCE?.trim(),
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET?.trim(),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new AuthNotConfiguredError(missing);
  if ((values.AUTH_SESSION_SECRET ?? "").length < 32) {
    throw new AuthNotConfiguredError(["AUTH_SESSION_SECRET (32+ characters)"]);
  }
  return {
    issuer: values.AUTH_ISSUER!.replace(/\/+$/, ""),
    clientId: values.AUTH_CLIENT_ID!,
    clientSecret: values.AUTH_CLIENT_SECRET!,
    resource: values.AUTH_AUDIENCE!,
    sessionSecret: values.AUTH_SESSION_SECRET!,
  };
}
