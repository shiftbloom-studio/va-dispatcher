import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "../client.js";
import { guard, insertAudit, ms, runAtomic } from "../atomic.js";
import {
  flights,
  memberships,
  scheduleRequests,
  type Flight,
  type MemberRole,
  type Membership,
  type ScheduleRequest,
} from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

const OPEN_FLIGHT_STATUSES = [
  "draft",
  "offered",
  "accepted",
  "briefed",
] as const;
const OPEN_REQUEST_STATUSES = [
  "pending",
  "in_review",
  "partially_fulfilled",
] as const;

export type MemberWorkImpact = {
  openFlightCount: number;
  activeFlightCount: number;
  openScheduleRequestCount: number;
  terminalRequestLinkedFlightCount: number;
};

export type MembershipListItem = Membership & MemberWorkImpact;

export async function findMembership(
  tenantId: string,
  authUserId: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.authUserId, authUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMembershipById(
  tenantId: string,
  id: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findMembershipByCallsign(
  tenantId: string,
  pilotCallsign: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.pilotCallsign, pilotCallsign),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(input: {
  tenantId: string;
  search?: string;
  role?: MemberRole;
  status?: Membership["status"];
  cursor?: string;
  limit: number;
}): Promise<PageResult<MembershipListItem>> {
  const db = getDb();
  // Drizzle emits interpolated columns in raw correlated subqueries without
  // table qualification unless the tables have explicit aliases. Every table
  // in this query is therefore named, including the outer membership table,
  // so SQLite can distinguish the joined `id` and `tenant_id` columns.
  // SQLite LIKE is case-insensitive for ASCII, matching the former ILIKE.
  const memberList = alias(memberships, "member_list");
  const openFlights = alias(flights, "member_open_flights");
  const activeFlights = alias(flights, "member_active_flights");
  const openRequests = alias(scheduleRequests, "member_open_requests");
  const linkedFlights = alias(flights, "member_linked_flights");
  const linkedRequests = alias(scheduleRequests, "member_linked_requests");
  const conditions = [eq(memberList.tenantId, input.tenantId)];

  if (input.search) {
    const pattern = `%${input.search}%`;
    conditions.push(
      or(
        like(memberList.displayName, pattern),
        like(memberList.pilotCallsign, pattern),
        like(memberList.authUserId, pattern),
      )!,
    );
  }
  if (input.role) conditions.push(eq(memberList.role, input.role));
  if (input.status) conditions.push(eq(memberList.status, input.status));
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    conditions.push(
      or(
        lt(memberList.createdAt, new Date(cursor.sortAt)),
        and(
          eq(memberList.createdAt, new Date(cursor.sortAt)),
          lt(memberList.id, cursor.id),
        ),
      )!,
    );
  }

  const openFlightCount = db
    .select({ value: sql<number>`count(*)` })
    .from(openFlights)
    .where(
      and(
        eq(openFlights.tenantId, memberList.tenantId),
        eq(openFlights.pilotMembershipId, memberList.id),
        inArray(openFlights.status, [...OPEN_FLIGHT_STATUSES]),
      ),
    );
  const activeFlightCount = db
    .select({ value: sql<number>`count(*)` })
    .from(activeFlights)
    .where(
      and(
        eq(activeFlights.tenantId, memberList.tenantId),
        eq(activeFlights.pilotMembershipId, memberList.id),
        eq(activeFlights.status, "active"),
      ),
    );
  const openScheduleRequestCount = db
    .select({ value: sql<number>`count(*)` })
    .from(openRequests)
    .where(
      and(
        eq(openRequests.tenantId, memberList.tenantId),
        eq(openRequests.pilotMembershipId, memberList.id),
        inArray(openRequests.status, [...OPEN_REQUEST_STATUSES]),
      ),
    );
  const terminalRequestLinkedFlightCount = db
    .select({ value: sql<number>`count(*)` })
    .from(linkedFlights)
    .innerJoin(
      linkedRequests,
      and(
        eq(linkedRequests.id, linkedFlights.scheduleRequestId),
        eq(linkedRequests.tenantId, linkedFlights.tenantId),
      ),
    )
    .where(
      and(
        eq(linkedFlights.tenantId, memberList.tenantId),
        eq(linkedFlights.pilotMembershipId, memberList.id),
        inArray(linkedFlights.status, [...OPEN_FLIGHT_STATUSES]),
        inArray(linkedRequests.status, ["fulfilled", "rejected", "cancelled"]),
      ),
    );

  const rows = await db
    .select({
      id: memberList.id,
      tenantId: memberList.tenantId,
      authUserId: memberList.authUserId,
      role: memberList.role,
      displayName: memberList.displayName,
      pilotCallsign: memberList.pilotCallsign,
      simbriefUserId: memberList.simbriefUserId,
      simbriefVerifiedAt: memberList.simbriefVerifiedAt,
      navigraphSubject: memberList.navigraphSubject,
      navigraphUsername: memberList.navigraphUsername,
      navigraphConnectedAt: memberList.navigraphConnectedAt,
      status: memberList.status,
      createdAt: memberList.createdAt,
      updatedAt: memberList.updatedAt,
      openFlightCount: sql<number>`(${openFlightCount})`,
      activeFlightCount: sql<number>`(${activeFlightCount})`,
      openScheduleRequestCount: sql<number>`(${openScheduleRequestCount})`,
      terminalRequestLinkedFlightCount: sql<number>`(${terminalRequestLinkedFlightCount})`,
    })
    .from(memberList)
    .where(and(...conditions))
    .orderBy(desc(memberList.createdAt), desc(memberList.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : null;

  return { items, nextCursor };
}

export async function getMemberWorkImpact(
  tenantId: string,
  membershipId: string,
): Promise<MemberWorkImpact | null> {
  const db = getDb();
  const rows = await db
    .select({
      openFlightCount: sql<number>`(
        select count(*) from ${flights}
        where ${flights.tenantId} = ${tenantId}
          and ${flights.pilotMembershipId} = ${membershipId}
          and ${inArray(flights.status, [...OPEN_FLIGHT_STATUSES])}
      )`,
      activeFlightCount: sql<number>`(
        select count(*) from ${flights}
        where ${flights.tenantId} = ${tenantId}
          and ${flights.pilotMembershipId} = ${membershipId}
          and ${flights.status} = 'active'
      )`,
      openScheduleRequestCount: sql<number>`(
        select count(*) from ${scheduleRequests}
        where ${scheduleRequests.tenantId} = ${tenantId}
          and ${scheduleRequests.pilotMembershipId} = ${membershipId}
          and ${inArray(scheduleRequests.status, [...OPEN_REQUEST_STATUSES])}
      )`,
      terminalRequestLinkedFlightCount: sql<number>`(
        select count(*)
        from ${flights}
        inner join ${scheduleRequests}
          on ${scheduleRequests.id} = ${flights.scheduleRequestId}
          and ${scheduleRequests.tenantId} = ${flights.tenantId}
        where ${flights.tenantId} = ${tenantId}
          and ${flights.pilotMembershipId} = ${membershipId}
          and ${inArray(flights.status, [...OPEN_FLIGHT_STATUSES])}
          and ${inArray(scheduleRequests.status, ["fulfilled", "rejected", "cancelled"])}
      )`,
    })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMembership(input: {
  tenantId: string;
  authUserId: string;
  role: MemberRole;
  displayName?: string | null;
  pilotCallsign?: string | null;
  status?: Membership["status"];
}): Promise<Membership> {
  const db = getDb();
  const existing = await findMembership(input.tenantId, input.authUserId);
  if (existing) {
    const [updated] = await db
      .update(memberships)
      .set({
        role: input.role,
        displayName: input.displayName ?? existing.displayName,
        pilotCallsign: input.pilotCallsign ?? existing.pilotCallsign,
        status: input.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(memberships.tenantId, input.tenantId),
          eq(memberships.id, existing.id),
        ),
      )
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(memberships)
    .values({
      tenantId: input.tenantId,
      authUserId: input.authUserId,
      role: input.role,
      displayName: input.displayName ?? null,
      pilotCallsign: input.pilotCallsign ?? null,
      status: input.status ?? "active",
    })
    .returning();
  return created!;
}

/** Insert a directory member and its audit event atomically. */
export async function createDirectoryMembershipWithAudit(input: {
  tenantId: string;
  actorMembershipId: string;
  authUserId: string;
  role: MemberRole;
  displayName: string | null;
}): Promise<Membership | null> {
  const db = getDb();
  const createdAt = new Date();
  const id = randomUUID();
  const result = await runAtomic([
    guard(sql`NOT EXISTS (
      SELECT 1 FROM memberships
      WHERE tenant_id = ${input.tenantId}
        AND auth_user_id = ${input.authUserId}
    )`),
    db.insert(memberships).values({
      id,
      tenantId: input.tenantId,
      authUserId: input.authUserId,
      role: input.role,
      displayName: input.displayName,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    }),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "member.directory_created",
      entityType: "membership",
      entityId: id,
      meta: {
        after: {
          role: input.role,
          status: "active",
          displayName: input.displayName,
          pilotCallsign: null,
        },
      },
      createdAt,
    }),
  ]);
  if (!result) return null;
  return findMembershipById(input.tenantId, id);
}

/** First-login provisioning from a verified organization membership. */
export async function provisionMembershipWithAudit(input: {
  tenantId: string;
  authUserId: string;
  role: Exclude<MemberRole, "admin">;
}): Promise<Membership> {
  const db = getDb();
  const createdAt = new Date();
  const id = randomUUID();
  const result = await runAtomic([
    guard(sql`NOT EXISTS (
      SELECT 1 FROM memberships
      WHERE tenant_id = ${input.tenantId}
        AND auth_user_id = ${input.authUserId}
    )`),
    db.insert(memberships).values({
      id,
      tenantId: input.tenantId,
      authUserId: input.authUserId,
      role: input.role,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    }),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: id,
      action: "member.self_provisioned",
      entityType: "membership",
      entityId: id,
      meta: {
        after: { role: input.role, status: "active" },
        authority: "verified_clerk_membership",
      },
      createdAt,
    }),
  ]);
  if (result) {
    const created = await findMembershipById(input.tenantId, id);
    if (created) return created;
  }

  // Another first request may have won the unique insert. Return that
  // tenant-scoped member; its winning batch also wrote the audit event.
  const existing = await findMembership(input.tenantId, input.authUserId);
  if (!existing) throw new Error("Provisioned membership disappeared");
  return existing;
}

/** Backward-compatible pilot seam used by repository contract tests. */
export function provisionPilotMembershipWithAudit(input: {
  tenantId: string;
  authUserId: string;
}): Promise<Membership> {
  return provisionMembershipWithAudit({ ...input, role: "pilot" });
}

/**
 * Create or reopen a tenant membership application and its audit event
 * atomically. An existing active member is never downgraded by this flow.
 */
export async function submitMembershipApplicationWithAudit(input: {
  tenantId: string;
  authUserId: string;
  requestedRole: Exclude<MemberRole, "admin">;
  displayName: string | null;
}): Promise<{ membership: Membership; submitted: boolean }> {
  const submittedAt = new Date();
  const applicant = sql`
    tenant_id = ${input.tenantId} AND auth_user_id = ${input.authUserId}
  `;
  const result = await runAtomic([
    guard(sql`NOT EXISTS (
      SELECT 1 FROM memberships WHERE ${applicant} AND status = 'active'
    )`),
    sql`
      INSERT INTO memberships (
        id, tenant_id, auth_user_id, role, display_name, status, created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()}, ${input.tenantId}, ${input.authUserId},
        ${input.requestedRole}, ${input.displayName}, 'invited',
        ${ms(submittedAt)}, ${ms(submittedAt)}
      )
      ON CONFLICT (tenant_id, auth_user_id) DO UPDATE
      SET role = excluded.role,
          display_name = coalesce(excluded.display_name, memberships.display_name),
          status = 'invited',
          updated_at = excluded.updated_at
      WHERE memberships.status <> 'active'
    `,
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: sql`id`,
      action: "membership.application_submitted",
      entityType: "membership",
      entityId: sql`id`,
      meta: {
        requestedRole: input.requestedRole,
        authority: "verified_clerk_user",
      },
      createdAt: submittedAt,
      from: sql`memberships WHERE ${applicant}`,
    }),
  ]);
  const membership = await findMembership(input.tenantId, input.authUserId);
  if (!membership) throw new Error("Membership application disappeared");
  return { membership, submitted: result !== null };
}

