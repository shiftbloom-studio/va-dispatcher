import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcarsWorkspace } from "@/components/acars-workspace";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("ACARS compose", () => {
  beforeEach(() => {
    let attempts = 0;
    apiMock.mockReset();
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/dispatch/inbox")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/flights?limit=100")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/members") return Promise.resolve({ items: [] });
      if (path === "/tenant")
        return Promise.resolve({
          id: "tenant-vsas",
          slug: "vsas",
          name: "Virtual SAS",
          hoppieStation: "SAS",
          hasHoppieLogon: true,
          acarsProvider: "hoppie",
          hoppiePollingEnabled: true,
          hoppieLastTestedAt: "2026-08-12T00:00:00.000Z",
          settings: {},
        });
      if (path === "/acars/messages" && options.method === "POST") {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("Provider unavailable"))
          : Promise.resolve({
              message: {
                id: "m1",
                direction: "outbound",
                fromStation: "VSAS",
                toStation: "SAS101",
                body: "HELLO",
                provider: "hoppie",
              },
            });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
  });

  it("retains a failed draft and retries only after a manual action", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" />
      </TestQueryProvider>,
    );
    await screen.findByText("No ACARS messages");
    await user.type(screen.getByLabelText("Recipient station"), "sas101");
    await user.type(screen.getByLabelText("Message"), "HELLO FROM OPS");
    await user.click(screen.getByRole("button", { name: "Send telex" }));

    expect(
      await screen.findByRole("button", { name: "Retry send" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("HELLO FROM OPS");
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/acars/messages"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry send" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Message")).toHaveValue(""),
    );
    expect(
      screen.getByText(/Hoppie accepted the telex to SAS101/),
    ).toBeInTheDocument();
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/acars/messages"),
    ).toHaveLength(2);
  });

  it("keeps ACARS read-only until Hoppie is configured", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/dispatch/inbox")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/flights?limit=100")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/members") return Promise.resolve({ items: [] });
      if (path === "/tenant")
        return Promise.resolve({
          id: "tenant-vsas",
          slug: "vsas",
          name: "Virtual SAS",
          hoppieStation: "SAS",
          hasHoppieLogon: false,
          acarsProvider: "hoppie",
          hoppiePollingEnabled: false,
          hoppieLastTestedAt: null,
          settings: {},
        });
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("Hoppie setup required"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Recipient station"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Ask an organization administrator/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open organization settings" }),
    ).not.toBeInTheDocument();
  });

  it("links an admin to organization settings when setup is required", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/dispatch/inbox")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/flights?limit=100")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/members") return Promise.resolve({ items: [] });
      if (path === "/tenant")
        return Promise.resolve({
          id: "tenant-vsas",
          slug: "vsas",
          name: "Virtual SAS",
          hoppieStation: "SAS",
          hasHoppieLogon: false,
          acarsProvider: "hoppie",
          hoppiePollingEnabled: false,
          hoppieLastTestedAt: null,
          settings: {},
        });
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" canManageOrganization />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "Open organization settings" }),
    ).toHaveAttribute("href", "/vsas/settings/organization");
  });

  it("enables compose and inbound simulation with the development mock adapter", async () => {
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/dispatch/inbox")
          return Promise.resolve({ items: [], nextCursor: null });
        if (path === "/flights?limit=100")
          return Promise.resolve({ items: [], nextCursor: null });
        if (path === "/members") return Promise.resolve({ items: [] });
        if (path === "/tenant")
          return Promise.resolve({
            id: "tenant-vsas",
            slug: "vsas",
            name: "Virtual SAS",
            hoppieStation: "VSAS",
            hasHoppieLogon: false,
            acarsProvider: "mock",
            hoppiePollingEnabled: false,
            hoppieLastTestedAt: null,
            settings: {},
          });
        if (path === "/acars/simulate" && options.method === "POST")
          return Promise.resolve({ queued: true, to: "VSAS" });
        throw new Error(`Unexpected API call: ${path}`);
      },
    );

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" />
      </TestQueryProvider>,
    );

    expect(await screen.findByLabelText("Recipient station")).toBeEnabled();
    await user.type(screen.getByLabelText("Simulated sender"), "sas404");
    await user.type(
      screen.getByLabelText("Simulated message"),
      "REQUESTING GATE",
    );
    await user.click(screen.getByRole("button", { name: "Simulate inbound" }));

    expect(
      await screen.findByText(/simulated inbound message to VSAS is stored/i),
    ).toBeInTheDocument();
    const simulateCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/acars/simulate" && options.method === "POST",
    );
    expect(JSON.parse(simulateCall?.[1].body ?? "{}")).toEqual({
      from: "SAS404",
      body: "REQUESTING GATE",
      msgType: "telex",
    });
  });

  it("uses the linked pilot's saved callsign as the recipient", async () => {
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/dispatch/inbox")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/flights?limit=100")
        return Promise.resolve({
          items: [
            {
              id: "flight-1",
              scheduleRequestId: null,
              replacesFlightId: null,
              pilotMembershipId: "pilot-1",
              flightNumber: "SK123",
              depIcao: "EKCH",
              arrIcao: "ESSA",
              etd: "2026-08-12T12:00:00.000Z",
              eta: "2026-08-12T13:00:00.000Z",
              aircraftType: "A320",
              version: 1,
              status: "offered",
              cancelReason: null,
              declinedReason: null,
              dispatcherNotes: null,
              outAt: null,
              offAt: null,
              onAt: null,
              inAt: null,
              createdAt: "2026-08-12T00:00:00.000Z",
              updatedAt: "2026-08-12T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        });
      if (path === "/members")
        return Promise.resolve({
          items: [
            {
              id: "pilot-1",
              role: "pilot",
              displayName: "Test Pilot",
              pilotCallsign: "SAS777",
              status: "active",
            },
          ],
        });
      if (path === "/tenant")
        return Promise.resolve({
          id: "tenant-vsas",
          slug: "vsas",
          name: "Virtual SAS",
          hoppieStation: "SAS",
          hasHoppieLogon: true,
          acarsProvider: "hoppie",
          hoppiePollingEnabled: true,
          hoppieLastTestedAt: "2026-08-12T00:00:00.000Z",
          settings: {},
        });
      if (path === "/acars/messages" && options.method === "POST")
        return Promise.resolve({
          message: {
            id: "message-1",
            direction: "outbound",
            fromStation: "SAS",
            toStation: "SAS777",
            body: "GATE 12",
            provider: "hoppie",
          },
        });
      throw new Error(`Unexpected API call: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" />
      </TestQueryProvider>,
    );

    await screen.findByText("No ACARS messages");
    await user.selectOptions(
      screen.getByLabelText("Linked flight (optional)"),
      "flight-1",
    );
    expect(screen.getByLabelText("Recipient station")).toHaveValue("SAS777");
    await user.type(screen.getByLabelText("Message"), "GATE 12");
    await user.click(screen.getByRole("button", { name: "Send telex" }));

    await screen.findByText(/Hoppie accepted the telex to SAS777/);
    const sendCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/acars/messages" && options.method === "POST",
    );
    expect(JSON.parse(sendCall?.[1].body ?? "{}")).toMatchObject({
      to: "SAS777",
      flightId: "flight-1",
    });
  });
});
