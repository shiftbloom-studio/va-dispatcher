import { env } from "../env.js";
import { decryptSecret } from "../lib/crypto.js";
import type { Tenant } from "../db/schema.js";
import { HoppieAcarsProvider } from "./hoppie-provider.js";
import { MockAcarsProvider } from "./mock-provider.js";
import {
  AcarsProviderError,
  type AcarsProvider,
  type AcarsProviderName,
} from "./types.js";

/**
 * The mock transport is an internal local/test fixture. Production always
 * resolves to Hoppie, even if a stale deployment variable still says mock.
 */
export function isMockAcarsEnabled(): boolean {
  const current = env();
  const isProduction = current.VERCEL_ENV
    ? current.VERCEL_ENV === "production"
    : current.NODE_ENV === "production";
  return !isProduction && current.ACARS_PROVIDER === "mock";
}

export function activeAcarsProviderName(): AcarsProviderName {
  return isMockAcarsEnabled() ? "mock" : "hoppie";
}

export function createAcarsProvider(tenant: Tenant): AcarsProvider {
  const station = tenant.hoppieStation ?? tenant.slug.toUpperCase();

  if (isMockAcarsEnabled()) {
    return new MockAcarsProvider({
      tenantId: tenant.id,
      groundStation: station,
      echoReplies: true,
    });
  }

  if (!tenant.hoppieLogonEnc) {
    throw new AcarsProviderError(
      "not_configured",
      "Hoppie ACARS is not configured for this Virtual Airline.",
    );
  }

  const logon = decryptSecret(tenant.hoppieLogonEnc, env().TENANT_SECRETS_KEY);
  return new HoppieAcarsProvider({ logon });
}
