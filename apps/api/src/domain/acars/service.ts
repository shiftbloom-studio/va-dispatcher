import {
  createAcarsProvider,
  tenantAcarsProviderName,
} from "../../acars/factory.js";
import { AcarsProviderError } from "../../acars/types.js";
import {
  findAcarsMessage,
  insertAcarsMessage,
  listAcarsMessages,
  enqueueMockAcars,
} from "../../db/repositories/acars.js";
import { writeAudit } from "../../db/repositories/audit.js";
import {
  findTenantById,
  listHoppieTenants,
} from "../../db/repositories/tenants.js";
import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/postgres.js";
import type { Tenant } from "../../db/schema.js";

export async function sendTelex(input: {
  tenantId: string;
  membershipId: string;
  to: string;
  body: string;
  flightId?: string | null;
}) {
  const tenant = await requireTenant(input.tenantId);
  const from = tenant.hoppieStation ?? tenant.slug.toUpperCase();
  const provider = createAcarsProvider(tenant);
  let result;
  try {
    result = await provider.sendTelex({
      from,
      to: input.to.toUpperCase(),
      body: input.body,
    });
    if (!result.ok) {
      throw new AcarsProviderError(
        "rejected",
        "The ACARS provider rejected the message.",
      );
    }
  } catch (error) {
    throw publicProviderError(error);
  }

  const message = await insertAcarsMessage({
    tenantId: input.tenantId,
    direction: "outbound",
    msgType: "telex",
    fromStation: from,
    toStation: input.to.toUpperCase(),
    body: input.body,
    hoppieRaw: result.raw,
    provider: provider.name,
    providerMessageId: result.providerMessageId ?? null,
    flightId: input.flightId ?? null,
    createdByMembershipId: input.membershipId,
    sentAt: new Date(),
  });

  await writeAudit({
    tenantId: input.tenantId,
    actorMembershipId: input.membershipId,
    action: "acars.send_telex",
    entityType: "acars_message",
    entityId: message.id,
    meta: { to: input.to, provider: provider.name },
  });

  return message;
}

export async function listMessages(input: {
  tenantId: string;
  direction?: "inbound" | "outbound";
  flightId?: string;
  station?: string;
  cursor?: string;
  limit: number;
}) {
  return listAcarsMessages(input);
}

export async function getMessage(tenantId: string, id: string) {
  const msg = await findAcarsMessage(tenantId, id);
  if (!msg) {
    throw new AppError("NOT_FOUND", "ACARS message not found");
  }
  return msg;
}

export async function simulateInbound(input: {
  tenantId: string;
  from: string;
  to?: string;
  body: string;
  msgType?: "telex" | "progress" | "cpdlc" | "position" | "other";
}) {
  const tenant = await requireTenant(input.tenantId);
  if (tenantAcarsProviderName(tenant) !== "mock") {
    throw new AppError(
      "UNPROCESSABLE",
      "ACARS simulate is only available while this Virtual Airline uses the mock provider",
    );
  }
  const to =
    input.to?.toUpperCase() ??
    tenant.hoppieStation ??
    tenant.slug.toUpperCase();

  await enqueueMockAcars({
    tenantId: input.tenantId,
    toStation: to,
    fromStation: input.from.toUpperCase(),
    msgType: input.msgType ?? "telex",
    body: input.body,
  });

  // Mock polling is intentionally disabled in the background to preserve
  // scale-to-zero. Drain the queue while this explicit simulation request is
  // active so the next inbox poll can see it, while keeping the queued response
  // contract used by simulator clients.
  await pollTenantAcars(tenant);

  return { queued: true, to };
}

export async function pollTenantAcars(tenant: Tenant): Promise<number> {
  const station = tenant.hoppieStation ?? tenant.slug.toUpperCase();
  const provider = createAcarsProvider(tenant);
  const inbound = await provider.poll({ station });
  let stored = 0;
  for (const msg of inbound) {
    try {
      await insertAcarsMessage({
        tenantId: tenant.id,
        direction: "inbound",
        msgType: msg.type,
        fromStation: msg.from,
        toStation: msg.to,
        body: msg.body,
        hoppieRaw: msg.raw,
        provider: provider.name,
        providerMessageId: msg.providerMessageId,
        receivedAt: msg.receivedAt,
      });
      stored += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Hoppie poll dedupe: another ingestion already stored this message.
    }
  }
  return stored;
}

/**
 * Poll ACARS for tenants that actually need network I/O.
 *
 * Only tenants with an encrypted Hoppie logon need network polling. Mock
 * tenants are drained synchronously by the simulator and never polled here.
 */
export async function pollAllTenants(): Promise<{
  tenants: number;
  messages: number;
  skipped: string | null;
}> {
  if (env().ACARS_PROVIDER === "mock") {
    return {
      tenants: 0,
      messages: 0,
      skipped: "deployment-level Hoppie polling is disabled",
    };
  }

  const hoppieTenants = await listHoppieTenants();
  if (hoppieTenants.length === 0) {
    return {
      tenants: 0,
      messages: 0,
      skipped: "no tenants with Hoppie logon configured",
    };
  }

  let messages = 0;
  for (const tenant of hoppieTenants) {
    try {
      messages += await pollTenantAcars(tenant);
    } catch (err) {
      console.error(`ACARS poll failed for tenant ${tenant.slug}`, err);
    }
  }
  return { tenants: hoppieTenants.length, messages, skipped: null };
}

export function publicProviderError(error: unknown): AppError {
  if (error instanceof AcarsProviderError) {
    return new AppError("UPSTREAM", error.message, {
      details: { provider: "hoppie", reason: error.code },
      cause: error,
    });
  }
  throw error;
}

async function requireTenant(tenantId: string): Promise<Tenant> {
  const tenant = await findTenantById(tenantId);
  if (!tenant) {
    throw new AppError("NOT_FOUND", "Tenant not found");
  }
  return tenant;
}
