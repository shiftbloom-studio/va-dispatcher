import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminControlPlane } from "@/components/admin-control-plane";
import { ApiError } from "@/lib/api/http";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();
let membershipApplications: {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
};
let organizationInvitations: {
  items: Array<Record<string, unknown>>;
  totalCount: number;
};
let directorySync: {
  complete: boolean;
  summaryAuditRecorded: boolean;
  pages: number;
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failures: Array<{
    scope: "page" | "membership";
    offset: number;
    code: string;
  }>;
  note?: string;
};
let invitationCreateError: Error | null;
let invitationCreateAuditRecorded: boolean;
let invitationRevokeAuditRecorded: boolean;
let invitationListCalls: number;
let failInvitationRefetch: boolean;

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const members = {
  items: [
    {
      id: "26000000-0000-4000-8000-000000000021",
      clerkUserId: "user-pilot-one",
      role: "pilot",
      displayName: "Pilot One",
      pilotCallsign: "SAS101",
      status: "active",
      requestedRole: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      openFlightCount: 1,
      activeFlightCount: 0,
      openScheduleRequestCount: 1,
      terminalRequestLinkedFlightCount: 0,
    },
    {
      id: "26000000-0000-4000-8000-000000000022",
      clerkUserId: "user-pilot-two",
      role: "pilot",
      displayName: "Pilot Two",
      pilotCallsign: "SAS102",
      status: "active",
      requestedRole: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      openFlightCount: 0,
      activeFlightCount: 0,
      openScheduleRequestCount: 0,
      terminalRequestLinkedFlightCount: 0,
    },
  ],
  nextCursor: null,
};