/** Cancel only the signed-in user's own pending application. */
export async function cancelMembershipApplicationWithAudit(input: {
  tenantId: string;
  authUserId: string;
}): Promise<Membership | null> {
  const cancelledAt = new Date();
  const invited = sql`
    tenant_id = ${input.tenantId}
    AND auth_user_id = ${input.authUserId}
    AND status = 'invited'
  `;
  const result = await runAtomic([
    guard(sql`EXISTS (SELECT 1 FROM memberships WHERE ${invited})`),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: sql`id`,
      action: "membership.application_cancelled",
      entityType: "membership",
      entityId: sql`id`,
      meta: { authority: "verified_clerk_user" },
      createdAt: cancelledAt,
      from: sql`memberships WHERE ${invited}`,
    }),
    sql`
      UPDATE memberships
      SET status = 'disabled', updated_at = ${ms(cancelledAt)}
      WHERE ${invited}
    `,
  ]);
  if (!result) return null;
  return findMembership(input.tenantId, input.authUserId);
}

/** Update self-owned profile/connected-account fields; role/status use the admin transaction. */
export async function updateMembership(
  tenantId: string,
  id: string,
  patch: {
    displayName?: string | null;
    pilotCallsign?: string | null;
    simbriefUserId?: string | null;
    simbriefVerifiedAt?: Date | null;
    navigraphSubject?: string | null;
    navigraphUsername?: string | null;
    navigraphConnectedAt?: Date | null;
  },
): Promise<Membership | null> {
  const db = getDb();
  const [updated] = await db
    .update(memberships)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .returning();
  return updated ?? null;
}

