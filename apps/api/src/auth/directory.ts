import type { MemberRole } from "../db/schema.js";
import type { DirectoryPage } from "../domain/members/service.js";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";

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
}

/** The configured identity directory; throws 503 when none is configured. */
export function getDirectory(): IdentityDirectory {
  if (directoryOverride) return directoryOverride;
  const config = env();
  if (!config.AUTH_ADMIN_API_URL || !config.AUTH_ADMIN_TOKEN) {
    throw new AppError(
      "INTERNAL",
      "The identity provider admin API is not configured",
      { status: 503 },
    );
  }
  return httpDirectory(config.AUTH_ADMIN_API_URL, config.AUTH_ADMIN_TOKEN);
}

/**
 * JSON client for the identity provider's organization admin API. Paths are
 * relative to AUTH_ADMIN_API_URL and follow the stem admin contract.
 */
function httpDirectory(baseUrl: string, token: string): IdentityDirectory {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw new DirectoryError(
        response.status,
        payload?.error?.code ?? null,
        payload?.error?.message ??
          `Identity provider returned ${response.status}`,
      );
    }
    return payload as T;
  }

  const org = (orgId: string) => `orgs/${encodeURIComponent(orgId)}`;

  return {
    listInvitations: ({ orgId, limit, offset }) =>
      call(
        "GET",
        `${org(orgId)}/invitations?status=pending&limit=${limit}&offset=${offset}`,
      ),
    createInvitation: ({ orgId, ...input }) =>
      call("POST", `${org(orgId)}/invitations`, input),
    revokeInvitation: ({ orgId, invitationId, requestingUserId }) =>
      call(
        "POST",
        `${org(orgId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
        { requestingUserId },
      ),
    listMemberships: ({ organizationId, limit, offset }) =>
      call(
        "GET",
        `${org(organizationId)}/members?limit=${limit}&offset=${offset}`,
      ),
    setMembershipRole: ({ orgId, userId, role }) =>
      call("PUT", `${org(orgId)}/members/${encodeURIComponent(userId)}`, {
        role,
      }),
    async removeMembership({ orgId, userId }) {
      try {
        await call(
          "DELETE",
          `${org(orgId)}/members/${encodeURIComponent(userId)}`,
        );
      } catch (error) {
        if (error instanceof DirectoryError && error.status === 404) return;
        throw error;
      }
    },
    renameOrganization: ({ orgId, name }) =>
      call("PATCH", org(orgId), { name }),
    getUser: (userId) => call("GET", `users/${encodeURIComponent(userId)}`),
  };
}
