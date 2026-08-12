import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../client.js", () => ({
  getDb: () => ({ execute }),
}));

import { flights } from "../schema.js";
import { updateFlight } from "./flights.js";

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
});
