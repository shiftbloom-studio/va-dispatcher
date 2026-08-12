import { env } from "../env.js";
import { decryptSecret } from "../lib/crypto.js";
import type { Tenant } from "../db/schema.js";
import { HoppieAcarsProvider } from "./hoppie-provider.js";
import { MockAcarsProvider } from "./mock-provider.js";
import type { AcarsProvider, AcarsProviderName } from "./types.js";

export function tenantAcarsProviderName(tenant: Tenant): AcarsProviderName {
  return tenant.hoppieLogonEnc ? "hoppie" : "mock";
}

export function createAcarsProvider(tenant: Tenant): AcarsProvider {
  const station = tenant.hoppieStation ?? tenant.slug.toUpperCase();

  if (!tenant.hoppieLogonEnc) {
    return new MockAcarsProvider({
      tenantId: tenant.id,
      groundStation: station,
      echoReplies: true,
    });
  }

  const logon = decryptSecret(tenant.hoppieLogonEnc, env().TENANT_SECRETS_KEY);
  return new HoppieAcarsProvider({ logon });
}
