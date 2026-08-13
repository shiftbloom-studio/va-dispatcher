import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminControlPlane } from "@/components/admin-control-plane";
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
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path.startsWith("/members/invitations?") && !options.method) {
          return Promise.resolve(organizationInvitations);
        }
        if (path === "/members/invitations" && options.method === "POST") {
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
            auditRecorded: true,
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
