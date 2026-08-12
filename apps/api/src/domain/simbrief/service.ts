import { randomBytes, randomUUID } from "node:crypto";
import { writeAudit } from "../../db/repositories/audit.js";
import { findFlight } from "../../db/repositories/flights.js";
import {
  findMembershipById,
  markSimbriefVerified,
  updateMembership,
} from "../../db/repositories/memberships.js";
import * as simbriefRepo from "../../db/repositories/simbrief.js";
import type {
  Flight,
  MemberRole,
  Membership,
  SimbriefDispatch,
} from "../../db/schema.js";
import { env } from "../../env.js";
import { createTokenMac, verifyTokenMac } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/postgres.js";
import {
  buildSimbriefDispatchUrl,
  SimbriefAdapter,
  SimbriefAdapterError,
} from "../../simbrief/adapter.js";
import { SimbriefLegacySigner } from "../../simbrief/legacy-signer.js";
import { roleAtLeast } from "../members/roles.js";
import type { SimbriefDispatchOptions } from "./validation.js";

const CALLBACK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_DISPATCH_URL_LENGTH = 8_192;

export type SimbriefActor = {
  tenantId: string;
  membershipId: string;
  role: MemberRole;
};

export async function getConnection(actor: SimbriefActor): Promise<Membership> {
  return requireMembership(actor.tenantId, actor.membershipId);
}

export async function connectAccount(
  actor: SimbriefActor,
  simbriefUserId: string,
): Promise<Membership> {
  const current = await requireMembership(actor.tenantId, actor.membershipId);
  let updated: Membership | null;
  try {
    updated = await updateMembership(actor.tenantId, actor.membershipId, {
      simbriefUserId,
      simbriefVerifiedAt:
        current.simbriefUserId === simbriefUserId
          ? current.simbriefVerifiedAt
          : null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "This SimBrief Pilot ID is already connected to another member in this Virtual Airline",
      );
    }
    throw error;
  }
  if (!updated) throw new AppError("NOT_FOUND", "Membership not found");

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "simbrief.account_connect",
    entityType: "membership",
    entityId: actor.membershipId,
    meta: {
      simbriefUserId,
      verificationRetained: Boolean(updated.simbriefVerifiedAt),
    },
  });
  return updated;
}

export async function disconnectAccount(
  actor: SimbriefActor,
): Promise<Membership> {
  const updated = await updateMembership(actor.tenantId, actor.membershipId, {
    simbriefUserId: null,
    simbriefVerifiedAt: null,
    navigraphSubject: null,
    navigraphUsername: null,
    navigraphConnectedAt: null,
  });
  if (!updated) throw new AppError("NOT_FOUND", "Membership not found");

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "simbrief.account_disconnect",
    entityType: "membership",
    entityId: actor.membershipId,
  });
  return updated;
}

export async function createDispatch(
  actor: SimbriefActor,
  flightId: string,
  options: SimbriefDispatchOptions,
): Promise<{ dispatch: SimbriefDispatch; dispatchUrl: string }> {
  const [flight, membership] = await Promise.all([
    requireAccessibleFlight(actor, flightId),
    requireMembership(actor.tenantId, actor.membershipId),
  ]);
  assertDispatchableFlight(flight);
  if (!membership.simbriefUserId) {
    throw new AppError(
      "UNPROCESSABLE",
      "Connect your numeric SimBrief Pilot ID before creating a flight plan",
    );
  }

  const config = requireSimbriefConfig();
  const id = randomUUID();
  const staticId = `VAD_${id.replaceAll("-", "")}`;
  const callbackToken = randomBytes(32).toString("base64url");
  const outputPage = callbackUrl(config.callbackUrl, id, callbackToken);
  const parameters = dispatchParameters(
    flight,
    membership.simbriefUserId,
    staticId,
    options,
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const dispatchUrl = buildSimbriefDispatchUrl({
    signer: config.signer,
    outputPage,
    timestamp,
    parameters,
  });
  if (dispatchUrl.length > MAX_DISPATCH_URL_LENGTH) {
    throw new AppError(
      "UNPROCESSABLE",
      "The SimBrief dispatch request is too large. Shorten the route or remarks.",
    );
  }

  const dispatch = await simbriefRepo.createSimbriefDispatch({
    id,
    tenantId: actor.tenantId,
    flightId: flight.id,
    createdByMembershipId: actor.membershipId,
    simbriefUserId: membership.simbriefUserId,
    staticId,
    callbackTokenMac: createTokenMac(
      callbackToken,
      config.secretsKey,
      "simbrief-dispatch-callback",
    ),
    request: parameters,
  });
  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "simbrief.dispatch_create",
    entityType: "simbrief_dispatch",
    entityId: dispatch.id,
    meta: {
      flightId: flight.id,
      staticId,
      generatedForOwnFlight: flight.pilotMembershipId === actor.membershipId,
    },
  });
  return { dispatch, dispatchUrl };
}

