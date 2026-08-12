import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { flights, memberships, scheduleRequests } from "./schema.js";

function expectCompositeForeignKey(
  table: PgTable,
  name: string,
  columns: string[],
  foreignColumns: string[],
) {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );
  expect(foreignKey).toBeDefined();
  expect(foreignKey?.reference().columns.map((column) => column.name)).toEqual(
    columns,
  );
  expect(
    foreignKey?.reference().foreignColumns.map((column) => column.name),
  ).toEqual(foreignColumns);
}

describe("tenant-coherent operational references", () => {
  it("exposes the composite unique targets required by PostgreSQL", () => {
    for (const [table, indexName] of [
      [memberships, "memberships_tenant_id_uidx"],
      [scheduleRequests, "schedule_requests_tenant_id_uidx"],
    ] as const) {
      const index = getTableConfig(table).indexes.find(
        (candidate) => candidate.config.name === indexName,
      );
      expect(index?.config.unique).toBe(true);
      expect(index?.config.columns).toHaveLength(2);
    }
  });

  it("binds request ownership and flight links to the same tenant", () => {
    expectCompositeForeignKey(
      scheduleRequests,
      "schedule_requests_tenant_pilot_fkey",
      ["tenant_id", "pilot_membership_id"],
      ["tenant_id", "id"],
    );
    expectCompositeForeignKey(
      flights,
      "flights_tenant_pilot_fkey",
      ["tenant_id", "pilot_membership_id"],
      ["tenant_id", "id"],
    );
    expectCompositeForeignKey(
      flights,
      "flights_tenant_schedule_request_fkey",
      ["tenant_id", "schedule_request_id"],
      ["tenant_id", "id"],
    );
  });
});
