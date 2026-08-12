import { Hono } from "hono";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getDispatchBoard } from "../domain/flights/service.js";
import { countScheduleRequestsByStatus } from "../db/repositories/schedule-requests.js";
import { listAcarsMessages } from "../db/repositories/acars.js";

export const dispatchRoutes = new Hono<{ Variables: AppVariables }>();

dispatchRoutes.use("/dispatch/*", requireAuth);
dispatchRoutes.use("/dispatch/*", requireRole("dispatcher"));

dispatchRoutes.get("/dispatch/board", async (c) => {
  const auth = c.get("auth");
  const [board, requestCounts] = await Promise.all([
    getDispatchBoard(auth.tenantId),
    countScheduleRequestsByStatus(auth.tenantId),
  ]);
  return c.json({
    flights: board.flights.map((item) => ({
      id: item.flight.id,
      flightNumber: item.flight.flightNumber,
      depIcao: item.flight.depIcao,
      arrIcao: item.flight.arrIcao,
      etd: item.flight.etd.toISOString(),
      eta: item.flight.eta.toISOString(),
      status: item.flight.status,
      boardLane: item.lane,
      pilotMembershipId: item.flight.pilotMembershipId,
      aircraftType: item.flight.aircraftType,
      dispatcherNotes: item.flight.dispatcherNotes,
      assignmentRevision: item.flight.assignmentRevision,
      assignmentConfirmedRevision: item.flight.assignmentConfirmedRevision,
      assignmentConfirmedAt:
        item.flight.assignmentConfirmedAt?.toISOString() ?? null,
      assignmentConfirmationRequired: item.assignmentConfirmationRequired,
      latestReleaseRevision: item.latestReleaseRevision,
      outAt: item.flight.outAt?.toISOString() ?? null,
      inAt: item.flight.inAt?.toISOString() ?? null,
    })),
    metrics: board.metrics,
    boardWindow: {
      generatedAt: board.window.generatedAt.toISOString(),
      overdueFrom: board.window.overdueFrom.toISOString(),
      upcomingTo: board.window.upcomingTo.toISOString(),
      overdueLookbackHours: board.window.overdueLookbackHours,
      upcomingHorizonDays: board.window.upcomingHorizonDays,
    },
    scheduleRequestCounts: requestCounts,
  });
});

dispatchRoutes.get("/dispatch/inbox", async (c) => {
  c.header("Cache-Control", "private, no-store");
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
      deliveryStatus:
        message.deliveryStatus ??
        (message.direction === "outbound"
          ? message.sentAt
            ? "accepted"
            : "ambiguous"
          : null),
      createdAt: message.createdAt.toISOString(),
      receivedAt: message.receivedAt?.toISOString() ?? null,
      sentAt: message.sentAt?.toISOString() ?? null,
    })),
    nextCursor: page.nextCursor,
  });
});