export type AdministrativeMemberPatch = {
  role?: MemberRole;
  displayName?: string | null;
  pilotCallsign?: string | null;
  status?: Membership["status"];
};

export type AdministrativeUpdateResult =
  | {
      kind: "updated";
      membership: Membership;
      impact: MemberWorkImpact;
      reassignedFlightCount: number;
      reassignedScheduleRequestCount: number;
    }
  | { kind: "not_found" }
  | {
      kind: "blocked";
      reason:
        | "invalid_replacement"
        | "last_active_admin"
        | "active_flight"
        | "terminal_request_link"
        | "reassignment_required";
      impact: MemberWorkImpact;
    };

const LIVE_FLIGHT_STATUSES = [
  "draft",
  "offered",
  "accepted",
  "briefed",
  "active",
] as const;
const TERMINAL_REQUEST_STATUSES = ["fulfilled", "rejected", "cancelled"];
const ADMIN_UPDATE_ATTEMPTS = 3;

type AdministrativeState = {
  target: Membership;
  replacement: Membership | null;
  flights: Array<
    Pick<
      Flight,
      | "id"
      | "status"
      | "scheduleRequestId"
      | "version"
      | "assignmentRevision"
      | "assignmentConfirmedRevision"
    >
  >;
  requests: Array<
    Pick<ScheduleRequest, "id" | "pilotMembershipId" | "status" | "version">
  >;
  otherActiveAdminCount: number;
};