describe("admin member console", () => {
  beforeEach(() => {
    apiMock.mockReset();
    membershipApplications = { items: [], nextCursor: null };
    organizationInvitations = { items: [], totalCount: 0 };
    invitationCreateError = null;
    invitationCreateAuditRecorded = true;
    invitationRevokeAuditRecorded = true;
    invitationListCalls = 0;
    failInvitationRefetch = false;
    directorySync = {
      complete: true,
      summaryAuditRecorded: true,
      pages: 1,
      seen: 2,
      created: 0,
      updated: 0,
      unchanged: 2,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/members/sync" && options.method === "POST") {
          return Promise.resolve(directorySync);
        }
        if (path.startsWith("/members/invitations?") && !options.method) {
          invitationListCalls += 1;
          if (failInvitationRefetch && invitationListCalls > 1) {
            return Promise.reject(new Error("Synthetic refresh failure"));
          }
          return Promise.resolve(organizationInvitations);
        }
        if (path === "/members/invitations" && options.method === "POST") {
          if (invitationCreateError) {
            return Promise.reject(invitationCreateError);
          }
          const body = JSON.parse(options.body ?? "{}");
          return Promise.resolve({
            invitation: {
              id: "orginv-test",
              emailAddress: body.emailAddress,
              role: `org:${body.role}`,
              status: "pending",
              createdAt: "2026-08-13T00:00:00.000Z",
              updatedAt: "2026-08-13T00:00:00.000Z",
              expiresAt: "2026-08-27T00:00:00.000Z",
            },
            auditRecorded: invitationCreateAuditRecorded,
          });
        }
        if (
          path.startsWith("/members/invitations/") &&
          options.method === "DELETE"
        ) {
          const invitation = organizationInvitations.items[0] ?? {
            id: path.split("/").at(-1),
            emailAddress: "new@example.test",
            role: "org:pilot",
            status: "revoked",
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            expiresAt: "2026-08-27T00:00:00.000Z",
          };
          return Promise.resolve({
            invitation: { ...invitation, status: "revoked" },
            auditRecorded: invitationRevokeAuditRecorded,
          });
        }
        if (
          path.startsWith("/members?status=invited&limit=50") &&
          !options.method
        ) {
          return Promise.resolve(membershipApplications);
        }
        if (path.startsWith("/members?") && !options.method) {
          return Promise.resolve(members);
        }
        if (
          path.endsWith("/application/approve") &&
          options.method === "POST"
        ) {
          const applicant = membershipApplications.items[0];
          return Promise.resolve({
            ...applicant,
            role: "dispatcher",
            requestedRole: null,
            status: "active",
            reassignedFlightCount: 0,
            reassignedScheduleRequestCount: 0,
            clerkSynchronized: true,
          });
        }
        if (
          path === `/members/${members.items[0].id}` &&
          options.method === "PATCH"
        ) {
          return Promise.resolve({
            ...members.items[0],
            role: "dispatcher",
            reassignedFlightCount: 1,
            reassignedScheduleRequestCount: 1,
            clerkSynchronized: true,
          });
        }
        if (
          path === `/members/${members.items[1].id}` &&
          options.method === "DELETE"
        ) {
          return Promise.resolve({
            ...members.items[1],
            status: "disabled",
            reassignedFlightCount: 0,
            reassignedScheduleRequestCount: 0,
            clerkSynchronized: true,
            completionAuditRecorded: true,
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("sends a tenant-role invitation without exposing Clerk administration", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "new@example.test",
    );
    await user.selectOptions(
      screen.getByLabelText("Tenant role"),
      "dispatcher",
    );
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    const invitationCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/members/invitations" && options.method === "POST",
    );
    expect(JSON.parse(invitationCall?.[1].body ?? "{}")).toEqual({
      emailAddress: "new@example.test",
      role: "dispatcher",
    });
    expect(
      await screen.findByText(/Invitation sent\. It remains pending/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/unless an Invited or Disabled record/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Pending tenant invitations are not organization members/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("/vsas/join")).toBeInTheDocument();
  });

  it("reports skipped Clerk memberships as incomplete and reviewable", async () => {
    directorySync = {
      complete: false,
      summaryAuditRecorded: true,
      pages: 1,
      seen: 1,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 1,
      failed: 0,
      failures: [
        {
          scope: "membership",
          offset: 0,
          code: "local_status_requires_review",
        },
      ],
    };
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Sync Clerk directory" }),
    );

    const result = await screen.findByRole("alert");
    expect(result).toHaveTextContent("Directory sync needs attention");
    expect(result).toHaveTextContent("1 skipped");
    expect(result).toHaveTextContent(
      "The sample includes 1 local membership that needs explicit application or disabled-member review",
    );
    expect(result).toHaveTextContent(
      "Use the Status filter to review Invited and Disabled members",
    );
    expect(result).not.toHaveTextContent("local_status_requires_review");
  });

  it("distinguishes aggregate skipped totals from the bounded issue sample", async () => {
    directorySync = {
      complete: false,
      summaryAuditRecorded: true,
      pages: 1,
      seen: 30,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 30,
      failed: 0,
      failures: Array.from({ length: 25 }, (_, offset) => ({
        scope: "membership" as const,
        offset,
        code: "missing_user_id",
      })),
    };
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Sync Clerk directory" }),
    );

    const result = await screen.findByRole("alert");
    expect(result).toHaveTextContent("30 skipped");
    expect(result).toHaveTextContent("Issue details are a bounded sample");
    expect(result).toHaveTextContent("The sample includes 25 entries");
    expect(result).not.toHaveTextContent("25 skipped entries");
  });

  it("labels a definitive invitation submission failure separately from invitation loading", async () => {
    invitationCreateError = new ApiError({
      status: 422,
      code: "UNPROCESSABLE",
      message: "Clerk rejected the configured role",
    });
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "new@example.test",
    );
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invitation was not sent. Clerk rejected the configured role",
    );
  });

  it("treats an invalid success response as an unconfirmed invitation outcome", async () => {
    invitationCreateError = new ApiError({
      status: 200,
      code: "INVALID_RESPONSE",
      message: "The server response did not match the expected contract.",
    });
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "new@example.test",
    );
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm whether Clerk sent the invitation",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Refresh pending invitations before retrying",
    );
  });

  it("keeps the last known invitation list visible when a refresh fails", async () => {
    organizationInvitations = {
      items: [
        {
          id: "orginv-existing",
          emailAddress: "existing@example.test",
          role: "org:pilot",
          status: "pending",
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
          expiresAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      totalCount: 1,
    };
    failInvitationRefetch = true;
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("existing@example.test"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email address"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "last known list remains visible",
    );
    expect(screen.getByText("existing@example.test")).toBeInTheDocument();
  });

  it("gives each invitation revoke control a specific accessible name", async () => {
    organizationInvitations = {
      items: [
        {
          id: "orginv-one",
          emailAddress: "one@example.test",
          role: "org:pilot",
          status: "pending",
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
          expiresAt: "2026-08-27T00:00:00.000Z",
        },
        {
          id: "orginv-two",
          emailAddress: "two@example.test",
          role: "org:dispatcher",
          status: "pending",
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
          expiresAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      totalCount: 2,
    };

    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByRole("button", {
        name: "Revoke invitation for one@example.test",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Revoke invitation for two@example.test",
      }),
    ).toBeInTheDocument();
  });

  it("warns against retrying when Clerk succeeded but audit recording failed", async () => {
    invitationCreateAuditRecorded = false;
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "new@example.test",
    );
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "do not retry blindly",
    );
  });

  it("shows auth-bypass directory sync as a no-op warning", async () => {
    directorySync = {
      complete: true,
      summaryAuditRecorded: false,
      pages: 0,
      seen: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      note: "Dev bypass — no Clerk org sync",
    };
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Sync Clerk directory" }),
    );

    const result = await screen.findByRole("alert");
    expect(result).toHaveTextContent("Dev bypass — no Clerk org sync");
    expect(result).toHaveTextContent("0 seen");
  });

  it("paginates every pending invitation and application queue", async () => {
    organizationInvitations = {
      items: Array.from({ length: 50 }, (_, index) => ({
        id: `orginv-${index}`,
        emailAddress: `pilot-${index}@example.test`,
        role: "org:pilot",
        status: "pending",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-27T00:00:00.000Z",
      })),
      totalCount: 51,
    };
    membershipApplications = { items: [], nextCursor: "next-application" };
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Next applications" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(apiMock).toHaveBeenCalledWith(
      "/members?status=invited&limit=50&cursor=next-application",
      expect.any(Object),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/members/invitations?limit=50&offset=50",
      expect.any(Object),
    );
  });

  it("approves a pending dispatcher application through the tenant console", async () => {
    membershipApplications = {
      items: [
        {
          ...members.items[1],
          id: "26000000-0000-4000-8000-000000000031",
          clerkUserId: "user-applicant",
          displayName: "Dispatcher Applicant",
          status: "invited",
          requestedRole: "dispatcher",
        },
      ],
      nextCursor: null,
    };
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("Dispatcher Applicant")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    const approvalCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path ===
          "/members/26000000-0000-4000-8000-000000000031/application/approve" &&
        options.method === "POST",
    );
    expect(JSON.parse(approvalCall?.[1].body ?? "{}")).toEqual({
      role: "dispatcher",
    });
  });

  it("requires a replacement and submits it when a pilot becomes ineligible", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    const role = await screen.findByLabelText(`Role`, {
      selector: `#member-role-${members.items[0].id}`,
    });
    await user.selectOptions(role, "dispatcher");
    const replacement = screen.getByLabelText("Replacement active pilot", {
      selector: `#member-replacement-${members.items[0].id}`,
    });
    await user.type(replacement, members.items[1].id);
    const editor = role.closest("form");
    expect(editor).not.toBeNull();
    await user.click(
      within(editor!).getByRole("button", { name: "Save member" }),
    );

    const updateCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === `/members/${members.items[0].id}` &&
        options.method === "PATCH",
    );
    expect(JSON.parse(updateCall?.[1].body ?? "{}")).toMatchObject({
      role: "dispatcher",
      reassignToMembershipId: members.items[1].id,
    });
    expect(
      await screen.findByText(/1 flight\(s\) and 1 request\(s\) reassigned/),
    ).toBeInTheDocument();
  });

  it("confirms and performs complete organization removal", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AdminControlPlane slug="vsas" />
      </TestQueryProvider>,
    );

    const buttons = await screen.findAllByRole("button", {
      name: "Remove from organization",
    });
    const removable = buttons.find(
      (button) => !button.hasAttribute("disabled"),
    );
    expect(removable).toBeDefined();
    await user.click(removable!);

    expect(confirm).toHaveBeenCalledOnce();
    const kickCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === `/members/${members.items[1].id}` &&
        options.method === "DELETE",
    );
    expect(JSON.parse(kickCall?.[1].body ?? "{}")).toEqual({});
    expect(
      await screen.findByText(
        "Member removed from the organization and disabled locally.",
      ),
    ).toBeInTheDocument();
    confirm.mockRestore();
  });
});
