import { getDb } from "../client.js";
import { auditEvents } from "../schema.js";

export async function writeAudit(input: {
  tenantId: string;
  actorMembershipId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    meta: input.meta ?? {},
  });
}
