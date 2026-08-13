import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../client.js";
import {
  flights,
  memberships,
  scheduleRequests,
  type MemberRole,
  type Membership,
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
  clerkUserId: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.clerkUserId, clerkUserId),
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
  // so PostgreSQL can distinguish the joined `id` and `tenant_id` columns.
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
        ilike(memberList.displayName, pattern),
        ilike(memberList.pilotCallsign, pattern),
        ilike(memberList.clerkUserId, pattern),
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
    .select({ value: sql<number>`count(*)::int` })
    .from(openFlights)
    .where(
      and(
        eq(openFlights.tenantId, memberList.tenantId),
        eq(openFlights.pilotMembershipId, memberList.id),
        inArray(openFlights.status, [...OPEN_FLIGHT_STATUSES]),
      ),
    );
  const activeFlightCount = db
    .select({ value: sql<number>`count(*)::int` })
    .from(activeFlights)
    .where(
      and(
        eq(activeFlights.tenantId, memberList.tenantId),
        eq(activeFlights.pilotMembershipId, memberList.id),
        eq(activeFlights.status, "active"),
      ),
    );
  const openScheduleRequestCount = db
    .select({ value: sql<number>`count(*)::int` })
    .from(openRequests)
    .where(
      and(
        eq(openRequests.tenantId, memberList.tenantId),
        eq(openRequests.pilotMembershipId, memberList.id),
        inArray(openRequests.status, [...OPEN_REQUEST_STATUSES]),
      ),
    );
  const terminalRequestLinkedFlightCount = db
    .select({ value: sql<number>`count(*)::int` })
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
      clerkUserId: memberList.clerkUserId,
      role: memberList.role,
      requestedRole: memberList.requestedRole,
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
        select count(*)::int from ${flights}
        where ${flights.tenantId} = ${tenantId}
          and ${flights.pilotMembershipId} = ${membershipId}
          and ${inArray(flights.status, [...OPEN_FLIGHT_STATUSES])}
      )`,
      activeFlightCount: sql<number>`(
        select count(*)::int from ${flights}
        where ${flights.tenantId} = ${tenantId}
          and ${flights.pilotMembershipId} = ${membershipId}
          and ${flights.status} = 'active'
      )`,
      openScheduleRequestCount: sql<number>`(
        select count(*)::int from ${scheduleRequests}
        where ${scheduleRequests.tenantId} = ${tenantId}
          and ${scheduleRequests.pilotMembershipId} = ${membershipId}
          and ${inArray(scheduleRequests.status, [...OPEN_REQUEST_STATUSES])}
      )`,
      terminalRequestLinkedFlightCount: sql<number>`(
        select count(*)::int
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
  clerkUserId: string;
  role: MemberRole;
  displayName?: string | null;
  pilotCallsign?: string | null;
  status?: Membership["status"];
}): Promise<Membership> {
  const db = getDb();
  const existing = await findMembership(input.tenantId, input.clerkUserId);
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
      clerkUserId: input.clerkUserId,
      role: input.role,
      displayName: input.displayName ?? null,
      pilotCallsign: input.pilotCallsign ?? null,
      status: input.status ?? "active",
    })
    .returning();
  return created!;
}