async function readAdministrativeState(input: {
  tenantId: string;
  membershipId: string;
  reassignToMembershipId?: string;
  expectedStatus?: Membership["status"];
}): Promise<AdministrativeState | null> {
  const db = getDb();
  const [targetRows, replacementRows, flightRows, requestRows, adminRows] =
    await db.batch([
      db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.id, input.membershipId),
            ...(input.expectedStatus
              ? [eq(memberships.status, input.expectedStatus)]
              : []),
          ),
        )
        .limit(1),
      db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.id, input.reassignToMembershipId ?? ""),
            ne(memberships.id, input.membershipId),
            eq(memberships.status, "active"),
            eq(memberships.role, "pilot"),
          ),
        )
        .limit(1),
      db
        .select({
          id: flights.id,
          status: flights.status,
          scheduleRequestId: flights.scheduleRequestId,
          version: flights.version,
          assignmentRevision: flights.assignmentRevision,
          assignmentConfirmedRevision: flights.assignmentConfirmedRevision,
        })
        .from(flights)
        .where(
          and(
            eq(flights.tenantId, input.tenantId),
            eq(flights.pilotMembershipId, input.membershipId),
            inArray(flights.status, [...LIVE_FLIGHT_STATUSES]),
          ),
        )
        .orderBy(flights.id),
      db
        .select({
          id: scheduleRequests.id,
          pilotMembershipId: scheduleRequests.pilotMembershipId,
          status: scheduleRequests.status,
          version: scheduleRequests.version,
        })
        .from(scheduleRequests)
        .where(
          and(
            eq(scheduleRequests.tenantId, input.tenantId),
            or(
              eq(scheduleRequests.pilotMembershipId, input.membershipId),
              sql`EXISTS (
                SELECT 1 FROM flights candidate
                WHERE candidate.tenant_id = ${input.tenantId}
                  AND candidate.pilot_membership_id = ${input.membershipId}
                  AND candidate.schedule_request_id = ${scheduleRequests.id}
                  AND candidate.status IN ('draft', 'offered', 'accepted', 'briefed', 'active')
              )`,
            ),
          ),
        )
        .orderBy(scheduleRequests.id),
      db
        .select({ count: sql<number>`count(*)` })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            ne(memberships.id, input.membershipId),
            eq(memberships.role, "admin"),
            eq(memberships.status, "active"),
          ),
        ),
    ]);
  const target = targetRows[0];
  if (!target) return null;
  return {
    target,
    replacement: replacementRows[0] ?? null,
    flights: flightRows,
    requests: requestRows,
    otherActiveAdminCount: Number(adminRows[0]?.count ?? 0),
  };
}

