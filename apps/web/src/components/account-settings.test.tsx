import { render, screen, waitFor } from "@testing-library/react";
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
    role: "admin",
    displayName: "Fabian",
    pilotCallsign: "SAS100",
    status: "active",
  },
  tenant: {
    id: "tenant-vsas",
    slug: "vsas",
    name: "Virtual SAS",
    hoppieStation: "VSAS",
  },
};

const tenant = {
  ...me.tenant,
  hasHoppieLogon: false,
  acarsProvider: "mock",
  hoppiePollingEnabled: false,
  hoppieLastTestedAt: null,
  settings: {},
};

describe("account settings", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/me" && !options.method) return Promise.resolve(me);
        if (path === "/tenant" && !options.method)
          return Promise.resolve(tenant);
        if (path === "/me" && options.method === "PATCH") {
          const body = JSON.parse(options.body ?? "{}") as {
            displayName: string | null;
            pilotCallsign: string | null;
          };
          return Promise.resolve({
            membership: { ...me.membership, ...body },
          });
        }
        if (path === "/tenant/acars-config" && options.method === "PUT") {
          return Promise.resolve({
            hoppieStation: "SAS",
            hasHoppieLogon: true,
            acarsProvider: "hoppie",
            hoppiePollingEnabled: true,
            hoppieLastTestedAt: "2026-08-12T12:00:00.000Z",
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("saves a normalized personal callsign and an admin ground credential", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AccountSettings slug="vsas" />
      </TestQueryProvider>,
    );

    const callsign = await screen.findByLabelText("Your ACARS callsign");
    await user.clear(callsign);
    await user.type(callsign, "sas123");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await screen.findByText("Your account settings were saved.");
    const profileCall = apiMock.mock.calls.find(
      ([path, options]) => path === "/me" && options.method === "PATCH",
    );
    expect(JSON.parse(profileCall?.[1].body ?? "{}")).toMatchObject({
      pilotCallsign: "SAS123",
    });

    const station = screen.getByLabelText("Ground-station callsign");
    await user.clear(station);
    await user.type(station, "sas");
    await user.type(
      screen.getByLabelText("Ground-station Hoppie logon"),
      "private-logon",
    );
    await user.click(screen.getByRole("button", { name: "Test and save" }));

    expect(
      await screen.findByText(/Hoppie accepted the connection test/),
    ).toBeInTheDocument();
    const configCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/tenant/acars-config" && options.method === "PUT",
    );
    expect(JSON.parse(configCall?.[1].body ?? "{}")).toEqual({
      hoppieStation: "SAS",
      hoppieLogon: "private-logon",
    });
    await waitFor(() =>
      expect(screen.getByText("Connected")).toBeInTheDocument(),
    );
  });

  it("does not expose ground credential controls to a pilot", async () => {
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/me" && !options.method)
        return Promise.resolve({
          ...me,
          membership: { ...me.membership, role: "pilot" },
        });
      if (path === "/tenant" && !options.method) return Promise.resolve(tenant);
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <TestQueryProvider>
        <AccountSettings slug="vsas" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("An administrator manages this connection"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Ground-station Hoppie logon"),
    ).not.toBeInTheDocument();
  });
});