export async function getLatestDispatch(
  actor: SimbriefActor,
  flightId: string,
): Promise<SimbriefDispatch> {
  await requireAccessibleFlight(actor, flightId);
  const dispatch = await simbriefRepo.findLatestSimbriefDispatch(
    actor.tenantId,
    flightId,
  );
  if (!dispatch) {
    throw new AppError(
      "NOT_FOUND",
      "No SimBrief dispatch exists for this flight",
    );
  }
  return dispatch;
}

export async function getDispatch(
  actor: SimbriefActor,
  flightId: string,
  dispatchId: string,
): Promise<SimbriefDispatch> {
  await requireAccessibleFlight(actor, flightId);
  const dispatch = await simbriefRepo.findSimbriefDispatch(
    actor.tenantId,
    flightId,
    dispatchId,
  );
  if (!dispatch) {
    throw new AppError("NOT_FOUND", "SimBrief dispatch not found");
  }
  return dispatch;
}

export async function syncDispatch(
  actor: SimbriefActor,
  flightId: string,
  dispatchId: string,
): Promise<SimbriefDispatch> {
  const dispatch = await getDispatch(actor, flightId, dispatchId);
  return syncStoredDispatch(dispatch);
}

export async function completeDispatchCallback(
  dispatchId: string,
  callbackToken: string,
): Promise<SimbriefDispatch> {
  const secretsKey = requireSecretsKey();
  const dispatch =
    await simbriefRepo.findSimbriefDispatchForCallback(dispatchId);
  if (
    !dispatch?.callbackTokenMac ||
    Date.now() - dispatch.createdAt.getTime() > CALLBACK_MAX_AGE_MS ||
    !verifyTokenMac(
      callbackToken,
      dispatch.callbackTokenMac,
      secretsKey,
      "simbrief-dispatch-callback",
    )
  ) {
    throw new AppError("UNAUTHORIZED", "Invalid or expired SimBrief callback");
  }
  return syncStoredDispatch(dispatch);
}

