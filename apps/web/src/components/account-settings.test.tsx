import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettings } from "@/components/account-settings";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const me = {
  user: { clerkUserId: "user_test" },
  membership: {
    id: "membership_test",
    role: "dispatcher",
    displayName: "Fabian",
    pilotCallsign: "OPS100",
    status: "active",
  },
  tenant: {
    id: "tenant-vsas",
    slug: "vsas",
    name: "Virtual SAS",
    hoppieStation: "VSAS",
  },
};

describe("personal account settings", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/me" && !options.method) return Promise.resolve(me);
        if (path === "/me" && options.method === "PATCH") {
          const body = JSON.parse(options.body ?? "{}") as {
            displayName: string | null;
            pilotCallsign: string | null;
          };
          return Promise.resolve({
            membership: { ...me.membership, ...body },
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("lets a dispatcher save a normalized personal callsign", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AccountSettings slug="vsas" />
      </TestQueryProvider>,
    );

    const callsign = await screen.findByLabelText("Your ACARS callsign");
    await user.clear(callsign);
    await user.type(callsign, "ops123");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await screen.findByText("Your account settings were saved.");
    const profileCall = apiMock.mock.calls.find(
      ([path, options]) => path === "/me" && options.method === "PATCH",
    );
    expect(JSON.parse(profileCall?.[1].body ?? "{}")).toMatchObject({
      pilotCallsign: "OPS123",
    });
    expect(apiMock).not.toHaveBeenCalledWith("/tenant", expect.anything());
    expect(
      screen.queryByLabelText("Ground-station Hoppie logon"),
    ).not.toBeInTheDocument();
  });

  it("explains that personal Hoppie credentials remain in the simulator", async () => {
    render(
      <TestQueryProvider>
        <AccountSettings slug="vsas" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("Your personal logon code stays private"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Request a Hoppie logon" }),
    ).toHaveAttribute(
      "href",
      "https://www.hoppie.nl/acars/system/register.html",
    );
  });
});
