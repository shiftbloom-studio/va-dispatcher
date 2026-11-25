import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnv, resetEnvCache } from "../env.js";
import {
  DirectoryError,
  getDirectory,
  setDirectoryForTests,
} from "./directory.js";

const ISSUER = "https://stem.example.test";

type Call = { method: string; url: string; headers: Headers; body: string };

function stubStem(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        url: String(input),
        headers: new Headers(init.headers),
        body: init.body ? String(init.body) : "",
      };
      calls.push(call);
      if (call.url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
        });
      }
      if (call.url === `${ISSUER}/api/auth/oauth2/token`) {
        return Response.json({
          access_token: "directory-token",
          expires_in: 300,
        });
      }
      const handler =
        routes[`${call.method} ${call.url.replace(`${ISSUER}/api/v1/`, "")}`];
      if (!handler)
        return Response.json({ error: "not_found" }, { status: 404 });
      return handler(call);
    }),
  );
  return calls;
}

describe("stem directory client", () => {
  beforeEach(() => {
    resetEnvCache();
    setDirectoryForTests(null);
    loadEnv({
      NODE_ENV: "test",
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: "https://va.example.test/api",
      AUTH_CLIENT_ID: "va-client",
      AUTH_CLIENT_SECRET: "va-secret",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnvCache();
  });

  it("gets a client credentials token once and lists members", async () => {
    const calls = stubStem({
      "GET orgs/org_1/members?limit=2&offset=0": () =>
        Response.json({
          members: [
            {
              user_id: "u1",
              role: "owner",
              user: { id: "u1", email: "a@x.test", name: "Ann" },
            },
            {
              user_id: "u2",
              role: "pilot",
              user: { id: "u2", email: "b@x.test", name: null },
            },
          ],
          total: 3,
        }),
    });

    const directory = getDirectory();
    const page = await directory.listMemberships({
      organizationId: "org_1",
      limit: 2,
      offset: 0,
    });
    await directory.listMemberships({
      organizationId: "org_1",
      limit: 2,
      offset: 0,
    });

    expect(page).toEqual({
      data: [
        { userId: "u1", role: "owner", displayName: "Ann" },
        { userId: "u2", role: "pilot", displayName: "b@x.test" },
      ],
      totalCount: 3,
    });
    const tokenCalls = calls.filter((call) =>
      call.url.endsWith("/oauth2/token"),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.headers.get("authorization")).toBe(
      `Basic ${btoa("va-client:va-secret")}`,
    );
    expect(new URLSearchParams(tokenCalls[0]!.body).get("resource")).toBe(
      `${ISSUER}/api/v1`,
    );
    expect(calls.at(-1)!.headers.get("authorization")).toBe(
      "Bearer directory-token",
    );
  });

  it("creates invitations with stem's field names", async () => {
    const calls = stubStem({
      "POST orgs/org_1/invitations": () =>
        Response.json({
          id: "inv_1",
          email: "new@x.test",
          role: "dispatcher",
          status: "pending",
          created_at: "2026-11-25T10:00:00.000Z",
          expires_at: "2026-12-09T10:00:00.000Z",
        }),
    });

    const invitation = await getDirectory().createInvitation({
      orgId: "org_1",
      inviterUserId: "u1",
      emailAddress: "new@x.test",
      role: "dispatcher",
      expiresInDays: 14,
      redirectUrl: "https://va.example.test/vsas",
      metadata: {},
    });

    expect(JSON.parse(calls.at(-1)!.body)).toEqual({
      email: "new@x.test",
      role: "dispatcher",
      inviter_id: "u1",
      redirect_to: "https://va.example.test/vsas",
    });
    expect(invitation).toMatchObject({
      id: "inv_1",
      emailAddress: "new@x.test",
      status: "pending",
      expiresAt: "2026-12-09T10:00:00.000Z",
    });
  });

  it("revokes only a pending invitation", async () => {
    const calls = stubStem({
      "GET orgs/org_1/invitations?status=pending": () =>
        Response.json([
          { id: "inv_1", email: "a@x.test", role: "pilot", status: "pending" },
        ]),
      "DELETE orgs/org_1/invitations/inv_1": () =>
        new Response(null, { status: 204 }),
    });

    const directory = getDirectory();
    await expect(
      directory.revokeInvitation({
        orgId: "org_1",
        invitationId: "inv_1",
        requestingUserId: "u1",
      }),
    ).resolves.toMatchObject({ id: "inv_1", status: "revoked" });
    await expect(
      directory.revokeInvitation({
        orgId: "org_1",
        invitationId: "inv_2",
        requestingUserId: "u1",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("adds a member when a role update finds none, and maps stem errors", async () => {
    const calls = stubStem({
      "POST orgs/org_1/members": () =>
        Response.json({ user_id: "u3", role: "pilot" }),
      "PATCH orgs/org_1/members/u1": () =>
        Response.json(
          { error: "last_owner", detail: "The last owner can't be demoted" },
          { status: 409 },
        ),
    });

    const directory = getDirectory();
    await directory.setMembershipRole({
      orgId: "org_1",
      userId: "u3",
      role: "pilot",
    });
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({
      user_id: "u3",
      role: "pilot",
    });

    const error = await directory
      .setMembershipRole({ orgId: "org_1", userId: "u1", role: "pilot" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DirectoryError);
    expect(error).toMatchObject({ status: 409, code: "last_owner" });
  });

  it("fails closed without client credentials", () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", AUTH_ISSUER: ISSUER });
    expect(() => getDirectory()).toThrow(/not configured/);
  });
});