async function syncStoredDispatch(
  dispatch: SimbriefDispatch,
): Promise<SimbriefDispatch> {
  if (dispatch.status === "ready" && dispatch.ofp) return dispatch;

  const adapter = new SimbriefAdapter();
  let result: Awaited<ReturnType<SimbriefAdapter["fetchFlightPlan"]>>;
  try {
    result = await adapter.fetchFlightPlan({
      userId: dispatch.simbriefUserId,
      staticId: dispatch.staticId,
      origin: dispatch.request.orig ?? "",
      destination: dispatch.request.dest ?? "",
    });
  } catch (error) {
    const publicError = publicSimbriefError(error);
    await simbriefRepo.recordSimbriefSyncError(
      dispatch.id,
      publicError.message,
    );
    throw publicError;
  }

  const syncedAt = new Date();
  const completed = await simbriefRepo.completeSimbriefDispatch({
    id: dispatch.id,
    ofp: result.ofp,
    simbriefRequestId: result.requestId,
    generatedAt: result.generatedAt,
    syncedAt,
  });
  if (!completed) {
    const current = await simbriefRepo.findSimbriefDispatchForCallback(
      dispatch.id,
    );
    if (current?.status === "ready" && current.ofp) return current;
    throw new AppError("NOT_FOUND", "SimBrief dispatch not found");
  }

  if (dispatch.createdByMembershipId) {
    await markSimbriefVerified({
      tenantId: dispatch.tenantId,
      membershipId: dispatch.createdByMembershipId,
      simbriefUserId: dispatch.simbriefUserId,
      verifiedAt: syncedAt,
    });
  }
  await writeAudit({
    tenantId: dispatch.tenantId,
    actorMembershipId: dispatch.createdByMembershipId,
    action: "simbrief.dispatch_ready",
    entityType: "simbrief_dispatch",
    entityId: dispatch.id,
    meta: {
      flightId: dispatch.flightId,
      simbriefRequestId: result.requestId,
    },
  });
  return completed;
}

function dispatchParameters(
  flight: Flight,
  simbriefUserId: string,
  staticId: string,
  options: SimbriefDispatchOptions,
): Record<string, string> {
  const aircraftType = options.aircraftType ?? flight.aircraftType;
  if (!aircraftType) {
    throw new AppError(
      "UNPROCESSABLE",
      "An aircraft type is required to create a SimBrief flight plan",
    );
  }
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(aircraftType)) {
    throw new AppError(
      "UNPROCESSABLE",
      "Use an ICAO aircraft type or SimBrief airframe Internal ID",
    );
  }
  const normalizedAircraftType = /^[A-Za-z0-9]{2,4}$/.test(aircraftType)
    ? aircraftType.toUpperCase()
    : aircraftType;
  if (flight.eta.getTime() <= flight.etd.getTime()) {
    throw new AppError(
      "UNPROCESSABLE",
      "The flight ETA must be after its ETD before dispatching to SimBrief",
    );
  }

  const durationMinutes = Math.round(
    (flight.eta.getTime() - flight.etd.getTime()) / 60_000,
  );
  const parameters: Record<string, string> = {
    orig: flight.depIcao.toUpperCase(),
    dest: flight.arrIcao.toUpperCase(),
    type: normalizedAircraftType,
    fltnum: options.flightNumber ?? flight.flightNumber,
    date: simbriefDate(flight.etd),
    deph: twoDigits(flight.etd.getUTCHours()),
    depm: twoDigits(flight.etd.getUTCMinutes()),
    steh: String(Math.floor(durationMinutes / 60)),
    stem: twoDigits(durationMinutes % 60),
    userid: simbriefUserId,
    pid: simbriefUserId,
    static_id: staticId,
    units: options.units,
  };

  setOptional(parameters, "airline", options.airline);
  setOptional(parameters, "callsign", options.callsign);
  setOptional(parameters, "route", options.route);
  setOptional(parameters, "altn", options.alternate);
  setOptional(parameters, "fl", options.flightLevel);
  setOptional(parameters, "reg", options.registration);
  setOptional(parameters, "pax", options.passengers);
  setOptional(parameters, "cargo", options.cargo);
  setOptional(parameters, "cpt", options.captainName);
  setOptional(parameters, "dxname", options.dispatcherName);
  setOptional(parameters, "manualrmk", options.customRemarks);
  setOptional(parameters, "planformat", options.planFormat);
  setOptional(parameters, "taxiout", options.taxiOutMinutes);
  setOptional(parameters, "taxiin", options.taxiInMinutes);
  setOptional(parameters, "resvrule", options.reserveMinutes);
  if (options.costIndex !== undefined) {
    parameters.cruise = "CI";
    parameters.civalue = String(options.costIndex);
  }

  setBoolean(parameters, "navlog", options.navlog);
  setBoolean(parameters, "etops", options.etops);
  setBoolean(parameters, "stepclimbs", options.stepClimbs);
  setBoolean(parameters, "tlr", options.runwayAnalysis);
  setBoolean(parameters, "notams", options.notams);
  setBoolean(parameters, "firnot", options.firNotams);
  setBoolean(parameters, "omit_sids", options.omitSids);
  setBoolean(parameters, "omit_stars", options.omitStars);
  setOptional(parameters, "maps", options.maps);
  setOptional(parameters, "find_sidstar", options.sidStarPreference);
  return parameters;
}