/** Compact, order-stable fingerprint of rows a decision depended on. */
function fingerprint(
  rows: ReadonlyArray<{ id: string; status: string; version: number }>,
): string {
  return rows.map((row) => `${row.id}:${row.status}:${row.version}`).join(",");
}

/**
 * Apply an administrator member change and its operational side effects in
 * one D1 transaction. The decision is computed from a consistent read; the
 * write batch re-asserts the member, the replacement, every affected flight
 * and request, and the remaining-admin count, and is retried when a
 * concurrent change invalidated the read.
 */
export async function administrativelyUpdateMembership(input: {
  tenantId: string;
  membershipId: string;
  actorMembershipId: string;
  patch: AdministrativeMemberPatch;
  reassignToMembershipId?: string;
  expectedStatus?: Membership["status"];
  auditAction?:
    | "member.updated"
    | "member.directory_synced"
    | "membership.application_approved"
    | "membership.application_rejected"
    | "membership.kick_requested";
}): Promise<AdministrativeUpdateResult> {
  for (let attempt = 0; attempt < ADMIN_UPDATE_ATTEMPTS; attempt += 1) {
    const result = await tryAdministrativeUpdate(input);
    if (result) return result;
  }
  throw new Error("Member update lost every optimistic-concurrency attempt");
}

