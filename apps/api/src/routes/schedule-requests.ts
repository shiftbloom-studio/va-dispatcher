import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as scheduleService from "../domain/schedule-requests/service.js";
import { paginationQuerySchema } from "../lib/pagination.js";

export const scheduleRequestRoutes = new Hono<{ Variables: AppVariables }>();

scheduleRequestRoutes.use("*", requireAuth);

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
    flights: requestDetail.flights,
  });
});

scheduleRequestRoutes.post("/schedule-requests/:id/cancel", async (c) => {
  const auth = c.get("auth");
  const scheduleRequest = await scheduleService.transitionRequest(
    {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      role: auth.role,
    },
    c.req.param("id"),
    "cancelled",
  );
  return c.json({ request: serializeRequest(scheduleRequest) });
});

scheduleRequestRoutes.post(
  "/schedule-requests/:id/review",
  requireRole("dispatcher"),
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
    );
    return c.json({ request: serializeRequest(scheduleRequest) });
  },
);

scheduleRequestRoutes.post(
  "/schedule-requests/:id/reject",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({ reason: z.string().max(500).optional() }).optional(),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json") ?? {};
    const scheduleRequest = await scheduleService.transitionRequest(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "rejected",
      { reason: body.reason },
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
  status: string;
  rejectReason: string | null;
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
    status: scheduleRequest.status,
    rejectReason: scheduleRequest.rejectReason,
    createdAt: scheduleRequest.createdAt.toISOString(),
    updatedAt: scheduleRequest.updatedAt.toISOString(),
  };
}
