import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../client.js", () => ({
  getDb: () => ({ execute }),
}));

import {
  cancelScheduleRequest,
  createScheduleRequest,
  updateScheduleRequest,
} from "./schedule-requests.js";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actorMembershipId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("schedule request repository concurrency boundary", () => {
  beforeEach(() => execute.mockReset());

  it("creates a request and its actor audit atomically", async () => {
    execute.mockRejectedValueOnce(new Error("synthetic audit failure"));

    await expect(
      createScheduleRequest({
        tenantId,
        pilotMembershipId: actorMembershipId,
        actorMembershipId,
        title: "September request",
        windowStart: new Date("2026-09-10T08:00:00.000Z"),
        windowEnd: new Date("2026-09-10T12:00:00.000Z"),
        desiredFlightCount: 1,
        preferences: {
          availability: [
            {
              startAt: "2026-09-10T08:00:00.000Z",
              endAt: "2026-09-10T12:00:00.000Z",
            },
          ],
        },
      }),
    ).rejects.toThrow("synthetic audit failure");

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(
      /with "?inserted"? as \(\s*insert into "schedule_requests"/i,
    );
    expect(query.sql).toMatch(/insert into "audit_events"/i);
    expect(query.sql).toContain("'schedule_request.create'");
    expect(query.sql).toMatch(/inner join "?audited"?/i);
    expect(execute).toHaveBeenCalledTimes(1);
    // One data-modifying statement means a rejected audit also rejects the
    // request insert; no unaudited request can remain committed.
  });

  it("edits only the expected pending version and audits atomically", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateScheduleRequest({
        tenantId,
        id: requestId,
        expectedVersion: 4,
        expectedStatus: "pending",
        actorMembershipId,
        action: "schedule_request.edited",
        auditMeta: { changedFields: ["windowStart"] },
        patch: {
          title: "Revised availability",
          notes: null,
          windowStart: new Date("2026-09-10T08:00:00.000Z"),
          windowEnd: new Date("2026-09-10T12:00:00.000Z"),
          desiredFlightCount: 2,
          preferences: {
            availability: [
              {
                startAt: "2026-09-10T08:00:00.000Z",
                endAt: "2026-09-10T12:00:00.000Z",
              },
            ],
          },
        },
      }),
    ).resolves.toBeNull();

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(
      /with "?updated"? as \(\s*update "schedule_requests"/i,
    );
    expect(query.sql).toContain(
      '"version" = "schedule_requests"."version" + 1',
    );
    expect(query.sql).toContain('"status" = $');
    expect(query.sql).toMatch(/not exists \(\s*select 1\s*from "flights"/i);
    expect(query.sql).toMatch(/insert into "audit_events"/i);
    expect(query.sql).toMatch(/inner join "?audited"?/i);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("cancels only pre-departure linked flights with per-row audits", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      cancelScheduleRequest({
        tenantId,
        id: requestId,
        expectedVersion: 2,
        expectedStatus: "partially_fulfilled",
        actorMembershipId,
        linkedFlightAction: "cancel_predeparture",
        reason: "Pilot unavailable",
      }),
    ).resolves.toBeNull();

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(
      /update "schedule_requests"[\s\S]*"version" = "schedule_requests"\."version" \+ 1/i,
    );
    expect(query.sql).toMatch(
      /"flights"\."status" in \('draft', 'offered', 'accepted', 'briefed'\)/i,
    );
    expect(query.sql).not.toMatch(/"flights"\."status" in \([^)]*'active'/i);
    expect(query.sql).toMatch(
      /update "flights"[\s\S]*"version" = "flights"\."version" \+ 1/i,
    );
    expect(query.sql).toContain("'schedule_request_cancellation'");
    expect(query.sql).toContain("'fromVersion'");
    expect(query.sql).toContain("'toVersion'");
    expect(query.params).toContain(
      JSON.stringify({
        from: "partially_fulfilled",
        to: "cancelled",
        fromVersion: 2,
        toVersion: 3,
        reason: "Pilot unavailable",
        linkedFlightAction: "cancel_predeparture",
        linkedFlightPolicy:
          "cancel draft, offered, accepted, and briefed; preserve active and terminal flights",
      }),
    );
    expect(query.sql).toMatch(/from cancelled_flights/i);
    expect(query.sql).toMatch(/audit_totals\.count = cancelled_totals\.count/i);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rolls back request and flight cancellation when an audit insert fails", async () => {
    execute.mockRejectedValueOnce(new Error("synthetic audit failure"));

    await expect(
      cancelScheduleRequest({
        tenantId,
        id: requestId,
        expectedVersion: 1,
        expectedStatus: "in_review",
        actorMembershipId,
        linkedFlightAction: "keep",
      }),
    ).rejects.toThrow("synthetic audit failure");
    expect(execute).toHaveBeenCalledTimes(1);
    // PostgreSQL treats all data-modifying CTEs as one statement, so either
    // both lifecycle mutations and every audit commit, or none of them do.
  });
});
