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

const flightBodySchema = z
  .object({
    pilotMembershipId: z.string().uuid().optional().nullable(),
    flightNumber: z.string().min(2).max(12),
    depIcao: icao,
    arrIcao: icao,
    etd: z.coerce.date(),
    eta: z.coerce.date(),
    aircraftType: z.string().max(20).optional().nullable(),
    status: z.enum(["draft", "offered"]).optional(),
    dispatcherNotes: z.string().max(2000).optional().nullable(),
  })
  .strict()
  .refine((value) => value.eta > value.etd, {
    message: "eta must be after etd",
    path: ["eta"],
  });

const bulkFlightItemSchema = z
  .object({
    flightNumber: z.string().min(2).max(12),
    depIcao: icao,
    arrIcao: icao,
    etd: z.coerce.date(),
    eta: z.coerce.date(),
    aircraftType: z.string().max(20).optional().nullable(),
    pilotMembershipId: z.string().uuid().optional().nullable(),
  })
  .refine((value) => value.eta > value.etd, {
    message: "eta must be after etd",
    path: ["eta"],
  });

const expectedVersionSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

const idempotencyHeaderSchema = z.object({
  "idempotency-key": z.string().trim().min(1).max(200),
});

const versionedReasonSchema = expectedVersionSchema.extend({
  reason: z.string().max(500).optional(),
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
  zValidator("header", idempotencyHeaderSchema),
  zValidator(
    "json",
    z.object({
      scheduleRequestId: z.string().uuid(),
      expectedRequestVersion: z.number().int().min(1),
      flights: z.array(bulkFlightItemSchema).min(1).max(50),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const result = await flightService.bulkCreateFlights(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      {
        ...body,
        idempotencyKey: c.req.valid("header")["idempotency-key"],
      },
    );
    return c.json(
      {
        flights: result.flights.map(serializeFlight),
        fulfillment: result.fulfillment,
      },
      201,
    );
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
  zValidator("json", expectedVersionSchema),
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
      "offered",
      body,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/accept",
  zValidator("json", expectedVersionSchema),
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
      "accepted",
      body,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/decline",
  zValidator("json", versionedReasonSchema),
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
      "declined",
      body,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/cancel",
  zValidator("json", versionedReasonSchema),
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
      "cancelled",
      body,
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
      expectedVersion: z.number().int().min(1),
      changeReason: z.string().trim().max(500).optional(),
      flightNumber: z.string().min(2).max(12).optional(),
      depIcao: icao.optional(),
      arrIcao: icao.optional(),
      etd: z.coerce.date().optional(),
      eta: z.coerce.date().optional(),
      aircraftType: z.string().trim().max(12).nullable().optional(),
      pilotMembershipId: z.string().uuid().nullable().optional(),
      dispatcherNotes: z.string().max(2000).nullable().optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const { expectedVersion, changeReason, ...patch } = body;
    const flight = await flightService.patchFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      expectedVersion,
      changeReason,
      patch,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/confirm-assignment",
  zValidator("json", expectedVersionSchema),
  async (c) => {
    const auth = c.get("auth");
    const flight = await flightService.confirmAssignment(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      c.req.valid("json").expectedVersion,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

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
      expectedVersion: z.number().int().min(1),
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
    const { expectedVersion, ...draft } = c.req.valid("json");
    const result = await flightService.publishDispatchRelease(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      expectedVersion,
      draft,
    );
    return c.json({
      flight: serializeFlight(result.flight),
      release: serializeRelease(result.release),
    });
  },
);

flightRoutes.post(
  "/flights/:id/start",
  zValidator("json", expectedVersionSchema),
  async (c) => {
    const auth = c.get("auth");
    const flight = await flightService.startFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      new Date(),
      c.req.valid("json").expectedVersion,
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/finish",
  zValidator("json", expectedVersionSchema),
  async (c) => {
    const auth = c.get("auth");
    const flight = await flightService.finishFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      new Date(),
      c.req.valid("json").expectedVersion,
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
      expectedVersion: z.number().int().min(1),
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
      { expectedVersion: body.expectedVersion, reason: body.reason },
    );
    return c.json({ flight: serializeFlight(flight) });
  },
);

flightRoutes.post(
  "/flights/:id/reoffer",
  requireRole("dispatcher"),
  zValidator(
    "json",
    expectedVersionSchema.extend({
      pilotMembershipId: z.string().uuid().optional().nullable(),
      reason: z.string().trim().min(1).max(500),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const flight = await flightService.reofferDeclinedFlight(
      {
        tenantId: auth.tenantId,
        membershipId: auth.membershipId,
        role: auth.role,
      },
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({ flight: serializeFlight(flight) }, 201);
  },
);

function serializeFlight(flight: Flight) {
  return {
    id: flight.id,
    scheduleRequestId: flight.scheduleRequestId,
    replacesFlightId: flight.replacesFlightId,
    pilotMembershipId: flight.pilotMembershipId,
    flightNumber: flight.flightNumber,
    depIcao: flight.depIcao,
    arrIcao: flight.arrIcao,
    etd: flight.etd.toISOString(),
    eta: flight.eta.toISOString(),
    aircraftType: flight.aircraftType,
    version: flight.version,
    status: flight.status,
    cancelReason: flight.cancelReason,
    declinedReason: flight.declinedReason,
    dispatcherNotes: flight.dispatcherNotes,
    assignmentRevision: flight.assignmentRevision,
    assignmentConfirmedRevision: flight.assignmentConfirmedRevision,
    assignmentConfirmedAt: flight.assignmentConfirmedAt?.toISOString() ?? null,
    assignmentConfirmationRequired:
      flightService.assignmentNeedsConfirmation(flight),
    outAt: flight.outAt?.toISOString() ?? null,
    offAt: flight.offAt?.toISOString() ?? null,
    onAt: flight.onAt?.toISOString() ?? null,
    inAt: flight.inAt?.toISOString() ?? null,
    createdAt: flight.createdAt.toISOString(),
    updatedAt: flight.updatedAt.toISOString(),
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
