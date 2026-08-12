import { Hono } from "hono";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getDispatchBoard } from "../domain/flights/service.js";
import { countScheduleRequestsByStatus } from "../db/repositories/schedule-requests.js";
import { listAcarsMessages } from "../db/repositories/acars.js";

export const dispatchRoutes = new Hono<{ Variables: AppVariables }>();

dispatchRoutes.use("*", requireAuth);
dispatchRoutes.use("*", requireRole("dispatcher"));

dispatchRoutes.get("/dispatch/board", async (c) => {
  const auth = c.get("auth");
  const [board, requestCounts] = await Promise.all([
    getDispatchBoard(auth.tenantId),
    countScheduleRequestsByStatus(auth.tenantId),
  ]);
  return c.json({
    flights: board.flights.map((flight) => ({
      id: flight.id,
      flightNumber: flight.flightNumber,
      depIcao: flight.depIcao,
      arrIcao: flight.arrIcao,
      etd: flight.etd.toISOString(),
      eta: flight.eta.toISOString(),
      status: flight.status,
      pilotMembershipId: flight.pilotMembershipId,
      aircraftType: flight.aircraftType,
    })),
    scheduleRequestCounts: requestCounts,
  });
});

dispatchRoutes.get("/dispatch/inbox", async (c) => {
  const auth = c.get("auth");
  const page = await listAcarsMessages({
    tenantId: auth.tenantId,
    limit: 50,
  });
  return c.json({
    items: page.items.map((message) => ({
      id: message.id,
      direction: message.direction,
      msgType: message.msgType,
      fromStation: message.fromStation,
      toStation: message.toStation,
      body: message.body,
      flightId: message.flightId,
      provider: message.provider,
      createdAt: message.createdAt.toISOString(),
      receivedAt: message.receivedAt?.toISOString() ?? null,
      sentAt: message.sentAt?.toISOString() ?? null,
    })),
    nextCursor: page.nextCursor,
  });
});
