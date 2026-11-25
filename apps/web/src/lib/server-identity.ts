import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { ApiError } from "@/lib/api/http";
import {
  meSchema,
  tenantDetailSchema,
  type Me,
  type Role,
  type TenantDetail,
} from "@/lib/api/schemas";
import { serverApi } from "@/lib/api/server";
import { getSession } from "@/lib/auth/server-session";
import {
  E2E_IDENTITY_COOKIE,
  E2E_IDENTITY_HEADER,
  e2eRouteFixtureEnabled,
  e2eIntegratedFixtureEnabled,
  normalizeE2eIdentity,
} from "@/lib/e2e-fixture";

type IdentityResult =
  | { kind: "signed-out" }
  | { kind: "join-required" }
  | { kind: "mismatch"; reason: string }
  | { kind: "ready"; me: Me; role: Role; tenant: TenantDetail };

export const getServerIdentity = cache(
  async (slug: string): Promise<IdentityResult> => {
    if (e2eIntegratedFixtureEnabled()) {
      const cookieStore = await cookies();
      const identity = normalizeE2eIdentity(
        cookieStore.get(E2E_IDENTITY_COOKIE)?.value,
      );
      if (identity === "signed-out") return { kind: "signed-out" };

      const token = process.env.E2E_FIXTURE_SECRET;
      if (!token) {
        throw new Error("E2E_FIXTURE_SECRET is required in fixture mode");
      }
      const headers = {
        [E2E_IDENTITY_HEADER]: identity,
        "X-E2E-Fixture-Token": token,
      };
      const me = await serverApi("/me", "", meSchema, headers);
      if (
        !me.membership ||
        !me.tenant ||
        me.tenant.slug.toLowerCase() !== slug.toLowerCase()
      ) {
        return {
          kind: "mismatch",
          reason:
            "Your local Virtual Airline membership does not match this URL.",
        };
      }
      const tenant = await serverApi(
        "/tenant",
        "",
        tenantDetailSchema,
        headers,
      );
      if (tenant.slug.toLowerCase() !== slug.toLowerCase()) {
        return {
          kind: "mismatch",
          reason: "The tenant configuration does not match this URL.",
        };
      }
      return { kind: "ready", me, role: me.membership.role, tenant };
    }

    if (e2eRouteFixtureEnabled()) {
      const cookieStore = await cookies();
      const identity = normalizeE2eIdentity(cookieStore.get("e2e-role")?.value);
      const role: Role =
        identity === "dispatcher" || identity === "admin" ? identity : "pilot";
      const tenant = {
        id: `tenant-${slug}`,
        slug,
        name: "Virtual SAS",
        hoppieStation: "VSAS",
      };
      return {
        kind: "ready",
        role,
        me: {
          user: { authUserId: `e2e-${role}` },
          membership: {
            id: `membership-${role}`,
            role,
            pilotCallsign: role === "pilot" ? "SAS101" : "OPS",
            displayName: role === "pilot" ? "Test Pilot" : "Test Dispatcher",
            status: "active",
          },
          tenant,
        },
        tenant: {
          ...tenant,
          hasHoppieLogon: false,
          acarsProvider: "mock",
          hoppiePollingEnabled: false,
          hoppieLastTestedAt: null,
          brand: {
            seedColor: "#e64646",
            presence: "balanced",
            logoUrl: null,
          },
          settings: {},
          memberAccess: {
            applicationsEnabled: true,
            pilotApplicationsEnabled: true,
            dispatcherApplicationsEnabled: true,
            invitationExpiryDays: 30,
          },
        },
      };
    }

    const session = await getSession();
    if (!session) return { kind: "signed-out" };
    const token = session.accessToken;
    // The API picks the tenant from this header and checks the caller's
    // organization roles in the token against it.
    const tenantHeaders = { "X-Tenant-Slug": slug };

    let me: Me;
    try {
      me = await serverApi("/me", token, meSchema, tenantHeaders);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        return { kind: "signed-out" };
      // Not a member of this Virtual Airline (yet), or the membership is
      // not active: the join page shows the application state.
      if (error instanceof ApiError && error.status === 403) {
        return { kind: "join-required" };
      }
      throw error;
    }
    if (
      !me.membership ||
      !me.tenant ||
      me.tenant.slug.toLowerCase() !== slug.toLowerCase()
    ) {
      return {
        kind: "mismatch",
        reason:
          "Your local Virtual Airline membership does not match this URL.",
      };
    }

    // Only read tenant configuration after the URL and the local /me tenant
    // agree. A mismatched session performs no business reads.
    const tenant = await serverApi(
      "/tenant",
      token,
      tenantDetailSchema,
      tenantHeaders,
    );
    if (tenant.slug.toLowerCase() !== slug.toLowerCase()) {
      return {
        kind: "mismatch",
        reason: "The tenant configuration does not match this URL.",
      };
    }

    return { kind: "ready", me, role: me.membership.role, tenant };
  },
);
