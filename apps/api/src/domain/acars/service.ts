import {
  createAcarsProvider,
  isMockAcarsEnabled,
} from "../../acars/factory.js";
import {
  AcarsProviderError,
  type AcarsProvider,
  type SendResult,
} from "../../acars/types.js";
import {
  findAcarsMessage,
  insertAcarsMessage,
  listAcarsMessages,
  enqueueMockAcars,
  linkAcarsMessageToFlight,
} from "../../db/repositories/acars.js";
import { writeAudit } from "../../db/repositories/audit.js";
import {
  findTenantById,
  listHoppieTenants,
} from "../../db/repositories/tenants.js";
import {
  findFlight,
  listTrackableFlightsForPilot,
} from "../../db/repositories/flights.js";
import { findMembershipByCallsign } from "../../db/repositories/memberships.js";
import { findLatestDispatchRelease } from "../../db/repositories/dispatch-releases.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/postgres.js";
import type { Tenant } from "../../db/schema.js";
import type { AcarsMessage, Flight } from "../../db/schema.js";
import { parseOperationalInteraction } from "./progress.js";
import {
  applyHoppieProgress,
  assignmentNeedsConfirmation,
} from "../flights/service.js";
import { assertOptionalProcessingAllowed } from "../privacy/service.js";

export async function sendTelex(input: {
  tenantId: string;
  membershipId: string;
  to: string;
  body: string;
  flightId?: string | null;
}) {
  const tenant = await requireTenant(input.tenantId);
  await assertOptionalProcessingAllowed({
    tenantId: input.tenantId,
    membershipId: input.membershipId,
    purpose: "acars",
  });
  if (input.flightId) {
    const flight = await findFlight(input.tenantId, input.flightId);
    if (!flight) {
      throw new AppError("NOT_FOUND", "Flight not found");
    }
    if (flight.pilotMembershipId) {
      await assertOptionalProcessingAllowed({
        tenantId: input.tenantId,
        membershipId: flight.pilotMembershipId,
        purpose: "acars",
      });
    }
  }
  const fromStation = tenant.hoppieStation ?? tenant.slug.toUpperCase();
  let provider: AcarsProvider;
  let sendResult: SendResult;
  try {
    provider = createAcarsProvider(tenant);
    sendResult = await provider.sendTelex({
      from: fromStation,
      to: input.to.toUpperCase(),
      body: input.body,
    });
    if (!sendResult.ok) {
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
    fromStation,
    toStation: input.to.toUpperCase(),
    body: input.body,
    hoppieRaw: sendResult.raw,
    provider: provider.name,
    providerMessageId: sendResult.providerMessageId ?? null,
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
  const message = await findAcarsMessage(tenantId, id);
  if (!message) {
    throw new AppError("NOT_FOUND", "ACARS message not found");
  }
  return message;
}

export async function simulateInbound(input: {
  tenantId: string;
  from: string;
  to?: string;
  body: string;
  msgType?: "telex" | "progress" | "cpdlc" | "position" | "other";
}) {
  if (!isMockAcarsEnabled()) {
    throw new AppError(
      "NOT_FOUND",
      "ACARS simulation is only available in local development and automated tests",
    );
  }
  const tenant = await requireTenant(input.tenantId);
  const toStation =
    input.to?.toUpperCase() ??
    tenant.hoppieStation ??
    tenant.slug.toUpperCase();

  await enqueueMockAcars({
    tenantId: input.tenantId,
    toStation,
    fromStation: input.from.toUpperCase(),
    msgType: input.msgType ?? "telex",
    body: input.body,
  });

  // Mock polling is intentionally disabled in the background to preserve
  // scale-to-zero. Drain the queue while this explicit simulation request is
  // active so the next inbox poll can see it, while keeping the queued response
  // contract used by simulator clients.
  await pollTenantAcars(tenant);

  return { queued: true, to: toStation };
}

export async function pollTenantAcars(tenant: Tenant): Promise<number> {
  const station = tenant.hoppieStation ?? tenant.slug.toUpperCase();
  const provider = createAcarsProvider(tenant);
  const inboundMessages = await provider.poll({ station });
  let storedMessageCount = 0;
  for (const message of inboundMessages) {
    try {
      const storedMessage = await insertAcarsMessage({
        tenantId: tenant.id,
        direction: "inbound",
        msgType: message.type,
        fromStation: message.from,
        toStation: message.to,
        body: message.body,
        hoppieRaw: message.raw,
        provider: provider.name,
        providerMessageId: message.providerMessageId,
        receivedAt: message.receivedAt,
      });
      storedMessageCount += 1;
      if (provider.name === "hoppie") {
        try {
          await processOperationalInteraction(tenant, provider, storedMessage);
        } catch (error) {
          // Message ingestion is durable even when optional progress matching
          // or the return telex fails. A later dispatcher can inspect it.
          console.error(
            `ACARS progress processing failed for message ${storedMessage.id}`,
            error,
          );
        }
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Hoppie poll dedupe: another ingestion already stored this message.
    }
  }
  return storedMessageCount;
}

/**
 * Poll ACARS for tenants that actually need network I/O.
 *
 * Only tenants with an encrypted Hoppie logon need network polling. The local
 * test adapter is drained synchronously by its API fixture and never polled.
 */
export async function pollAllTenants(): Promise<{
  tenants: number;
  messages: number;
  skipped: string | null;
}> {
  if (isMockAcarsEnabled()) {
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

  let messageCount = 0;
  for (const tenant of hoppieTenants) {
    try {
      messageCount += await pollTenantAcars(tenant);
    } catch (error) {
      console.error(`ACARS poll failed for tenant ${tenant.slug}`, error);
    }
  }
  return {
    tenants: hoppieTenants.length,
    messages: messageCount,
    skipped: null,
  };
}

export function publicProviderError(error: unknown): AppError {
  if (error instanceof AcarsProviderError) {
    return new AppError(
      error.code === "not_configured" ? "UNPROCESSABLE" : "UPSTREAM",
      error.message,
      {
        details: { provider: "hoppie", reason: error.code },
        cause: error,
      },
    );
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

async function processOperationalInteraction(
  tenant: Tenant,
  provider: AcarsProvider,
  message: AcarsMessage,
): Promise<void> {
  const parsed = parseOperationalInteraction(
    message.body,
    message.receivedAt ?? message.createdAt,
  );
  if (!parsed) return;

  const membership = await findMembershipByCallsign(
    tenant.id,
    message.fromStation.toUpperCase(),
  );
  if (!membership || membership.status !== "active") return;
  try {
    await assertOptionalProcessingAllowed({
      tenantId: tenant.id,
      membershipId: membership.id,
      purpose: "acars",
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return;
    throw error;
  }
  const receivedAt = message.receivedAt ?? message.createdAt;
  const candidates = await listTrackableFlightsForPilot({
    tenantId: tenant.id,
    pilotMembershipId: membership.id,
    from: new Date(receivedAt.getTime() - 12 * 60 * 60 * 1000),
    to: new Date(receivedAt.getTime() + 36 * 60 * 60 * 1000),
  });
  const flight = matchOperationalFlight(
    candidates,
    parsed.kind,
    parsed.flightNumber,
  );
  if (!flight) return;

  await linkAcarsMessageToFlight(tenant.id, message.id, flight.id);
  const shouldSendAssignment =
    parsed.kind === "flt_init" || assignmentNeedsConfirmation(flight);

  const updated = await applyHoppieProgress({
    tenantId: tenant.id,
    flight,
    kind: parsed.kind,
    occurredAt: parsed.occurredAt,
    acarsMessageId: message.id,
  });
  if (shouldSendAssignment) {
    await sendAssignmentSummary(
      tenant,
      provider,
      updated ?? flight,
      message.fromStation,
    );
  }
}

export function matchOperationalFlight(
  candidates: Flight[],
  kind: "flt_init" | "out" | "off" | "on" | "in",
  flightNumber: string | null,
): Flight | null {
  const numberMatches = flightNumber
    ? candidates.filter(
        (flight) => flight.flightNumber.toUpperCase() === flightNumber,
      )
    : candidates;
  if (numberMatches.length === 1) return numberMatches[0]!;
  if (flightNumber || numberMatches.length === 0) return null;

  const expectedStatus =
    kind === "on" || kind === "in"
      ? "active"
      : kind === "flt_init" || kind === "out" || kind === "off"
        ? "briefed"
        : null;
  const statusMatches = expectedStatus
    ? numberMatches.filter((flight) => flight.status === expectedStatus)
    : [];
  return statusMatches.length === 1 ? statusMatches[0]! : null;
}

async function sendAssignmentSummary(
  tenant: Tenant,
  provider: AcarsProvider,
  flight: Flight,
  to: string,
): Promise<void> {
  const release = await findLatestDispatchRelease(tenant.id, flight.id);
  const body = assignmentSummaryBody(flight, release);
  const from = tenant.hoppieStation ?? tenant.slug.toUpperCase();
  const result = await provider.sendTelex({ from, to, body });
  if (!result.ok) return;
  const message = await insertAcarsMessage({
    tenantId: tenant.id,
    direction: "outbound",
    msgType: "telex",
    fromStation: from,
    toStation: to,
    body,
    hoppieRaw: result.raw,
    provider: provider.name,
    providerMessageId: result.providerMessageId ?? null,
    flightId: flight.id,
    sentAt: new Date(),
  });
  await writeAudit({
    tenantId: tenant.id,
    action: "acars.assignment_summary",
    entityType: "acars_message",
    entityId: message.id,
    meta: {
      flightId: flight.id,
      assignmentRevision: flight.assignmentRevision,
    },
  });
}

function assignmentSummaryBody(
  flight: Flight,
  release: Awaited<ReturnType<typeof findLatestDispatchRelease>>,
): string {
  const etd = `${flight.etd.getUTCHours().toString().padStart(2, "0")}${flight.etd
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}Z`;
  const assignment = `ASSIGNMENT R${flight.assignmentRevision} ${flight.flightNumber} ${flight.depIcao}-${flight.arrIcao} ETD ${etd}.`;
  if (!release)
    return `${assignment} RELEASE NOT PUBLISHED - CONTACT DISPATCH.`;
  const releaseSummary = ` RELEASE R${release.revision} FL${release.cruiseLevel} ALT ${release.alternateIcao} BLOCK ${release.blockFuel}${release.fuelUnit.toUpperCase()} ROUTE ${release.operationalRoute}. REVIEW FULL RELEASE IN VA DISPATCH.`;
  return `${assignment}${releaseSummary}`.slice(0, 500);
}
