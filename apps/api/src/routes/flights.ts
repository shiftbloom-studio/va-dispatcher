import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as flightService from "../domain/flights/service.js";
import { paginationQuerySchema } from "../lib/pagination.js";
import type {
  DispatchRelease,
  Flight,
  FlightOperationalEvent,
} from "../db/schema.js";

export const flightRoutes = new Hono<{ Variables: AppVariables }>();

flightRoutes.use("*", requireAuth);

const icao = z
  .string()
  .length(4)
  .transform((value) => value.toUpperCase());

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
        .transform((value) =>
          value ? (value.split(",") as Flight["status"][]) : undefined,
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
  const detail = await flightService.getFlightDetail(
    auth.tenantId,
    c.req.param("id"),
    { membershipId: auth.membershipId, role: auth.role },
  );
  return c.json({
    flight: serializeFlight(detail.flight),
    release: detail.release ? serializeRelease(detail.release) : null,
    releaseRevisions: detail.releaseRevisions.map(serializeRelease),
    events: detail.events.map(serializeEvent),
  });
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
      pilotMembershipId: z.string().uuid().nullable().optional(),
      dispatcherNotes: z.string().max(2000).nullable().optional(),
      expectedUpdatedAt: z.coerce.date().optional(),
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

flightRoutes.post("/flights/:id/confirm-assignment", async (c) => {
  const auth = c.get("auth");
  const flight = await flightService.confirmAssignment(
    {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      role: auth.role,
    },
    c.req.param("id"),
  );
  return c.json({ flight: serializeFlight(flight) });
});

const releaseAmount = z.number().int().nonnegative().max(10_000_000);
const positiveReleaseAmount = releaseAmount.refine((value) => value > 0, {
  message: "Must be greater than zero",
});

flightRoutes.post(
  "/flights/:id/release",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      operationalRoute: z.string().trim().min(1).max(1000),
      sid: z.string().trim().max(40).nullable().optional(),
      star: z.string().trim().max(40).nullable().optional(),
      cruiseLevel: z.number().int().min(10).max(600),
      alternateIcao: icao,
      fuelUnit: z.enum(["kg", "lb"]),
      payloadUnit: z.enum(["kg", "lb"]),
      taxiFuel: releaseAmount,
      tripFuel: positiveReleaseAmount,
      contingencyFuel: releaseAmount,
      alternateFuel: releaseAmount,
      finalReserveFuel: releaseAmount,
      additionalFuel: releaseAmount.default(0),
      blockFuel: positiveReleaseAmount,
      plannedPayload: releaseAmount,
      releaseNotes: z.string().max(4000).nullable().optional(),
      dispatcherRemarks: z.string().max(4000).nullable().optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const result = await flightService.publishDispatchRelease(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({
      flight: serializeFlight(result.flight),
      release: serializeRelease(result.release),
    });
  },
);

flightRoutes.post("/flights/:id/start", async (c) => {
  const auth = c.get("auth");
  const flight = await flightService.startFlight(
    {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      role: auth.role,
    },
    c.req.param("id"),
  );
  return c.json({ flight: serializeFlight(flight) });
});

flightRoutes.post("/flights/:id/finish", async (c) => {
  const auth = c.get("auth");
  const flight = await flightService.finishFlight(
    {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      role: auth.role,
    },
    c.req.param("id"),
  );
  return c.json({ flight: serializeFlight(flight) });
});

flightRoutes.post(
  "/flights/:id/status",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      status: z.enum(["active", "completed", "cancelled"]),
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
    assignmentRevision: f.assignmentRevision,
    assignmentConfirmedRevision: f.assignmentConfirmedRevision,
    assignmentConfirmedAt: f.assignmentConfirmedAt?.toISOString() ?? null,
    assignmentConfirmationRequired:
      flightService.assignmentNeedsConfirmation(f),
    outAt: f.outAt?.toISOString() ?? null,
    offAt: f.offAt?.toISOString() ?? null,
    onAt: f.onAt?.toISOString() ?? null,
    inAt: f.inAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function serializeRelease(release: DispatchRelease) {
  return {
    id: release.id,
    flightId: release.flightId,
    revision: release.revision,
    operationalRoute: release.operationalRoute,
    sid: release.sid,
    star: release.star,
    cruiseLevel: release.cruiseLevel,
    alternateIcao: release.alternateIcao,
    fuelUnit: release.fuelUnit,
    payloadUnit: release.payloadUnit,
    taxiFuel: release.taxiFuel,
    tripFuel: release.tripFuel,
    contingencyFuel: release.contingencyFuel,
    alternateFuel: release.alternateFuel,
    finalReserveFuel: release.finalReserveFuel,
    additionalFuel: release.additionalFuel,
    blockFuel: release.blockFuel,
    plannedPayload: release.plannedPayload,
    weatherSnapshot: release.weatherSnapshot,
    releaseNotes: release.releaseNotes,
    dispatcherRemarks: release.dispatcherRemarks,
    releasedByMembershipId: release.releasedByMembershipId,
    releasedAt: release.releasedAt.toISOString(),
  };
}

function serializeEvent(event: FlightOperationalEvent) {
  return {
    id: event.id,
    kind: event.kind,
    source: event.source,
    occurredAt: event.occurredAt.toISOString(),
    actorMembershipId: event.actorMembershipId,
    acarsMessageId: event.acarsMessageId,
    meta: event.meta,
  };
}
