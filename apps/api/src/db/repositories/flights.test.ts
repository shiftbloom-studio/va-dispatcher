import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../client.js", () => ({
  getDb: () => ({ execute }),
}));

import { flights } from "../schema.js";
import { createReplacementFlight, updateFlight } from "./flights.js";

describe("flight repository concurrency boundary", () => {
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
});
