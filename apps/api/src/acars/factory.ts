import { env } from "../env.js";
import { decryptSecret } from "../lib/crypto.js";
import type { Tenant } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { HoppieAcarsProvider } from "./hoppie-provider.js";
import { MockAcarsProvider } from "./mock-provider.js";
import type { AcarsProvider } from "./types.js";

export function createAcarsProvider(tenant: Tenant): AcarsProvider {
  const provider = env().ACARS_PROVIDER;
  const station = tenant.hoppieStation ?? tenant.slug.toUpperCase();

  if (provider === "mock") {
    return new MockAcarsProvider({
      tenantId: tenant.id,
      groundStation: station,
      echoReplies: true,
    });
  }

  if (!tenant.hoppieLogonEnc) {
    throw new AppError(
      "UNPROCESSABLE",
      "Hoppie logon is not configured for this tenant",
    );
  }

  const logon = decryptSecret(tenant.hoppieLogonEnc, env().TENANT_SECRETS_KEY);
  return new HoppieAcarsProvider({ logon });
}