async function tryAdministrativeUpdate(
  input: Parameters<typeof administrativelyUpdateMembership>[0],
): Promise<AdministrativeUpdateResult | null> {
  const db = getDb();
  const changedAt = new Date();
  const state = await readAdministrativeState(input);
  if (!state) return { kind: "not_found" };

  const { target, replacement } = state;
  const replacementId = input.reassignToMembershipId ?? null;
  const nextRole = input.patch.role ?? target.role;
  const nextStatus = input.patch.status ?? target.status;
  const requiresWorkTransfer =
    (input.patch.status !== undefined && input.patch.status !== "active") ||
    (input.patch.role !== undefined &&
      target.role === "pilot" &&
      input.patch.role !== "pilot");
  const openFlights = state.flights.filter(
    (flight) => flight.status !== "active",
  );
  const requestById = new Map(state.requests.map((r) => [r.id, r]));
  const impact: MemberWorkImpact = {
    openFlightCount: openFlights.length,
    activeFlightCount: state.flights.length - openFlights.length,
    openScheduleRequestCount: state.requests.filter(
      (request) =>
        request.pilotMembershipId === target.id &&
        (OPEN_REQUEST_STATUSES as readonly string[]).includes(request.status),
    ).length,
    terminalRequestLinkedFlightCount: openFlights.filter((flight) => {
      const request = flight.scheduleRequestId
        ? requestById.get(flight.scheduleRequestId)
        : undefined;
      return !!request && TERMINAL_REQUEST_STATUSES.includes(request.status);
    }).length,
  };
  const removesLastAdmin =
    target.role === "admin" &&
    target.status === "active" &&
    (nextRole !== "admin" || nextStatus !== "active") &&
    state.otherActiveAdminCount === 0;

  const blocked = (
    reason: Extract<AdministrativeUpdateResult, { kind: "blocked" }>["reason"],
  ): AdministrativeUpdateResult => ({ kind: "blocked", reason, impact });
  if (replacementId !== null && !replacement) {
    return blocked("invalid_replacement");
  }
  if (removesLastAdmin) return blocked("last_active_admin");
  if (requiresWorkTransfer && impact.activeFlightCount > 0) {
    return blocked("active_flight");
  }
  if (requiresWorkTransfer && impact.terminalRequestLinkedFlightCount > 0) {
    return blocked("terminal_request_link");
  }
  if (
    requiresWorkTransfer &&
    (impact.openFlightCount > 0 || impact.openScheduleRequestCount > 0) &&
    !replacement
  ) {
    return blocked("reassignment_required");
  }

  const flightsToMove = requiresWorkTransfer && replacement ? openFlights : [];
  const requestsToMove =
    requiresWorkTransfer && replacement
      ? state.requests.filter(
          (request) =>
            request.pilotMembershipId === target.id &&
            (OPEN_REQUEST_STATUSES as readonly string[]).includes(
              request.status,
            ),
        )
      : [];
  const after = {
    role: nextRole,
    status: nextStatus,
    displayName:
      input.patch.displayName !== undefined
        ? input.patch.displayName
        : target.displayName,
    pilotCallsign:
      input.patch.pilotCallsign !== undefined
        ? input.patch.pilotCallsign
        : target.pilotCallsign,
  };

  const statements = [
    guard(sql`EXISTS (
      SELECT 1 FROM memberships
      WHERE tenant_id = ${input.tenantId}
        AND id = ${target.id}
        AND role = ${target.role}
        AND status = ${target.status}
        AND updated_at = ${ms(target.updatedAt)}
    )`),
    guard(sql`(
      SELECT count(*) FROM memberships
      WHERE tenant_id = ${input.tenantId}
        AND id <> ${target.id}
        AND role = 'admin'
        AND status = 'active'
    ) = ${state.otherActiveAdminCount}`),
    guard(sql`coalesce((
      SELECT group_concat(id || ':' || status || ':' || version, ',' ORDER BY id)
      FROM flights
      WHERE tenant_id = ${input.tenantId}
        AND pilot_membership_id = ${target.id}
        AND status IN ('draft', 'offered', 'accepted', 'briefed', 'active')
    ), '') = ${fingerprint(state.flights)}`),
    guard(sql`coalesce((
      SELECT group_concat(sr.id || ':' || sr.status || ':' || sr.version, ',' ORDER BY sr.id)
      FROM schedule_requests sr
      WHERE sr.tenant_id = ${input.tenantId}
        AND (
          sr.pilot_membership_id = ${target.id}
          OR EXISTS (
            SELECT 1 FROM flights candidate
            WHERE candidate.tenant_id = sr.tenant_id
              AND candidate.pilot_membership_id = ${target.id}
              AND candidate.schedule_request_id = sr.id
              AND candidate.status IN ('draft', 'offered', 'accepted', 'briefed', 'active')
          )
        )
    ), '') = ${fingerprint(state.requests)}`),
    ...(replacement
      ? [
          guard(sql`EXISTS (
            SELECT 1 FROM memberships
            WHERE tenant_id = ${input.tenantId}
              AND id = ${replacement.id}
              AND role = 'pilot'
              AND status = 'active'
          )`),
        ]
      : []),
    db
      .update(memberships)
      .set({
        role: nextRole,
        displayName: after.displayName,
        pilotCallsign: after.pilotCallsign,
        status: nextStatus,
        updatedAt: changedAt,
      })
      .where(
        and(
          eq(memberships.tenantId, input.tenantId),
          eq(memberships.id, target.id),
        ),
      ),
    ...flightsToMove.flatMap((flight) => {
      const nextFlightStatus =
        flight.status === "accepted" || flight.status === "briefed"
          ? "offered"
          : flight.status;
      return [
        db
          .update(flights)
          .set({
            pilotMembershipId: replacement!.id,
            version: flight.version + 1,
            assignmentRevision: flight.assignmentRevision + 1,
            assignmentConfirmedRevision: null,
            assignmentConfirmedAt: null,
            status: nextFlightStatus,
            updatedAt: changedAt,
          })
          .where(
            and(
              eq(flights.tenantId, input.tenantId),
              eq(flights.id, flight.id),
            ),
          ),
        insertAudit({
          tenantId: input.tenantId,
          actorMembershipId: input.actorMembershipId,
          action: "flight.assignment_reassigned",
          entityType: "flight",
          entityId: flight.id,
          meta: {
            before: {
              pilotMembershipId: target.id,
              status: flight.status,
              version: flight.version,
              assignmentRevision: flight.assignmentRevision,
              assignmentConfirmedRevision: flight.assignmentConfirmedRevision,
            },
            after: {
              pilotMembershipId: replacementId,
              status: nextFlightStatus,
              version: flight.version + 1,
              assignmentRevision: flight.assignmentRevision + 1,
              assignmentConfirmedRevision: null,
            },
            acceptanceInvalidated:
              flight.status === "accepted" || flight.status === "briefed",
            reason: "member_became_ineligible",
          },
          createdAt: changedAt,
        }),
      ];
    }),
    ...requestsToMove.flatMap((request) => [
      db
        .update(scheduleRequests)
        .set({
          pilotMembershipId: replacement!.id,
          version: request.version + 1,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(scheduleRequests.tenantId, input.tenantId),
            eq(scheduleRequests.id, request.id),
          ),
        ),
      insertAudit({
        tenantId: input.tenantId,
        actorMembershipId: input.actorMembershipId,
        action: "schedule_request.assignment_reassigned",
        entityType: "schedule_request",
        entityId: request.id,
        meta: {
          before: {
            pilotMembershipId: target.id,
            status: request.status,
            version: request.version,
          },
          after: {
            pilotMembershipId: replacementId,
            status: request.status,
            version: request.version + 1,
          },
          reason: "member_became_ineligible",
        },
        createdAt: changedAt,
      }),
    ]),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: input.auditAction ?? "member.updated",
      entityType: "membership",
      entityId: target.id,
      meta: {
        before: {
          role: target.role,
          status: target.status,
          displayName: target.displayName,
          pilotCallsign: target.pilotCallsign,
        },
        after,
        reassignedToMembershipId: replacementId,
        reassignedFlightCount: flightsToMove.length,
        reassignedScheduleRequestCount: requestsToMove.length,
        flightAuditCount: flightsToMove.length,
        scheduleRequestAuditCount: requestsToMove.length,
      },
      createdAt: changedAt,
    }),
  ];
  const result = await runAtomic(statements);
  if (!result) return null;

  const membership = await findMembershipById(input.tenantId, target.id);
  if (!membership) return { kind: "not_found" };
  return {
    kind: "updated",
    membership,
    impact,
    reassignedFlightCount: flightsToMove.length,
    reassignedScheduleRequestCount: requestsToMove.length,
  };
}

