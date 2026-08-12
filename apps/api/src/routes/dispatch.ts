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
    flights: board.flights.map((f) => ({
      id: f.id,
      flightNumber: f.flightNumber,
      depIcao: f.depIcao,
      arrIcao: f.arrIcao,
      etd: f.etd.toISOString(),
      eta: f.eta.toISOString(),
      status: f.status,
      pilotMembershipId: f.pilotMembershipId,
      aircraftType: f.aircraftType,
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
    items: page.items.map((m) => ({
      id: m.id,
      direction: m.direction,
      msgType: m.msgType,
      fromStation: m.fromStation,
      toStation: m.toStation,
      body: m.body,
      flightId: m.flightId,
      provider: m.provider,
      createdAt: m.createdAt.toISOString(),
      receivedAt: m.receivedAt?.toISOString() ?? null,
      sentAt: m.sentAt?.toISOString() ?? null,
    })),
    nextCursor: page.nextCursor,
  });
});
