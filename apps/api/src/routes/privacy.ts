import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as privacyService from "../domain/privacy/service.js";
import { retentionPolicyConfigSchema } from "../domain/privacy/policy.js";

export const privacyRoutes = new Hono<{ Variables: AppVariables }>();

privacyRoutes.use("/privacy/*", async (context, next) => {
  try {
    await next();
  } finally {
    context.header("Cache-Control", "private, no-store");
  }
});
privacyRoutes.use("/privacy/*", requireAuth, requireRole("admin"));

const idParamSchema = z.object({ id: z.string().uuid() });

privacyRoutes.get("/privacy/policies/active", async (context) => {
  const auth = context.get("auth");
  const policy = await privacyService.getActivePolicy(auth.tenantId);
  return context.json({ policy });
});

privacyRoutes.post(
  "/privacy/policies",
  zValidator(
    "json",
    z.object({ config: retentionPolicyConfigSchema }).strict(),
  ),
  async (context) => {
    const auth = context.get("auth");
    const policy = await privacyService.createPolicy({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      config: context.req.valid("json").config,
    });
    return context.json({ policy }, 201);
  },
);

privacyRoutes.post(
  "/privacy/policies/:id/approve",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const policy = await privacyService.approvePolicy({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      policyId: context.req.valid("param").id,
    });
    return context.json({ policy });
  },
);

privacyRoutes.post(
  "/privacy/retention/runs",
  zValidator(
    "json",
    z
      .object({
        mode: z.enum(["dry_run", "execute"]),
        idempotencyKey: z.string().trim().min(8).max(120),
        dryRunId: z.string().uuid().optional(),
        confirmation: z.string().optional(),
      })
      .strict(),
  ),
  async (context) => {
    const auth = context.get("auth");
    const body = context.req.valid("json");
    const run = await privacyService.queueRetentionRun({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      ...body,
    });
    return context.json({ run }, 202);
  },
);

privacyRoutes.get(
  "/privacy/retention/runs/:id",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const result = await privacyService.getRetentionRun(
      auth.tenantId,
      context.req.valid("param").id,
    );
    return context.json(result);
  },
);

privacyRoutes.post(
  "/privacy/retention/runs/:id/retry",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const run = await privacyService.retryRun({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      runId: context.req.valid("param").id,
    });
    return context.json({ run }, 202);
  },
);

privacyRoutes.post(
  "/privacy/requests",
  zValidator("json", privacyService.privacyRequestPayloadSchema),
  async (context) => {
    const auth = context.get("auth");
    const request = await privacyService.createSubjectRequest({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      request: context.req.valid("json"),
    });
    return context.json({ request }, 201);
  },
);

privacyRoutes.get(
  "/privacy/requests/:id",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    return context.json(
      await privacyService.getSubjectRequest(
        auth.tenantId,
        context.req.valid("param").id,
      ),
    );
  },
);

privacyRoutes.post(
  "/privacy/requests/:id/verify",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const request = await privacyService.verifySubjectRequest({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      requestId: context.req.valid("param").id,
    });
    return context.json({ request });
  },
);

privacyRoutes.post(
  "/privacy/requests/:id/approve",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const request = await privacyService.approveSubjectRequest({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      requestId: context.req.valid("param").id,
    });
    return context.json({ request });
  },
);

privacyRoutes.post(
  "/privacy/requests/:id/retry",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const request = await privacyService.retrySubjectRequest({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      requestId: context.req.valid("param").id,
    });
    return context.json({ request });
  },
);

privacyRoutes.post(
  "/privacy/requests/:id/process",
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({ confirmation: z.string().optional() }).strict().default({}),
  ),
  async (context) => {
    const auth = context.get("auth");
    const result = await privacyService.processSubjectRequest({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      requestId: context.req.valid("param").id,
      confirmation: context.req.valid("json").confirmation,
    });
    return context.json(result);
  },
);

privacyRoutes.get(
  "/privacy/requests/:id/export",
  zValidator("param", idParamSchema),
  zValidator(
    "query",
    z.object({
      cursor: z.string().max(1_000).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
  ),
  async (context) => {
    const auth = context.get("auth");
    const query = context.req.valid("query");
    const result = await privacyService.exportPrivacyRequestPage({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      requestId: context.req.valid("param").id,
      ...query,
    });
    context.header(
      "Content-Disposition",
      `attachment; filename="va-dispatch-privacy-${result.requestId}.json"`,
    );
    return context.json(result);
  },
);

privacyRoutes.post(
  "/privacy/legal-holds",
  zValidator(
    "json",
    z
      .object({
        subjectMembershipId: z.string().uuid().nullable().optional(),
        scope: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(2_000),
        expiresAt: z.coerce.date().nullable().optional(),
      })
      .strict(),
  ),
  async (context) => {
    const auth = context.get("auth");
    const hold = await privacyService.createHold({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      ...context.req.valid("json"),
    });
    return context.json({ hold }, 201);
  },
);

privacyRoutes.post(
  "/privacy/legal-holds/:id/approve",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const hold = await privacyService.approveHold({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      holdId: context.req.valid("param").id,
    });
    return context.json({ hold });
  },
);

privacyRoutes.post(
  "/privacy/legal-holds/:id/release",
  zValidator("param", idParamSchema),
  async (context) => {
    const auth = context.get("auth");
    const hold = await privacyService.releaseHold({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      holdId: context.req.valid("param").id,
    });
    return context.json({ hold });
  },
);

privacyRoutes.patch(
  "/privacy/external-tasks/:id",
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z
      .object({
        status: z.enum(["completed", "not_applicable", "failed"]),
        operatorNote: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  ),
  async (context) => {
    const auth = context.get("auth");
    const task = await privacyService.updateExternalTask({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      taskId: context.req.valid("param").id,
      ...context.req.valid("json"),
    });
    return context.json({ task });
  },
);