function requireSimbriefConfig(): {
  signer: SimbriefLegacySigner;
  callbackUrl: string;
  secretsKey: string;
} {
  const config = env();
  if (
    !config.SIMBRIEF_API_KEY ||
    !config.SIMBRIEF_CALLBACK_URL ||
    !config.TENANT_SECRETS_KEY
  ) {
    throw new AppError("INTERNAL", "SimBrief dispatch is not configured", {
      status: 503,
    });
  }
  const callback = new URL(config.SIMBRIEF_CALLBACK_URL);
  if (config.NODE_ENV === "production" && callback.protocol !== "https:") {
    throw new AppError(
      "INTERNAL",
      "SIMBRIEF_CALLBACK_URL must use HTTPS in production",
      { status: 503 },
    );
  }
  return {
    signer: new SimbriefLegacySigner(config.SIMBRIEF_API_KEY),
    callbackUrl: callback.toString(),
    secretsKey: config.TENANT_SECRETS_KEY,
  };
}

function callbackUrl(
  configuredUrl: string,
  dispatchId: string,
  token: string,
): string {
  const url = new URL(configuredUrl);
  url.searchParams.set("dispatchId", dispatchId);
  url.searchParams.set("token", token);
  return url.toString();
}

function requireSecretsKey(): string {
  const secretsKey = env().TENANT_SECRETS_KEY;
  if (!secretsKey) {
    throw new AppError("INTERNAL", "SimBrief dispatch is not configured", {
      status: 503,
    });
  }
  return secretsKey;
}

function publicSimbriefError(error: unknown): AppError {
  if (!(error instanceof SimbriefAdapterError)) throw error;
  const status =
    error.reason === "not_ready"
      ? 409
      : error.reason === "rate_limited"
        ? 429
        : error.reason === "timeout"
          ? 504
          : 502;
  return new AppError(
    error.reason === "not_ready" ? "CONFLICT" : "UPSTREAM",
    error.message,
    {
      status,
      details: { provider: "simbrief", reason: error.reason },
      cause: error,
    },
  );
}

async function requireMembership(
  tenantId: string,
  membershipId: string,
): Promise<Membership> {
  const membership = await findMembershipById(tenantId, membershipId);
  if (!membership) throw new AppError("NOT_FOUND", "Membership not found");
  return membership;
}

async function requireAccessibleFlight(
  actor: SimbriefActor,
  flightId: string,
): Promise<Flight> {
  const flight = await findFlight(actor.tenantId, flightId);
  if (!flight) throw new AppError("NOT_FOUND", "Flight not found");
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    flight.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("FORBIDDEN", "Not your flight");
  }
  return flight;
}

function assertDispatchableFlight(flight: Flight): void {
  if (
    ["declined", "active", "completed", "cancelled"].includes(flight.status)
  ) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot create a SimBrief flight plan for a ${flight.status} flight`,
    );
  }
}

function setOptional(
  target: Record<string, string>,
  key: string,
  value: string | number | undefined,
): void {
  if (value !== undefined) target[key] = String(value);
}

function setBoolean(
  target: Record<string, string>,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) target[key] = value ? "1" : "0";
}

function simbriefDate(date: Date): string {
  const month = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ][date.getUTCMonth()];
  return `${twoDigits(date.getUTCDate())}${month}${String(date.getUTCFullYear()).slice(-2)}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
