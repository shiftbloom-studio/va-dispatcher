import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../client.js", () => ({
  getDb: () => ({ execute }),
}));

import { flights } from "../schema.js";
import {
  createFlight,
  createReplacementFlight,
  fulfillScheduleRequest,
  updateFlight,
} from "./flights.js";

describe("flight repository concurrency boundary", () => {
  it("creates an ad-hoc flight and its actor audit atomically", async () => {
    execute.mockRejectedValueOnce(new Error("synthetic audit insert failure"));

    await expect(
      createFlight({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        actorMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        pilotMembershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        flightNumber: "SK101",
        depIcao: "EKCH",
        arrIcao: "ENGM",
        etd: new Date("2026-09-10T08:00:00.000Z"),
        eta: new Date("2026-09-10T09:30:00.000Z"),
        status: "offered",
      }),
    ).rejects.toThrow("synthetic audit insert failure");

    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(
      /with "?inserted"? as \(\s*insert into "flights"/i,
    );
    expect(query.sql).toMatch(/insert into "audit_events"/i);
    expect(query.sql).toContain("'flight.create'");
    expect(query.sql).toMatch(/inner join "?audited"?/i);
    // A rejected audit CTE rejects the entire creation statement.
  });

  it("executes compare-and-set mutation and audit as one atomic statement", async () => {
    execute.mockRejectedValueOnce(new Error("synthetic audit insert failure"));

    await expect(
      updateFlight({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expectedVersion: 3,
        actorMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        action: "flight.patch",
        auditMeta: { changedFields: ["eta"] },
        patch: { eta: new Date("2026-09-10T10:00:00.000Z") },
      }),
    ).rejects.toThrow("synthetic audit insert failure");

    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toMatch(/with "?updated"? as \(\s*update "flights"/i);
    expect(query.sql).toMatch(
      /"?audited"? as \(\s*insert into "audit_events"/i,
    );
    expect(query.sql).toMatch(/inner join "?audited"?/i);
    expect(query.sql).toContain('"version" = "flights"."version" + 1');
    // PostgreSQL rolls back the complete statement if the audit CTE fails;
    // there is no fallback update or second mutation call to leave a gap.
  });

  it("uses a composite tenant-safe self-reference for replacements", () => {
    const config = getTableConfig(flights);
    const foreignKey = config.foreignKeys.find(
      (candidate) => candidate.getName() === "flights_tenant_replaces_fkey",
    );
    expect(foreignKey).toBeDefined();
    expect(
      foreignKey?.reference().columns.map((column) => column.name),
    ).toEqual(["tenant_id", "replaces_flight_id"]);
    expect(
      foreignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["tenant_id", "id"]);
  });

  it("creates at most one replacement without rewriting the terminal source", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      createReplacementFlight({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceFlightId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expectedVersion: 3,
        actorMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        scheduleRequestId: null,
        oldPilotMembershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        pilotMembershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        flightNumber: "SK900",
        depIcao: "ESSA",
        arrIcao: "EKCH",
        etd: new Date("2026-09-10T08:00:00.000Z"),
        eta: new Date("2026-09-10T09:00:00.000Z"),
        aircraftType: "A320",
        dispatcherNotes: "Synthetic test",
        reason: "Availability restored",
      }),
    ).resolves.toBeNull();

    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toMatch(
      /with "?inserted"? as \(\s*insert into "flights"/i,
    );
    expect(query.sql).toMatch(/from "flights"\s+where/i);
    expect(query.sql).not.toMatch(/update "flights"/i);
    expect(query.sql).toMatch(
      /on conflict \(tenant_id, replaces_flight_id\) do nothing/i,
    );

    const replacementIndex = getTableConfig(flights).indexes.find(
      (candidate) => candidate.config.name === "flights_tenant_replaces_uidx",
    );
    expect(replacementIndex?.config.unique).toBe(true);
    expect(replacementIndex?.config.columns).toHaveLength(2);
    // The source remains byte-for-byte unchanged. Concurrent INSERTs race on
    // the unique lineage; exactly one can return a row and create its audit.
  });

  it("locks capacity and fulfills a complete batch with request and audits atomically", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      fulfillScheduleRequest({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scheduleRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        idempotencyKey: "batch-001",
        payloadHash: "a".repeat(64),
        expectedRequestVersion: 2,
        expectedRequestStatus: "partially_fulfilled",
        actorMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        flights: [
          {
            flightNumber: "SK901",
            depIcao: "ESSA",
            arrIcao: "EKCH",
            etd: new Date("2026-09-10T08:00:00.000Z"),
            eta: new Date("2026-09-10T09:00:00.000Z"),
            aircraftType: "A320",
          },
        ],
      }),
    ).resolves.toBeNull();

    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(/with "?request_locked"? as \(\s*select/i);
    expect(query.sql).toMatch(/for update of "schedule_requests"/i);
    expect(query.sql).toMatch(
      /having[\s\S]*<= request_locked\.desired_flight_count/i,
    );
    expect(query.sql).toMatch(/insert into "schedule_fulfillment_attempts"/i);
    expect(query.sql).toMatch(
      /on conflict \(\s*tenant_id,\s*schedule_request_id,\s*idempotency_key\s*\) do nothing/i,
    );
    expect(query.sql.toLowerCase().indexOf("having")).toBeLessThan(
      query.sql
        .toLowerCase()
        .indexOf('insert into "schedule_fulfillment_attempts"'),
    );
    expect(query.sql).toMatch(/insert into "flights"/i);
    expect(query.sql).toMatch(/update "schedule_requests"/i);
    expect(query.sql).toMatch(/insert into "audit_events"/i);
    expect(query.sql).toContain("'schedule_request.fulfillment_progress'");
    expect(query.sql).toContain("'flight.bulk_create'");
    expect(query.sql).toContain("'fromVersion'");
    expect(query.sql).toContain("'toVersion'");
    expect(query.sql).toContain("'requestFromVersion'");
    expect(query.sql).toContain("'requestToVersion'");
    expect(query.sql).toMatch(/where audit_totals\.count = 2/i);
  });

  it("cannot leave inserted fulfillment flights behind when auditing fails", async () => {
    execute.mockRejectedValueOnce(
      new Error("synthetic fulfillment audit failure"),
    );

    await expect(
      fulfillScheduleRequest({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scheduleRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        idempotencyKey: "batch-002",
        payloadHash: "b".repeat(64),
        expectedRequestVersion: 1,
        expectedRequestStatus: "in_review",
        actorMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        flights: [
          {
            flightNumber: "SK901",
            depIcao: "ESSA",
            arrIcao: "EKCH",
            etd: new Date("2026-09-10T08:00:00.000Z"),
            eta: new Date("2026-09-10T09:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toThrow("synthetic fulfillment audit failure");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
