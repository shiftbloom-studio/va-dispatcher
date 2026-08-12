import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminControlPlane } from "@/components/admin-control-plane";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

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
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path.startsWith("/members?") && !options.method) {
          return Promise.resolve(members);
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
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
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
});
