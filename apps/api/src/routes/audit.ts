import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { queryAuditEvents } from "../domain/audit/service.js";
import { writeAudit } from "../db/repositories/audit.js";

export const auditRoutes = new Hono<{ Variables: AppVariables }>();

const auditFilterFields = {
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  actorMembershipId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
};

const auditQuerySchema = z
  .object({
    ...auditFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be at or before to",
    path: ["to"],
  });

const auditExportSchema = z
  .object({
    ...auditFilterFields,
    limit: z.coerce.number().int().min(1).max(1_000).default(500),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be at or before to",
    path: ["to"],
  });

auditRoutes.use("/audit-events", requireAuth, requireRole("admin"));
auditRoutes.use("/audit-events/*", requireAuth, requireRole("admin"));

auditRoutes.get(
  "/audit-events",
  zValidator("query", auditQuerySchema),
  async (c) => {
    const auth = c.get("auth");
    const { limit, cursor, ...filters } = c.req.valid("query");
    const page = await queryAuditEvents({
      tenantId: auth.tenantId,
      filters,
      cursor,
      limit,
    });
    c.header("Cache-Control", "private, no-store");
    return c.json(page);
  },
);

auditRoutes.get(
  "/audit-events/export",
  zValidator("query", auditExportSchema),
  async (c) => {
    const auth = c.get("auth");
    const { limit, cursor, ...filters } = c.req.valid("query");
    const page = await queryAuditEvents({
      tenantId: auth.tenantId,
      filters,
      cursor,
      limit,
    });
    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "audit.exported",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: {
        filters: {
          ...filters,
          from: filters.from?.toISOString(),
          to: filters.to?.toISOString(),
        },
        requestedLimit: limit,
        returnedCount: page.items.length,
        continuedFromCursor: Boolean(cursor),
        hasNextPage: Boolean(page.nextCursor),
      },
    });
    c.header("Cache-Control", "private, no-store");
    c.header(
      "Content-Disposition",
      `attachment; filename="va-dispatch-audit-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return c.json({
      generatedAt: new Date().toISOString(),
      filters,
      itemCount: page.items.length,
      nextCursor: page.nextCursor,
      items: page.items,
    });
  },
);