/**
 * Recovery seam for a verified organization administrator. It only acts
 * when a tenant has no active application administrator and records the repair.
 */
export async function recoverMembershipAsTenantAdmin(input: {
  tenantId: string;
  membershipId: string;
}): Promise<Membership | null> {
  const db = getDb();
  const recoveredAt = new Date();
  const result = await runAtomic([
    guard(sql`EXISTS (
      SELECT 1 FROM memberships
      WHERE tenant_id = ${input.tenantId} AND id = ${input.membershipId}
    )`),
    guard(sql`NOT EXISTS (
      SELECT 1 FROM memberships active_admin
      WHERE active_admin.tenant_id = ${input.tenantId}
        AND active_admin.role = 'admin'
        AND active_admin.status = 'active'
    )`),
    db
      .update(memberships)
      .set({ role: "admin", status: "active", updatedAt: recoveredAt })
      .where(
        and(
          eq(memberships.tenantId, input.tenantId),
          eq(memberships.id, input.membershipId),
        ),
      ),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.membershipId,
      action: "member.admin_recovered",
      entityType: "membership",
      entityId: input.membershipId,
      meta: { authority: "verified_clerk_organization_admin" },
      createdAt: recoveredAt,
    }),
  ]);
  if (!result) return null;
  return findMembershipById(input.tenantId, input.membershipId);
}

export async function markSimbriefVerified(input: {
  tenantId: string;
  membershipId: string;
  simbriefUserId: string;
  verifiedAt: Date;
}): Promise<Membership | null> {
  const db = getDb();
  const [updated] = await db
    .update(memberships)
    .set({
      simbriefVerifiedAt: input.verifiedAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(memberships.tenantId, input.tenantId),
        eq(memberships.id, input.membershipId),
        eq(memberships.simbriefUserId, input.simbriefUserId),
      ),
    )
    .returning();
  return updated ?? null;
}
