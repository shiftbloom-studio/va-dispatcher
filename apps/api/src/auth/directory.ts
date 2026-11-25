import type { MemberRole } from "../db/schema.js";
import type { DirectoryPage } from "../domain/members/service.js";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import { identityFetch } from "../platform.js";

/** A pending or settled organization invitation at the identity provider. */
export type DirectoryInvitation = {
  id: string;
  emailAddress: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type DirectoryUser = {
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
};

/**
 * Identity provider operations the API needs besides token verification.
 * The local membership table stays the authority for application roles;
 * these calls keep the provider's organization in step with it.
 */
export interface IdentityDirectory {
  listInvitations(input: {
    orgId: string;
    limit: number;
    offset: number;
  }): Promise<{ data: DirectoryInvitation[]; totalCount: number }>;
  createInvitation(input: {
    orgId: string;
    inviterUserId: string;
    emailAddress: string;
    role: MemberRole;
    expiresInDays: number;
    redirectUrl: string;
    metadata: Record<string, string>;
  }): Promise<DirectoryInvitation>;
  revokeInvitation(input: {
    orgId: string;
    invitationId: string;
    requestingUserId: string;
  }): Promise<DirectoryInvitation>;
  listMemberships(input: {
    organizationId: string;
    limit: number;
    offset: number;
  }): Promise<DirectoryPage>;
  /** Create the membership or update its role. */
  setMembershipRole(input: {
    orgId: string;
    userId: string;
    role: MemberRole;
  }): Promise<void>;
  /** Remove the membership; succeeds when it does not exist. */
  removeMembership(input: { orgId: string; userId: string }): Promise<void>;
  renameOrganization(input: { orgId: string; name: string }): Promise<void>;
  /** Only works for members of this app's organizations. */
  getUser(userId: string): Promise<DirectoryUser>;
}

/** A provider response the routes translate into a public error. */
export class DirectoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "DirectoryError";
  }
}

let directoryOverride: IdentityDirectory | null = null;

export function setDirectoryForTests(directory: IdentityDirectory | null) {
  directoryOverride = directory;
  cachedToken = null;
}

/** The configured identity directory; throws 503 when none is configured. */
export function getDirectory(): IdentityDirectory {
  if (directoryOverride) return directoryOverride;
  const config = env();
  if (
    !config.AUTH_ISSUER ||
    !config.AUTH_CLIENT_ID ||
    !config.AUTH_CLIENT_SECRET
  ) {
    throw new AppError(
      "INTERNAL",
      "The identity provider directory API is not configured",
      { status: 503 },
    );
  }
  return stemDirectory({
    issuer: config.AUTH_ISSUER,
    clientId: config.AUTH_CLIENT_ID,
    clientSecret: config.AUTH_CLIENT_SECRET,
  });
}

type Credentials = { issuer: string; clientId: string; clientSecret: string };

let cachedToken: { key: string; token: string; expiresAt: number } | null =
  null;

function withSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function tokenEndpoint(issuer: string): Promise<string> {
  const response = await identityFetch(issuer)(
    new URL(".well-known/openid-configuration", withSlash(issuer)),
  );
  const document = response.ok
    ? ((await response.json().catch(() => null)) as {
        token_endpoint?: unknown;
      } | null)
    : null;
  if (typeof document?.token_endpoint !== "string") {
    throw new DirectoryError(
      503,
      "discovery_failed",
      "Identity provider discovery failed",
    );
  }
  return document.token_endpoint;
}

/** Client credentials token for stem's directory API (valid five minutes). */
async function directoryToken(credentials: Credentials): Promise<string> {
  const key = `${credentials.issuer}|${credentials.clientId}`;
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const response = await identityFetch(credentials.issuer)(
    await tokenEndpoint(credentials.issuer),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(
          `${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(
            credentials.clientSecret,
          )}`,
        )}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "directory",
        resource: directoryBase(credentials.issuer),
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new DirectoryError(
      response.ok ? 502 : response.status,
      typeof payload?.error === "string" ? payload.error : null,
      "The identity provider refused the directory credentials",
    );
  }
  const lifetime =
    typeof payload.expires_in === "number" ? payload.expires_in : 300;
  cachedToken = {
    key,
    token: payload.access_token,
    // Renew a minute early so a token never expires mid-request.
    expiresAt: Date.now() + Math.max(lifetime - 60, 0) * 1000,
  };
  return payload.access_token;
}

function directoryBase(issuer: string) {
  return `${withSlash(issuer)}api/v1`;
}

type StemInvitation = {
  id: string;
  email?: string;
  role?: string;
  status?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  expires_at?: string;
  expiresAt?: string;
};

type StemMember = {
  user_id?: string | null;
  role?: string;
  user?: { id?: string; email?: string | null; name?: string | null } | null;
};

