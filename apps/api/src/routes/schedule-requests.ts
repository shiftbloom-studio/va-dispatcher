import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as scheduleService from "../domain/schedule-requests/service.js";
import { paginationQuerySchema } from "../lib/pagination.js";

export const scheduleRequestRoutes = new Hono<{ Variables: AppVariables }>();

scheduleRequestRoutes.use("/schedule-requests", requireAuth);
scheduleRequestRoutes.use("/schedule-requests/*", requireAuth);

const availabilityIntervalSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .refine((interval) => new Date(interval.endAt) > new Date(interval.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });

const createSchema = z.object({
  title: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  desiredFlightCount: z.number().int().min(1).max(50),
  preferences: z
    .object({
      availability: z.array(availabilityIntervalSchema).min(1).max(100),
    })
    .catchall(z.unknown()),
});

const expectedVersionSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

const editSchema = createSchema.extend({
  expectedVersion: z.number().int().min(1),
});

scheduleRequestRoutes.post(
  "/schedule-requests",
  zValidator("json", createSchema),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const scheduleRequest = await scheduleService.createRequest(
      { tenantId: auth.tenantId, membershipId: auth.membershipId },
      body,
    );
    return c.json({ request: serializeRequest(scheduleRequest) }, 201);
  },
);

scheduleRequestRoutes.get(
  "/schedule-requests",
  zValidator(
    "query",
    paginationQuerySchema.extend({
      status: z
        .enum([
          "pending",
          "in_review",
          "fulfilled",
          "partially_fulfilled",
          "rejected",
          "cancelled",
        ])
        .optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");
    const page = await scheduleService.listRequests(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      query,
    );
    return c.json({
      items: page.items.map(serializeRequest),
      nextCursor: page.nextCursor,
    });
  },
);

scheduleRequestRoutes.get("/schedule-requests/:id", async (c) => {
  const auth = c.get("auth");
  const requestDetail = await scheduleService.getRequest(
    auth.tenantId,
    c.req.param("id"),
    { membershipId: auth.membershipId, role: auth.role },
  );
  return c.json({
    request: serializeRequest(requestDetail.request),
    fulfillment: requestDetail.fulfillment,
  });
});

scheduleRequestRoutes.patch(
  "/schedule-requests/:id",
  zValidator("json", editSchema),
  async (c) => {
    const auth = c.get("auth");
    const { expectedVersion, ...input } = c.req.valid("json");
    const scheduleRequest = await scheduleService.editRequest(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      expectedVersion,
      input,
    );
    return c.json({ request: serializeRequest(scheduleRequest) });
  },
);

scheduleRequestRoutes.post(
  "/schedule-requests/:id/cancel",
  zValidator(
    "json",
    expectedVersionSchema.extend({
      linkedFlightAction: z.enum(["keep", "cancel_predeparture"]),
      reason: z.string().trim().max(500).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const scheduleRequest = await scheduleService.cancelRequest(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({ request: serializeRequest(scheduleRequest) });
  },
);

scheduleRequestRoutes.post(
  "/schedule-requests/:id/review",
  requireRole("dispatcher"),
  zValidator("json", expectedVersionSchema),
  async (c) => {
    const auth = c.get("auth");
    const scheduleRequest = await scheduleService.transitionRequest(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "in_review",
      c.req.valid("json"),
    );
    return c.json({ request: serializeRequest(scheduleRequest) });
  },
);

scheduleRequestRoutes.post(
  "/schedule-requests/:id/reject",
  requireRole("dispatcher"),
  zValidator(
    "json",
    expectedVersionSchema.extend({
      reason: z.string().trim().max(500).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const scheduleRequest = await scheduleService.transitionRequest(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "rejected",
      body,
    );
    return c.json({ request: serializeRequest(scheduleRequest) });
  },
);

function serializeRequest(scheduleRequest: {
  id: string;
  pilotMembershipId: string;
  title: string | null;
  notes: string | null;
  windowStart: Date;
  windowEnd: Date;
  desiredFlightCount: number;
  preferences: Record<string, unknown>;
  version: number;
  status: string;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: scheduleRequest.id,
    pilotMembershipId: scheduleRequest.pilotMembershipId,
    title: scheduleRequest.title,
    notes: scheduleRequest.notes,
    windowStart: scheduleRequest.windowStart.toISOString(),
    windowEnd: scheduleRequest.windowEnd.toISOString(),
    desiredFlightCount: scheduleRequest.desiredFlightCount,
    preferences: scheduleRequest.preferences,
    version: scheduleRequest.version,
    status: scheduleRequest.status,
    rejectReason: scheduleRequest.rejectReason,
    cancelReason: scheduleRequest.cancelReason,
    createdAt: scheduleRequest.createdAt.toISOString(),
    updatedAt: scheduleRequest.updatedAt.toISOString(),
  };
}