type RawMembershipRow = {
  id: string;
  tenantId: string;
  clerkUserId: string;
  role: MemberRole;
  requestedRole: MemberRole | null;
  displayName: string | null;
  pilotCallsign: string | null;
  simbriefUserId: string | null;
  simbriefVerifiedAt: Date | string | null;
  navigraphSubject: string | null;
  navigraphUsername: string | null;
  navigraphConnectedAt: Date | string | null;
  status: Membership["status"];
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Insert a directory member and its audit event as one statement. */
export async function createDirectoryMembershipWithAudit(input: {
  tenantId: string;
  actorMembershipId: string;
  clerkUserId: string;
  role: MemberRole;
  displayName: string | null;
}): Promise<Membership | null> {
  const db = getDb();
  const createdAt = new Date();
  const result = await db.execute<RawMembershipRow>(sql`
    with created as (
      insert into memberships (
        tenant_id, clerk_user_id, role, display_name, status, created_at, updated_at
      )
      values (
        ${input.tenantId}::uuid,
        ${input.clerkUserId},
        ${input.role}::member_role,
        ${input.displayName},
        'active',
        ${createdAt},
        ${createdAt}
      )
      on conflict (tenant_id, clerk_user_id) do nothing
      returning *
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        c.tenant_id,
        ${input.actorMembershipId}::uuid,
        'member.directory_created',
        'membership',
        c.id::text,
        jsonb_build_object(
          'after', jsonb_build_object(
            'role', c.role,
            'status', c.status,
            'displayName', c.display_name,
            'pilotCallsign', c.pilot_callsign
          )
        ),
        ${createdAt}
      from created c
      returning id
    )
    select
      c.id,
      c.tenant_id as "tenantId",
      c.clerk_user_id as "clerkUserId",
      c.role,
      c.requested_role as "requestedRole",
      c.display_name as "displayName",
      c.pilot_callsign as "pilotCallsign",
      c.simbrief_user_id as "simbriefUserId",
      c.simbrief_verified_at as "simbriefVerifiedAt",
      c.navigraph_subject as "navigraphSubject",
      c.navigraph_username as "navigraphUsername",
      c.navigraph_connected_at as "navigraphConnectedAt",
      c.status,
      c.created_at as "createdAt",
      c.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from created c
  `);
  const row = result.rows[0] as RawMembershipRow | undefined;
  return row ? rawMembership(row) : null;
}

/** First-login provisioning from a verified Clerk organization membership. */
export async function provisionMembershipWithAudit(input: {
  tenantId: string;
  clerkUserId: string;
  role: Exclude<MemberRole, "admin">;
}): Promise<Membership> {
  const db = getDb();
  const createdAt = new Date();
  const result = await db.execute<RawMembershipRow>(sql`
    with created as (
      insert into memberships (
        tenant_id, clerk_user_id, role, status, created_at, updated_at
      )
      values (
        ${input.tenantId}::uuid,
        ${input.clerkUserId},
        ${input.role}::member_role,
        'active',
        ${createdAt},
        ${createdAt}
      )
      on conflict (tenant_id, clerk_user_id) do nothing
      returning *
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        c.tenant_id,
        c.id,
        'member.self_provisioned',
        'membership',
        c.id::text,
        jsonb_build_object(
          'after', jsonb_build_object('role', c.role, 'status', c.status),
          'authority', 'verified_clerk_membership'
        ),
        ${createdAt}
      from created c
      returning id
    )
    select
      c.id,
      c.tenant_id as "tenantId",
      c.clerk_user_id as "clerkUserId",
      c.role,
      c.requested_role as "requestedRole",
      c.display_name as "displayName",
      c.pilot_callsign as "pilotCallsign",
      c.simbrief_user_id as "simbriefUserId",
      c.simbrief_verified_at as "simbriefVerifiedAt",
      c.navigraph_subject as "navigraphSubject",
      c.navigraph_username as "navigraphUsername",
      c.navigraph_connected_at as "navigraphConnectedAt",
      c.status,
      c.created_at as "createdAt",
      c.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from created c
  `);
  const row = result.rows[0] as RawMembershipRow | undefined;
  if (row) return rawMembership(row);

  // Another first request may have won the unique insert. Return that
  // tenant-scoped member; its winning statement also wrote the audit event.
  const existing = await findMembership(input.tenantId, input.clerkUserId);
  if (!existing) throw new Error("Provisioned membership disappeared");
  return existing;
}

/** Backward-compatible pilot seam used by repository contract tests. */
export function provisionPilotMembershipWithAudit(input: {
  tenantId: string;
  clerkUserId: string;
}): Promise<Membership> {
  return provisionMembershipWithAudit({ ...input, role: "pilot" });
}

/**
 * Create or reopen a tenant membership application and its audit event in one
 * statement. An existing active member is never downgraded by this flow.
 */
export async function submitMembershipApplicationWithAudit(input: {
  tenantId: string;
  clerkUserId: string;
  requestedRole: Exclude<MemberRole, "admin">;
  displayName: string | null;
}): Promise<{ membership: Membership; submitted: boolean }> {
  const db = getDb();
  const submittedAt = new Date();
  const result = await db.execute<RawMembershipRow>(sql`
    with submitted as (
      insert into memberships (
        tenant_id, clerk_user_id, role, requested_role, display_name, status, created_at, updated_at
      )
      values (
        ${input.tenantId}::uuid,
        ${input.clerkUserId},
        'pilot',
        ${input.requestedRole}::member_role,
        ${input.displayName},
        'invited',
        ${submittedAt},
        ${submittedAt}
      )
      on conflict (tenant_id, clerk_user_id) do update
      set
        requested_role = excluded.requested_role,
        display_name = coalesce(excluded.display_name, memberships.display_name),
        status = 'invited',
        updated_at = excluded.updated_at
      where memberships.status <> 'active'
      returning *
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        s.tenant_id,
        s.id,
        'membership.application_submitted',
        'membership',
        s.id::text,
        jsonb_build_object(
          'requestedRole', s.requested_role,
          'authority', 'verified_clerk_user'
        ),
        ${submittedAt}
      from submitted s
      returning id
    )
    select
      s.id,
      s.tenant_id as "tenantId",
      s.clerk_user_id as "clerkUserId",
      s.role,
      s.requested_role as "requestedRole",
      s.display_name as "displayName",
      s.pilot_callsign as "pilotCallsign",
      s.simbrief_user_id as "simbriefUserId",
      s.simbrief_verified_at as "simbriefVerifiedAt",
      s.navigraph_subject as "navigraphSubject",
      s.navigraph_username as "navigraphUsername",
      s.navigraph_connected_at as "navigraphConnectedAt",
      s.status,
      s.created_at as "createdAt",
      s.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from submitted s
  `);
  const row = result.rows[0] as RawMembershipRow | undefined;
  if (row) return { membership: rawMembership(row), submitted: true };

  const existing = await findMembership(input.tenantId, input.clerkUserId);
  if (!existing) throw new Error("Membership application disappeared");
  return { membership: existing, submitted: false };
}

/** Cancel only the signed-in user's own pending application. */
export async function cancelMembershipApplicationWithAudit(input: {
  tenantId: string;
  clerkUserId: string;
}): Promise<Membership | null> {
  const db = getDb();
  const cancelledAt = new Date();
  const result = await db.execute<RawMembershipRow>(sql`
    with cancelled as (
      update memberships m
      set status = 'disabled', updated_at = ${cancelledAt}
      where m.tenant_id = ${input.tenantId}::uuid
        and m.clerk_user_id = ${input.clerkUserId}
        and m.status = 'invited'
      returning m.*
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        c.tenant_id,
        c.id,
        'membership.application_cancelled',
        'membership',
        c.id::text,
        jsonb_build_object('authority', 'verified_clerk_user'),
        ${cancelledAt}
      from cancelled c
      returning id
    )
    select
      c.id,
      c.tenant_id as "tenantId",
      c.clerk_user_id as "clerkUserId",
      c.role,
      c.requested_role as "requestedRole",
      c.display_name as "displayName",
      c.pilot_callsign as "pilotCallsign",
      c.simbrief_user_id as "simbriefUserId",
      c.simbrief_verified_at as "simbriefVerifiedAt",
      c.navigraph_subject as "navigraphSubject",
      c.navigraph_username as "navigraphUsername",
      c.navigraph_connected_at as "navigraphConnectedAt",
      c.status,
      c.created_at as "createdAt",
      c.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from cancelled c
  `);
  const row = result.rows[0] as RawMembershipRow | undefined;
  return row ? rawMembership(row) : null;
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

type AdministrativeUpdateRow = {
  targetId: string;
  blockedReason:
    | "invalid_replacement"
    | "last_active_admin"
    | "active_flight"
    | "terminal_request_link"
    | "reassignment_required"
    | null;
  openFlightCount: number;
  activeFlightCount: number;
  openScheduleRequestCount: number;
  terminalRequestLinkedFlightCount: number;
  reassignedFlightCount: number;
  reassignedScheduleRequestCount: number;
  id: string | null;
  tenantId: string | null;
  clerkUserId: string | null;
  role: MemberRole | null;
  requestedRole: MemberRole | null;
  displayName: string | null;
  pilotCallsign: string | null;
  simbriefUserId: string | null;
  simbriefVerifiedAt: Date | string | null;
  navigraphSubject: string | null;
  navigraphUsername: string | null;
  navigraphConnectedAt: Date | string | null;
  status: Membership["status"] | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

/**
 * Apply an administrator member change and its operational side effects in one
 * database transaction. Neon HTTP does not expose callback transactions, so a
 * tenant-scoped advisory lock plus a fixed Drizzle batch is used. The second
 * statement receives a fresh READ COMMITTED snapshot after the lock and keeps
 * the last-active-admin check, work reassignment, and audit insert atomic.
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
  const db = getDb();
  const changedAt = new Date();
  const hasRole = input.patch.role !== undefined;
  const hasDisplayName = input.patch.displayName !== undefined;
  const hasPilotCallsign = input.patch.pilotCallsign !== undefined;
  const hasStatus = input.patch.status !== undefined;
  const replacementId = input.reassignToMembershipId ?? null;
  const clearRequestedRole =
    input.auditAction === "membership.application_approved" ||
    input.auditAction === "membership.application_rejected";

  const lock = db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 1447126::bigint))`,
  );
  const operation = db.execute<AdministrativeUpdateRow>(sql`
    with target as materialized (
      select
        m.*,
        case when ${hasRole} then ${input.patch.role ?? "pilot"}::member_role else m.role end as next_role,
        case when ${hasStatus} then ${input.patch.status ?? "active"}::member_status else m.status end as next_status,
        (
          (${hasStatus} and ${input.patch.status ?? "active"}::member_status <> 'active')
          or (
            ${hasRole}
            and m.role = 'pilot'
            and ${input.patch.role ?? "pilot"}::member_role <> 'pilot'
          )
        ) as requires_work_transfer
      from memberships m
      where m.tenant_id = ${input.tenantId}::uuid
        and m.id = ${input.membershipId}::uuid
        and (
          ${input.expectedStatus ?? null}::member_status is null
          or m.status = ${input.expectedStatus ?? null}::member_status
        )
      for update of m
    ),
    replacement as materialized (
      select m.id
      from memberships m, target t
      where ${replacementId}::uuid is not null
        and m.tenant_id = ${input.tenantId}::uuid
        and m.id = ${replacementId}::uuid
        and m.id <> t.id
        and m.status = 'active'
        and m.role = 'pilot'
      limit 1
    ),
    locked_requests as materialized (
      select sr.id, sr.pilot_membership_id, sr.status, sr.version
      from schedule_requests sr, target t
      where sr.tenant_id = t.tenant_id
        and (
          sr.pilot_membership_id = t.id
          or exists (
            select 1
            from flights candidate_flight
            where candidate_flight.tenant_id = t.tenant_id
              and candidate_flight.pilot_membership_id = t.id
              and candidate_flight.schedule_request_id = sr.id
              and candidate_flight.status in (
                'draft', 'offered', 'accepted', 'briefed', 'active'
              )
          )
        )
      order by sr.id
      for update of sr
    ),
    locked_request_gate as materialized (
      select count(*)::int as locked_request_count from locked_requests
    ),
    locked_flights as materialized (
      select
        f.id,
        f.status,
        f.schedule_request_id,
        f.version,
        f.assignment_revision,
        f.assignment_confirmed_revision
      from flights f, target t, locked_request_gate request_gate
      where request_gate.locked_request_count >= 0
        and f.tenant_id = t.tenant_id
        and f.pilot_membership_id = t.id
        and f.status in ('draft', 'offered', 'accepted', 'briefed', 'active')
      order by f.id
      for update of f
    ),
    impact as materialized (
      select
        (
          select count(*)::int from locked_flights lf
          where lf.status in ('draft', 'offered', 'accepted', 'briefed')
        ) as open_flight_count,
        (
          select count(*)::int from locked_flights lf
          where lf.status = 'active'
        ) as active_flight_count,
        (
          select count(*)::int from locked_requests lr
          where lr.pilot_membership_id = t.id
            and lr.status in ('pending', 'in_review', 'partially_fulfilled')
        ) as open_schedule_request_count,
        (
          select count(*)::int
          from locked_flights lf
          inner join locked_requests lr on lr.id = lf.schedule_request_id
          where lf.status in ('draft', 'offered', 'accepted', 'briefed')
            and lr.status in ('fulfilled', 'rejected', 'cancelled')
        ) as terminal_request_linked_flight_count
      from target t
    ),
    eligible as materialized (
      select t.*
      from target t, impact i
      where (${replacementId}::uuid is null or exists (select 1 from replacement))
        and not (
          t.role = 'admin'
          and t.status = 'active'
          and (t.next_role <> 'admin' or t.next_status <> 'active')
          and not exists (
            select 1 from memberships other
            where other.tenant_id = t.tenant_id
              and other.id <> t.id
              and other.role = 'admin'
              and other.status = 'active'
          )
        )
        and not (
          t.requires_work_transfer
          and i.active_flight_count > 0
        )
        and not (
          t.requires_work_transfer
          and i.terminal_request_linked_flight_count > 0
        )
        and not (
          t.requires_work_transfer
          and (i.open_flight_count > 0 or i.open_schedule_request_count > 0)
          and not exists (select 1 from replacement)
        )
    ),
    updated_member as (
      update memberships m
      set
        role = e.next_role,
        requested_role = case
          when ${clearRequestedRole} then null
          else m.requested_role
        end,
        display_name = case when ${hasDisplayName} then ${input.patch.displayName ?? null}::text else m.display_name end,
        pilot_callsign = case when ${hasPilotCallsign} then ${input.patch.pilotCallsign ?? null}::text else m.pilot_callsign end,
        status = e.next_status,
        updated_at = ${changedAt}
      from eligible e
      where m.id = e.id and m.tenant_id = e.tenant_id
      returning m.*
    ),
    flight_candidates as materialized (
      select
        lf.id,
        lf.status as previous_status,
        lf.schedule_request_id,
        lf.version as previous_version,
        lf.assignment_revision as previous_assignment_revision,
        lf.assignment_confirmed_revision as previous_confirmed_revision
      from locked_flights lf, updated_member u
      where exists (
          select 1 from eligible e where e.requires_work_transfer
        )
        and lf.status in ('draft', 'offered', 'accepted', 'briefed')
    ),
    reassigned_flights as (
      update flights f
      set
        pilot_membership_id = r.id,
        version = f.version + 1,
        assignment_revision = f.assignment_revision + 1,
        assignment_confirmed_revision = null,
        assignment_confirmed_at = null,
        status = case
          when fc.previous_status in ('accepted', 'briefed') then 'offered'::flight_status
          else fc.previous_status
        end,
        updated_at = ${changedAt}
      from flight_candidates fc, replacement r
      where f.id = fc.id
        and f.tenant_id = ${input.tenantId}::uuid
        and f.pilot_membership_id = ${input.membershipId}::uuid
        and f.status = fc.previous_status
        and f.version = fc.previous_version
      returning
        f.id,
        f.schedule_request_id,
        fc.previous_status,
        f.status as next_status,
        fc.previous_version,
        f.version as next_version,
        fc.previous_assignment_revision,
        f.assignment_revision as next_assignment_revision,
        fc.previous_confirmed_revision
    ),
    request_candidates as materialized (
      select
        lr.id,
        lr.status as request_status,
        lr.version as previous_version
      from locked_requests lr, updated_member u
      where lr.pilot_membership_id = u.id
        and lr.status in ('pending', 'in_review', 'partially_fulfilled')
    ),
    reassigned_requests as (
      update schedule_requests sr
      set
        pilot_membership_id = r.id,
        version = sr.version + 1,
        updated_at = ${changedAt}
      from request_candidates rc, replacement r
      where sr.id = rc.id
        and sr.tenant_id = ${input.tenantId}::uuid
        and sr.pilot_membership_id = ${input.membershipId}::uuid
        and sr.status = rc.request_status
        and sr.version = rc.previous_version
      returning
        sr.id,
        rc.request_status,
        rc.previous_version,
        sr.version as next_version
    ),
    recorded_flight_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        ${input.tenantId}::uuid,
        ${input.actorMembershipId}::uuid,
        'flight.assignment_reassigned',
        'flight',
        rf.id::text,
        jsonb_build_object(
          'before', jsonb_build_object(
            'pilotMembershipId', ${input.membershipId}::uuid,
            'status', rf.previous_status,
            'version', rf.previous_version,
            'assignmentRevision', rf.previous_assignment_revision,
            'assignmentConfirmedRevision', rf.previous_confirmed_revision
          ),
          'after', jsonb_build_object(
            'pilotMembershipId', ${replacementId}::uuid,
            'status', rf.next_status,
            'version', rf.next_version,
            'assignmentRevision', rf.next_assignment_revision,
            'assignmentConfirmedRevision', null
          ),
          'acceptanceInvalidated', rf.previous_status in ('accepted', 'briefed'),
          'reason', 'member_became_ineligible'
        ),
        ${changedAt}
      from reassigned_flights rf
      returning id
    ),
    recorded_request_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        ${input.tenantId}::uuid,
        ${input.actorMembershipId}::uuid,
        'schedule_request.assignment_reassigned',
        'schedule_request',
        rr.id::text,
        jsonb_build_object(
          'before', jsonb_build_object(
            'pilotMembershipId', ${input.membershipId}::uuid,
            'status', rr.request_status,
            'version', rr.previous_version
          ),
          'after', jsonb_build_object(
            'pilotMembershipId', ${replacementId}::uuid,
            'status', rr.request_status,
            'version', rr.next_version
          ),
          'reason', 'member_became_ineligible'
        ),
        ${changedAt}
      from reassigned_requests rr
      returning id
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta,
        created_at
      )
      select
        u.tenant_id,
        ${input.actorMembershipId}::uuid,
        ${input.auditAction ?? "member.updated"},
        'membership',
        u.id::text,
        jsonb_build_object(
          'before', jsonb_build_object(
            'role', t.role,
            'requestedRole', t.requested_role,
            'status', t.status,
            'displayName', t.display_name,
            'pilotCallsign', t.pilot_callsign
          ),
          'after', jsonb_build_object(
            'role', u.role,
            'requestedRole', u.requested_role,
            'status', u.status,
            'displayName', u.display_name,
            'pilotCallsign', u.pilot_callsign
          ),
          'reassignedToMembershipId', ${replacementId}::uuid,
          'reassignedFlightCount', (select count(*)::int from reassigned_flights),
          'reassignedScheduleRequestCount', (select count(*)::int from reassigned_requests),
          'flightAuditCount', (select count(*)::int from recorded_flight_audit),
          'scheduleRequestAuditCount', (select count(*)::int from recorded_request_audit)
        ),
        ${changedAt}
      from updated_member u, target t
      returning id
    )
    select
      t.id as "targetId",
      case
        when ${replacementId}::uuid is not null and not exists (select 1 from replacement)
          then 'invalid_replacement'
        when t.role = 'admin'
          and t.status = 'active'
          and (t.next_role <> 'admin' or t.next_status <> 'active')
          and not exists (
            select 1 from memberships other
            where other.tenant_id = t.tenant_id
              and other.id <> t.id
              and other.role = 'admin'
              and other.status = 'active'
          ) then 'last_active_admin'
        when t.requires_work_transfer
          and i.active_flight_count > 0
          then 'active_flight'
        when t.requires_work_transfer
          and i.terminal_request_linked_flight_count > 0
          then 'terminal_request_link'
        when t.requires_work_transfer
          and (i.open_flight_count > 0 or i.open_schedule_request_count > 0)
          and not exists (select 1 from replacement)
          then 'reassignment_required'
        else null
      end as "blockedReason",
      i.open_flight_count as "openFlightCount",
      i.active_flight_count as "activeFlightCount",
      i.open_schedule_request_count as "openScheduleRequestCount",
      i.terminal_request_linked_flight_count as "terminalRequestLinkedFlightCount",
      (select count(*)::int from reassigned_flights) as "reassignedFlightCount",
      (select count(*)::int from reassigned_requests) as "reassignedScheduleRequestCount",
      u.id,
      u.tenant_id as "tenantId",
      u.clerk_user_id as "clerkUserId",
      u.role,
      u.requested_role as "requestedRole",
      u.display_name as "displayName",
      u.pilot_callsign as "pilotCallsign",
      u.simbrief_user_id as "simbriefUserId",
      u.simbrief_verified_at as "simbriefVerifiedAt",
      u.navigraph_subject as "navigraphSubject",
      u.navigraph_username as "navigraphUsername",
      u.navigraph_connected_at as "navigraphConnectedAt",
      u.status,
      u.created_at as "createdAt",
      u.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from target t
    join impact i on true
    left join updated_member u on true
  `);

  const [, result] = await db.batch([lock, operation] as const);
  const row = result.rows[0] as AdministrativeUpdateRow | undefined;
  if (!row) return { kind: "not_found" };

  const impact = {
    openFlightCount: Number(row.openFlightCount),
    activeFlightCount: Number(row.activeFlightCount),
    openScheduleRequestCount: Number(row.openScheduleRequestCount),
    terminalRequestLinkedFlightCount: Number(
      row.terminalRequestLinkedFlightCount,
    ),
  };
  if (!row.id || row.blockedReason) {
    return {
      kind: "blocked",
      reason: row.blockedReason ?? "reassignment_required",
      impact,
    };
  }

  return {
    kind: "updated",
    membership: rawMembership(row as RawMembershipRow),
    impact,
    reassignedFlightCount: Number(row.reassignedFlightCount),
    reassignedScheduleRequestCount: Number(row.reassignedScheduleRequestCount),
  };
}

/**
 * Recovery seam for a verified Clerk organization administrator. It only acts
 * when a tenant has no active application administrator and records the repair.
 */
export async function recoverMembershipAsTenantAdmin(input: {
  tenantId: string;
  membershipId: string;
}): Promise<Membership | null> {
  const db = getDb();
  const recoveredAt = new Date();
  const lock = db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 1447126::bigint))`,
  );
  const operation = db.execute<AdministrativeUpdateRow>(sql`
    with recovered as (
      update memberships m
      set role = 'admin', status = 'active', updated_at = ${recoveredAt}
      where m.tenant_id = ${input.tenantId}::uuid
        and m.id = ${input.membershipId}::uuid
        and not exists (
          select 1 from memberships active_admin
          where active_admin.tenant_id = m.tenant_id
            and active_admin.role = 'admin'
            and active_admin.status = 'active'
        )
      returning m.*
    ),
    recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta, created_at
      )
      select
        r.tenant_id,
        r.id,
        'member.admin_recovered',
        'membership',
        r.id::text,
        jsonb_build_object('authority', 'verified_clerk_organization_admin'),
        ${recoveredAt}
      from recovered r
      returning id
    )
    select
      r.id,
      r.tenant_id as "tenantId",
      r.clerk_user_id as "clerkUserId",
      r.role,
      r.requested_role as "requestedRole",
      r.display_name as "displayName",
      r.pilot_callsign as "pilotCallsign",
      r.simbrief_user_id as "simbriefUserId",
      r.simbrief_verified_at as "simbriefVerifiedAt",
      r.navigraph_subject as "navigraphSubject",
      r.navigraph_username as "navigraphUsername",
      r.navigraph_connected_at as "navigraphConnectedAt",
      r.status,
      r.created_at as "createdAt",
      r.updated_at as "updatedAt",
      (select id from recorded_audit limit 1) as "auditId"
    from recovered r
  `);
  const [, result] = await db.batch([lock, operation] as const);
  const row = result.rows[0] as AdministrativeUpdateRow | undefined;
  if (!row?.id) return null;
  return rawMembership(row as RawMembershipRow);
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function rawMembership(row: RawMembershipRow): Membership {
  return {
    id: row.id,
    tenantId: row.tenantId,
    clerkUserId: row.clerkUserId,
    role: row.role,
    requestedRole: row.requestedRole,
    displayName: row.displayName,
    pilotCallsign: row.pilotCallsign,
    simbriefUserId: row.simbriefUserId,
    simbriefVerifiedAt: toDateOrNull(row.simbriefVerifiedAt),
    navigraphSubject: row.navigraphSubject,
    navigraphUsername: row.navigraphUsername,
    navigraphConnectedAt: toDateOrNull(row.navigraphConnectedAt),
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
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
