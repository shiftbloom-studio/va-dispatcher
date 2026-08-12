import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { Flight, FlightOooiEvent } from "../db/schema.js";
import * as telemetryService from "../domain/telemetry/service.js";
import {
  oooiCorrectionSchema,
  telemetryIngestSchema,
} from "../domain/telemetry/validation.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const telemetryClientRoutes = new Hono();

telemetryClientRoutes.post(
  "/telemetry/ingest",
  zValidator("json", telemetryIngestSchema),
  async (c) => {
    const result = await telemetryService.ingestTelemetry(
      c.req.header("Authorization"),
      c.req.valid("json"),
    );
    return c.json({
      accepted: true,
      flightId: result.current.flightId,
      sequence: result.current.sequence,
      receivedAt: result.current.sampleAt.toISOString(),
      presence: result.presence,
      oooiEvents: result.oooiEvents.map(serializeOooiEvent),
    });
  },
);

export const telemetryRoutes = new Hono<{ Variables: AppVariables }>();
telemetryRoutes.use("*", requireAuth);

telemetryRoutes.post(
  "/telemetry/devices",
  zValidator(
    "json",
    z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  ),
  async (c) => {
    const result = await telemetryService.createDevice(
      actor(c),
      c.req.valid("json").name,
    );
    return c.json(
      {
        device: serializeDevice(result.device),
        token: result.token,
        warning:
          "Copy this token now. It is shown once and cannot be recovered.",
      },
      201,
    );
  },
);

telemetryRoutes.get("/telemetry/devices", async (c) => {
  const devices = await telemetryService.listDevices(actor(c));
  return c.json({ items: devices.map(serializeDevice) });
});

telemetryRoutes.delete("/telemetry/devices/:id", async (c) => {
  const device = await telemetryService.revokeDevice(
    actor(c),
    c.req.param("id"),
  );
  return c.json({ device: serializeDevice(device) });
});

telemetryRoutes.get(
  "/flights/:id/telemetry",
  zValidator(
    "query",
    z.object({
      trackLimit: z.coerce.number().int().min(0).max(500).default(100),
    }),
  ),
  async (c) => {
    const result = await telemetryService.getFlightTelemetry(
      actor(c),
      c.req.param("id"),
      c.req.valid("query").trackLimit,
    );
    return c.json({
      presence: result.presence,
      current: result.current ? serializeTelemetry(result.current) : null,
      track: result.track.map(serializeTelemetry),
      oooiEvents: result.oooiEvents.map(serializeOooiEvent),
    });
  },
);

telemetryRoutes.get(
  "/dispatch/telemetry",
  requireRole("dispatcher"),
  async (c) => {
    const items = await telemetryService.listLiveTelemetry(actor(c));
    return c.json({
      items: items.map((item) => ({
        ...serializeTelemetry(item),
        presence: item.presence,
      })),
      generatedAt: new Date().toISOString(),
    });
  },
);

telemetryRoutes.patch(
  "/flights/:id/oooi",
  requireRole("dispatcher"),
  zValidator("json", oooiCorrectionSchema),
  async (c) => {
    const result = await telemetryService.correctOooi(
      actor(c),
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({
      flight: serializeFlightOooi(result.flight),
      oooiEvents: result.oooiEvents.map(serializeOooiEvent),
    });
  },
);

function actor(c: {
  get: (key: "auth") => {
    tenantId: string;
    membershipId: string;
    role: "pilot" | "dispatcher" | "admin";
  };
}) {
  const auth = c.get("auth");
  return {
    tenantId: auth.tenantId,
    membershipId: auth.membershipId,
    role: auth.role,
  };
}

function serializeDevice(device: {
  id: string;
  name: string;
  status: "active" | "revoked";
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  };
}

function serializeTelemetry(item: {
  flightId: string;
  membershipId: string;
  phase: string;
  latitude: number;
  longitude: number;
  altitudeFeet: number;
  groundSpeedKnots: number;
  headingDegrees: number;
  simulatorTime: Date;
  sampleAt: Date;
  sequence: number;
}) {
  return {
    flightId: item.flightId,
    membershipId: item.membershipId,
    phase: item.phase,
    latitude: item.latitude,
    longitude: item.longitude,
    altitudeFeet: item.altitudeFeet,
    groundSpeedKnots: item.groundSpeedKnots,
    headingDegrees: item.headingDegrees,
    simulatorTime: item.simulatorTime.toISOString(),
    sampleAt: item.sampleAt.toISOString(),
    sequence: item.sequence,
  };
}

function serializeOooiEvent(event: FlightOooiEvent) {
  return {
    id: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt?.toISOString() ?? null,
    source: event.source,
    actorMembershipId: event.actorMembershipId,
    deviceId: event.deviceId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  };
}

function serializeFlightOooi(flight: Flight) {
  return {
    id: flight.id,
    outAt: flight.outAt?.toISOString() ?? null,
    offAt: flight.offAt?.toISOString() ?? null,
    onAt: flight.onAt?.toISOString() ?? null,
    inAt: flight.inAt?.toISOString() ?? null,
  };
}
