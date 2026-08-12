import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { SimbriefDispatch } from "../db/schema.js";
import { findTenantById } from "../db/repositories/tenants.js";
import { env } from "../env.js";
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
    state: z
      .string()
      .regex(/^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{58}$/),
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
    const redirect = await callbackRedirect(
      membership.tenantId,
      "/settings?simbrief=navigraph-connected",
    );
    return redirect
      ? c.redirect(redirect, 303)
      : c.json({ connection: serializeConnection(membership) });
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
    const redirect = await callbackRedirect(
      dispatch.tenantId,
      `/portal/flights/${dispatch.flightId}?simbrief=ready`,
    );
    if (redirect) return c.redirect(redirect, 303);
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
    const dispatch = await simbriefService.prepareDispatch(
      actor(c),
      c.req.valid("param").flightId,
      c.req.valid("json") ?? simbriefDispatchOptionsSchema.parse({}),
    );
    return c.json({ dispatch: serializeDispatch(dispatch) }, 201);
  },
);

simbriefRoutes.get(
  "/flights/:flightId/simbrief/dispatches",
  zValidator("param", idParamsSchema.pick({ flightId: true })),
  async (c) => {
    const dispatches = await simbriefService.listDispatches(
      actor(c),
      c.req.valid("param").flightId,
    );
    return c.json({ items: dispatches.map(serializeDispatch) });
  },
);

simbriefRoutes.post(
  "/flights/:flightId/simbrief/dispatches/:dispatchId/generate",
  zValidator("param", idParamsSchema.required()),
  async (c) => {
    const params = c.req.valid("param");
    const result = await simbriefService.generateDispatch(
      actor(c),
      params.flightId,
      params.dispatchId,
    );
    return c.json({
      dispatch: serializeDispatch(result.dispatch),
      dispatchUrl: result.dispatchUrl,
    });
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
  const {
    userid: _userId,
    pid: _pilotId,
    dxname: dispatcherName,
    manualrmk: dispatcherRemarks,
    ...request
  } = dispatch.request;
  return {
    id: dispatch.id,
    flightId: dispatch.flightId,
    preparedByMembershipId: dispatch.createdByMembershipId,
    generatedByMembershipId: dispatch.generatedByMembershipId,
    dispatcherName: dispatcherName ?? "VA Dispatcher",
    dispatcherRemarks: dispatcherRemarks ?? null,
    staticId: dispatch.staticId,
    status: dispatch.status,
    revision: dispatch.revision,
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

async function callbackRedirect(
  tenantId: string,
  tenantPath: string,
): Promise<string | null> {
  const origin = env().APP_ORIGIN;
  if (!origin) return null;
  const tenant = await findTenantById(tenantId);
  if (!tenant) return null;
  const url = new URL(`/${tenant.slug}${tenantPath}`, origin);
  if (env().NODE_ENV === "production" && url.protocol !== "https:") {
    return null;
  }
  return url.toString();
}
