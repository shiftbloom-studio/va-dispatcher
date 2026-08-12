import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as flightService from "../domain/flights/service.js";
import { paginationQuerySchema } from "../lib/pagination.js";
import type { Flight } from "../db/schema.js";

export const flightRoutes = new Hono<{ Variables: AppVariables }>();

flightRoutes.use("*", requireAuth);

const icao = z
  .string()
  .length(4)
  .transform((s) => s.toUpperCase());

const flightBodySchema = z.object({
  scheduleRequestId: z.string().uuid().optional().nullable(),
  pilotMembershipId: z.string().uuid().optional().nullable(),
  flightNumber: z.string().min(2).max(12),
  depIcao: icao,
  arrIcao: icao,
  etd: z.coerce.date(),
  eta: z.coerce.date(),
  aircraftType: z.string().max(20).optional().nullable(),
  status: z.enum(["draft", "offered"]).optional(),
  dispatcherNotes: z.string().max(2000).optional().nullable(),
});

flightRoutes.post(
  "/flights",
  requireRole("dispatcher"),
  zValidator("json", flightBodySchema),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const flight = await flightService.createFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      body,
    );
    return c.json({ flight: serializeFlight(flight) }, 201);
  },
);

flightRoutes.post(
  "/flights/bulk",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      scheduleRequestId: z.string().uuid(),
      flights: z
        .array(
          z.object({
            flightNumber: z.string().min(2).max(12),
            depIcao: icao,
            arrIcao: icao,
            etd: z.coerce.date(),
            eta: z.coerce.date(),
            aircraftType: z.string().max(20).optional().nullable(),
            pilotMembershipId: z.string().uuid().optional().nullable(),
          }),
        )
        .min(1)
        .max(50),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const flights = await flightService.bulkCreateFlights(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      body,
    );
    return c.json({ flights: flights.map(serializeFlight) }, 201);
  },
);

flightRoutes.get(
  "/flights",
  zValidator(
    "query",
    paginationQuerySchema.extend({
      status: z
        .string()
        .optional()
        .transform((v) =>
          v ? (v.split(",") as Flight["status"][]) : undefined,
        ),
      fromEtd: z.coerce.date().optional(),
      toEtd: z.coerce.date().optional(),
      scheduleRequestId: z.string().uuid().optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");
    const page = await flightService.listFlightsForActor(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      {
        status: query.status?.length === 1 ? query.status[0] : query.status,
        fromEtd: query.fromEtd,
        toEtd: query.toEtd,
        scheduleRequestId: query.scheduleRequestId,
        cursor: query.cursor,
        limit: query.limit,
      },
    );
    return c.json({
      items: page.items.map(serializeFlight),
      nextCursor: page.nextCursor,
    });
  },
);

flightRoutes.get("/flights/:id", async (c) => {
  const auth = c.get("auth");
  const flight = await flightService.getFlight(
    auth.tenantId,
    c.req.param("id"),
    { membershipId: auth.membershipId, role: auth.role },
  );
  return c.json({ flight: serializeFlight(flight) });
});

flightRoutes.post(
  "/flights/:id/offer",
  requireRole("dispatcher"),
  async (c) => {
    const auth = c.get("auth");
    const flight = await flightService.transitionFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "offered",
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post("/flights/:id/accept", async (c) => {
  const auth = c.get("auth");
  const flight = await flightService.transitionFlight(
    {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      role: auth.role,
    },
    c.req.param("id"),
    "accepted",
  );
  return c.json({ flight: serializeFlight(flight) });
});

flightRoutes.post(
  "/flights/:id/decline",
  zValidator(
    "json",
    z.object({ reason: z.string().max(500).optional() }).optional(),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json") ?? {};
    const flight = await flightService.transitionFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "declined",
      { reason: body.reason },
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/cancel",
  zValidator(
    "json",
    z.object({ reason: z.string().max(500).optional() }).optional(),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json") ?? {};
    const flight = await flightService.transitionFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      "cancelled",
      { reason: body.reason },
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.patch(
  "/flights/:id",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      flightNumber: z.string().min(2).max(12).optional(),
      depIcao: icao.optional(),
      arrIcao: icao.optional(),
      etd: z.coerce.date().optional(),
      eta: z.coerce.date().optional(),
      aircraftType: z.string().max(20).nullable().optional(),
      pilotMembershipId: z.string().uuid().nullable().optional(),
      dispatcherNotes: z.string().max(2000).nullable().optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const flight = await flightService.patchFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      body,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/status",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      status: z.enum(["briefed", "active", "completed", "cancelled"]),
      reason: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const flight = await flightService.transitionFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      body.status,
      { reason: body.reason },
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

function serializeFlight(f: Flight) {
  return {
    id: f.id,
    scheduleRequestId: f.scheduleRequestId,
    pilotMembershipId: f.pilotMembershipId,
    flightNumber: f.flightNumber,
    depIcao: f.depIcao,
    arrIcao: f.arrIcao,
    etd: f.etd.toISOString(),
    eta: f.eta.toISOString(),
    aircraftType: f.aircraftType,
    status: f.status,
    cancelReason: f.cancelReason,
    declinedReason: f.declinedReason,
    dispatcherNotes: f.dispatcherNotes,
    outAt: f.outAt?.toISOString() ?? null,
    offAt: f.offAt?.toISOString() ?? null,
    onAt: f.onAt?.toISOString() ?? null,
    inAt: f.inAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}