function listOf<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function invitationStatus(status: string | undefined) {
  switch (status) {
    case "accepted":
      return "accepted" as const;
    case "canceled":
    case "cancelled":
    case "rejected":
      return "revoked" as const;
    case "expired":
      return "expired" as const;
    default:
      return "pending" as const;
  }
}

function toInvitation(invitation: StemInvitation): DirectoryInvitation {
  const createdAt =
    invitation.created_at ?? invitation.createdAt ?? new Date().toISOString();
  return {
    id: invitation.id,
    emailAddress: invitation.email ?? "",
    role: invitation.role ?? "member",
    status: invitationStatus(invitation.status),
    createdAt,
    updatedAt: invitation.updated_at ?? invitation.updatedAt ?? createdAt,
    expiresAt: invitation.expires_at ?? invitation.expiresAt ?? createdAt,
  };
}

/** Client for stem's directory API (`{issuer}/api/v1`). */
function stemDirectory(credentials: Credentials): IdentityDirectory {
  const base = `${directoryBase(credentials.issuer)}/`;

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await identityFetch(credentials.issuer)(
      new URL(path, base),
      {
        method,
        headers: {
          Authorization: `Bearer ${await directoryToken(credentials)}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = (payload ?? {}) as { error?: unknown; detail?: unknown };
      throw new DirectoryError(
        response.status,
        typeof error.error === "string" ? error.error : null,
        typeof error.detail === "string"
          ? error.detail
          : `Identity provider returned ${response.status}`,
      );
    }
    return payload as T;
  }

  const org = (orgId: string) => `orgs/${encodeURIComponent(orgId)}`;
  const member = (orgId: string, userId: string) =>
    `${org(orgId)}/members/${encodeURIComponent(userId)}`;

  async function pendingInvitations(orgId: string) {
    const payload = await call<unknown>(
      "GET",
      `${org(orgId)}/invitations?status=pending`,
    );
    return listOf<StemInvitation>(payload, ["invitations", "data", "items"]);
  }

  return {
    async listInvitations({ orgId, limit, offset }) {
      const invitations = await pendingInvitations(orgId);
      return {
        data: invitations.slice(offset, offset + limit).map(toInvitation),
        totalCount: invitations.length,
      };
    },
    async createInvitation({
      orgId,
      inviterUserId,
      emailAddress,
      role,
      expiresInDays,
      redirectUrl,
    }) {
      const payload = await call<
        StemInvitation | { invitation: StemInvitation }
      >("POST", `${org(orgId)}/invitations`, {
        email: emailAddress,
        role,
        inviter_id: inviterUserId,
        redirect_to: redirectUrl,
        // stem accepts whole days from 1 to 30.
        expires_in_days: Math.min(Math.max(Math.round(expiresInDays), 1), 30),
      });
      return toInvitation(
        "invitation" in payload ? payload.invitation : payload,
      );
    },
    async revokeInvitation({ orgId, invitationId }) {
      const pending = (await pendingInvitations(orgId)).find(
        (invitation) => invitation.id === invitationId,
      );
      if (!pending) {
        throw new DirectoryError(
          404,
          "invitation_not_found",
          "No pending invitation with this ID",
        );
      }
      await call(
        "DELETE",
        `${org(orgId)}/invitations/${encodeURIComponent(invitationId)}`,
      );
      return { ...toInvitation(pending), status: "revoked" };
    },
    async listMemberships({ organizationId, limit, offset }) {
      const payload = await call<{ total?: number }>(
        "GET",
        `${org(organizationId)}/members?limit=${limit}&offset=${offset}`,
      );
      const members = listOf<StemMember>(payload, ["members", "data", "items"]);
      return {
        data: members.map((entry) => ({
          userId: entry.user_id ?? entry.user?.id ?? null,
          role: entry.role ?? "member",
          displayName:
            entry.user?.name?.trim() || entry.user?.email?.trim() || null,
        })),
        totalCount:
          typeof payload?.total === "number" ? payload.total : members.length,
      };
    },
    async setMembershipRole({ orgId, userId, role }) {
      try {
        await call("PATCH", member(orgId, userId), { role });
      } catch (error) {
        if (!(error instanceof DirectoryError) || error.status !== 404) {
          throw error;
        }
        await call("POST", `${org(orgId)}/members`, { user_id: userId, role });
      }
    },
    async removeMembership({ orgId, userId }) {
      try {
        await call("DELETE", member(orgId, userId));
      } catch (error) {
        if (error instanceof DirectoryError && error.status === 404) return;
        throw error;
      }
    },
    async renameOrganization({ orgId, name }) {
      await call("PATCH", org(orgId), { name });
    },
    async getUser(userId) {
      const user = await call<{
        email?: string | null;
        name?: string | null;
        email_verified?: boolean;
      }>("GET", `users/${encodeURIComponent(userId)}`);
      return {
        displayName: user.name ?? null,
        email: user.email ?? null,
        emailVerified: user.email_verified === true,
      };
    },
  };
}
