import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as acarsService from "../domain/acars/service.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { paginationQuerySchema } from "../lib/pagination.js";

export const acarsRoutes = new Hono<{ Variables: AppVariables }>();

acarsRoutes.use("/acars/*", requireAuth);

acarsRoutes.get(
  "/acars/messages",
  requireRole("dispatcher"),
  zValidator(
    "query",
    paginationQuerySchema.extend({
      direction: z.enum(["inbound", "outbound"]).optional(),
      flightId: z.string().uuid().optional(),
      station: z.string().optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");
    const page = await acarsService.listMessages({
      tenantId: auth.tenantId,
      ...query,
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
  },
);

acarsRoutes.get("/acars/messages/:id", requireRole("dispatcher"), async (c) => {
  const auth = c.get("auth");
  const message = await acarsService.getMessage(
    auth.tenantId,
    c.req.param("id"),
  );
  return c.json({
    message: {
      id: message.id,
      direction: message.direction,
      msgType: message.msgType,
      fromStation: message.fromStation,
      toStation: message.toStation,
      body: message.body,
      hoppieRaw: message.hoppieRaw,
      flightId: message.flightId,
      provider: message.provider,
      createdAt: message.createdAt.toISOString(),
    },
  });
});

acarsRoutes.post(
  "/acars/messages",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      to: acarsStationSchema,
      body: z.string().min(1).max(4000),
      flightId: z.string().uuid().optional().nullable(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const message = await acarsService.sendTelex({
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      to: body.to,
      body: body.body,
      flightId: body.flightId,
    });
    return c.json(
      {
        message: {
          id: message.id,
          direction: message.direction,
          fromStation: message.fromStation,
          toStation: message.toStation,
          body: message.body,
          provider: message.provider,
          sentAt: message.sentAt?.toISOString() ?? null,
        },
      },
      201,
    );
  },
);

acarsRoutes.post(
  "/acars/simulate",
  requireRole("dispatcher"),
  zValidator(
    "json",
    z.object({
      from: acarsStationSchema,
      to: acarsStationSchema.optional(),
      body: z.string().min(1).max(4000),
      msgType: z
        .enum(["telex", "progress", "cpdlc", "position", "other"])
        .optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const simulationResult = await acarsService.simulateInbound({
      tenantId: auth.tenantId,
      ...body,
    });
    return c.json(simulationResult, 201);
  },
);
