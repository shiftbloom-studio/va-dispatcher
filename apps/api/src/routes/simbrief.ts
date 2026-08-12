import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { SimbriefDispatch } from "../db/schema.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import * as simbriefService from "../domain/simbrief/service.js";
import * as simbriefOauthService from "../domain/simbrief/oauth-service.js";
import {
  simbriefDispatchOptionsSchema,
  simbriefUserIdSchema,
} from "../domain/simbrief/validation.js";

const idParamsSchema = z.object({
  flightId: z.string().uuid(),
  dispatchId: z.string().uuid().optional(),
});

export const simbriefPublicRoutes = new Hono();
const noStorePublicCallback: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } finally {
    c.header("Cache-Control", "no-store");
  }
};
simbriefPublicRoutes.use("/simbrief/oauth/callback", noStorePublicCallback);
simbriefPublicRoutes.use("/simbrief/callback", noStorePublicCallback);

const navigraphOauthCallbackSchema = z
  .object({
    state: z.string().regex(/^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(4_096).optional(),
    error: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,64}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.code) === Boolean(value.error)) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of code or error is required",
      });
    }
  });

simbriefPublicRoutes.get(
  "/simbrief/oauth/callback",
  zValidator("query", navigraphOauthCallbackSchema),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const query = c.req.valid("query");
    const membership = await simbriefOauthService.completeNavigraphOauth(
      query.code
        ? { state: query.state, code: query.code }
        : { state: query.state, error: query.error! },
    );
    return c.json({ connection: serializeConnection(membership) });
  },
);

simbriefPublicRoutes.get(
  "/simbrief/callback",
  zValidator(
    "query",
    z.object({
      dispatchId: z.string().uuid(),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    }),
  ),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const query = c.req.valid("query");
    const dispatch = await simbriefService.completeDispatchCallback(
      query.dispatchId,
      query.token,
    );
    return c.json({
      dispatch: {
        id: dispatch.id,
        flightId: dispatch.flightId,
        status: dispatch.status,
        generatedAt: dispatch.generatedAt?.toISOString() ?? null,
      },
    });
  },
);

export const simbriefRoutes = new Hono<{ Variables: AppVariables }>();

simbriefRoutes.use("*", requireAuth);
simbriefRoutes.use("*", async (c, next) => {
  try {
    await next();
  } finally {
    c.header("Cache-Control", "private, no-store");
  }
});

simbriefRoutes.get("/simbrief/connection", async (c) => {
  const membership = await simbriefService.getConnection(actor(c));
  return c.json({ connection: serializeConnection(membership) });
});

simbriefRoutes.post("/simbrief/oauth/start", async (c) => {
  const result = await simbriefOauthService.startNavigraphOauth(actor(c));
  return c.json({
    authorizationUrl: result.authorizationUrl,
    redirectUri: result.redirectUri,
    expiresAt: result.expiresAt.toISOString(),
  });
});

simbriefRoutes.put(
  "/simbrief/connection",
  zValidator("json", z.object({ userId: simbriefUserIdSchema }).strict()),
  async (c) => {
    const body = c.req.valid("json");
    const membership = await simbriefService.connectAccount(
      actor(c),
      body.userId,
    );
    return c.json({ connection: serializeConnection(membership) });
  },
);

simbriefRoutes.delete("/simbrief/connection", async (c) => {
  const membership = await simbriefService.disconnectAccount(actor(c));
  return c.json({ connection: serializeConnection(membership) });
});

simbriefRoutes.post(
  "/flights/:flightId/simbrief/dispatches",
  zValidator("param", idParamsSchema.pick({ flightId: true })),
  zValidator("json", simbriefDispatchOptionsSchema.optional()),
  async (c) => {
    const result = await simbriefService.createDispatch(
      actor(c),
      c.req.valid("param").flightId,
      c.req.valid("json") ?? simbriefDispatchOptionsSchema.parse({}),
    );
    return c.json(
      {
        dispatch: serializeDispatch(result.dispatch),
        dispatchUrl: result.dispatchUrl,
      },
      201,
    );
  },
);

simbriefRoutes.get(
  "/flights/:flightId/simbrief",
  zValidator("param", idParamsSchema.pick({ flightId: true })),
  async (c) => {
    const dispatch = await simbriefService.getLatestDispatch(
      actor(c),
      c.req.valid("param").flightId,
    );
    return c.json({ dispatch: serializeDispatch(dispatch) });
  },
);

simbriefRoutes.get(
  "/flights/:flightId/simbrief/dispatches/:dispatchId",
  zValidator("param", idParamsSchema.required()),
  async (c) => {
    const params = c.req.valid("param");
    const dispatch = await simbriefService.getDispatch(
      actor(c),
      params.flightId,
      params.dispatchId,
    );
    return c.json({ dispatch: serializeDispatch(dispatch) });
  },
);

simbriefRoutes.post(
  "/flights/:flightId/simbrief/dispatches/:dispatchId/sync",
  zValidator("param", idParamsSchema.required()),
  async (c) => {
    const params = c.req.valid("param");
    const dispatch = await simbriefService.syncDispatch(
      actor(c),
      params.flightId,
      params.dispatchId,
    );
    return c.json({ dispatch: serializeDispatch(dispatch) });
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

function serializeConnection(membership: {
  simbriefUserId: string | null;
  simbriefVerifiedAt: Date | null;
  navigraphSubject: string | null;
  navigraphUsername: string | null;
  navigraphConnectedAt: Date | null;
}) {
  return {
    connected: Boolean(membership.simbriefUserId),
    userId: membership.simbriefUserId,
    verified: Boolean(membership.simbriefVerifiedAt),
    verifiedAt: membership.simbriefVerifiedAt?.toISOString() ?? null,
    oauth: {
      configured: simbriefOauthService.isNavigraphOauthConfigured(),
      connected: Boolean(membership.navigraphSubject),
      username: membership.navigraphUsername,
      connectedAt: membership.navigraphConnectedAt?.toISOString() ?? null,
    },
  };
}

function serializeDispatch(dispatch: SimbriefDispatch) {
  const { userid: _userId, pid: _pilotId, ...request } = dispatch.request;
  return {
    id: dispatch.id,
    flightId: dispatch.flightId,
    createdByMembershipId: dispatch.createdByMembershipId,
    staticId: dispatch.staticId,
    status: dispatch.status,
    request,
    ofp: dispatch.ofp,
    simbriefRequestId: dispatch.simbriefRequestId,
    generatedAt: dispatch.generatedAt?.toISOString() ?? null,
    syncedAt: dispatch.syncedAt?.toISOString() ?? null,
    lastError: dispatch.lastError,
    createdAt: dispatch.createdAt.toISOString(),
    updatedAt: dispatch.updatedAt.toISOString(),
  };
}
