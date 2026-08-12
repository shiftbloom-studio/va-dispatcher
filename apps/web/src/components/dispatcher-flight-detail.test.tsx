import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DispatcherFlightDetail } from "@/components/dispatcher-flight-detail";
import { ApiError } from "@/lib/api/http";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const flight = {
  id: "flight-1",
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: "member-1",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-09-10T08:00:00.000Z",
  eta: "2026-09-10T09:20:00.000Z",
  aircraftType: "A320",
  version: 1,
  status: "accepted",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: "2026-08-01T00:00:00.000Z",
  assignmentConfirmationRequired: false,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const release = {
  id: "35000000-0000-4000-8000-000000000001",
  flightId: flight.id,
  revision: 4,
  operationalRoute: "NEXEN Z711 MONAK",
  sid: "NEXEN2A",
  star: "MONAK3M",
  cruiseLevel: 350,
  alternateIcao: "ESSA",
  fuelUnit: "kg",
  payloadUnit: "kg",
  taxiFuel: 200,
  tripFuel: 4_000,
  contingencyFuel: 200,
  alternateFuel: 700,
  finalReserveFuel: 900,
  additionalFuel: 0,
  blockFuel: 6_000,
  plannedPayload: 14_000,
  weatherSnapshot: {},
  releaseNotes: "Review NOTAMs",
  dispatcherRemarks: "Dispatch release remarks",
  releasedByMembershipId: "dispatcher-1",
  releasedAt: "2026-09-01T09:00:00.000Z",
};

describe("DispatcherFlightDetail concurrency", () => {
  beforeEach(() => {
    apiMock.mockReset();
    routerPush.mockReset();
  });

  it("sends the expected version and reloads after a concurrent edit", async () => {
    let reads = 0;
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/flights/flight-1" && !options.method) {
          reads += 1;
          return Promise.resolve({
            flight:
              reads === 1
                ? flight
                : {
                    ...flight,
                    aircraftType: "A319",
                    version: 2,
                    updatedAt: "2026-08-01T00:01:00.000Z",
                  },
          });
        }
        if (path === "/members") {
          return Promise.resolve({
            items: [
              {
                id: "member-1",
                role: "pilot",
                displayName: "Test Pilot",
                pilotCallsign: "SAS101",
                status: "active",
              },
            ],
          });
        }
        if (path === "/flights/flight-1" && options.method === "PATCH") {
          expect(JSON.parse(options.body ?? "{}")).toMatchObject({
            expectedVersion: 1,
            aircraftType: "A321",
            changeReason: "Aircraft substitution",
          });
          return Promise.reject(
            new ApiError({
              status: 409,
              code: "CONFLICT",
              message: "Flight changed since it was loaded",
            }),
          );
        }
        throw new Error(
          `Unexpected API call: ${String(path)} ${JSON.stringify(options)}`,
        );
      },
    );

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <DispatcherFlightDetail slug="vsas" flightId="flight-1" />
      </TestQueryProvider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit flight" }),
    );
    await user.clear(screen.getByLabelText("Aircraft"));
    await user.type(screen.getByLabelText("Aircraft"), "A321");
    await user.type(
      screen.getByLabelText("Change reason (required for material changes)"),
      "Aircraft substitution",
    );
    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(
      await screen.findByText(/changed while you were editing/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
  });

  it("navigates to the winning replacement after a concurrent re-offer", async () => {
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/flights/flight-1" && !options.method) {
          return Promise.resolve({
            flight: { ...flight, status: "declined" },
          });
        }
        if (path === "/members") {
          return Promise.resolve({
            items: [
              {
                id: "member-1",
                role: "pilot",
                displayName: "Test Pilot",
                pilotCallsign: "SAS101",
                status: "active",
              },
            ],
          });
        }
        if (path === "/flights/flight-1/reoffer") {
          expect(JSON.parse(options.body ?? "{}")).toMatchObject({
            expectedVersion: 1,
            reason: "Availability restored",
          });
          return Promise.reject(
            new ApiError({
              status: 409,
              code: "CONFLICT",
              message: "A replacement offer already exists",
              details: { replacement: { id: "flight-replacement" } },
            }),
          );
        }
        throw new Error(
          `Unexpected API call: ${String(path)} ${JSON.stringify(options)}`,
        );
      },
    );

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <DispatcherFlightDetail slug="vsas" flightId="flight-1" />
      </TestQueryProvider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Create replacement offer" }),
    );
    await user.type(
      screen.getByLabelText("Replacement reason (required)"),
      "Availability restored",
    );
    const confirmButtons = screen.getAllByRole("button", {
      name: "Create replacement offer",
    });
    await user.click(confirmButtons.at(-1)!);

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        "/vsas/dispatch/flights/flight-replacement",
      ),
    );
  });

  it("prepares SimBrief only from the immutable current release", async () => {
    const currentFlight = {
      ...flight,
      status: "briefed",
      version: 3,
      assignmentRevision: 2,
    };
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string } = {}) => {
        if (path === "/flights/flight-1" && !options.method) {
          return Promise.resolve({
            flight: currentFlight,
            release,
            releaseRevisions: [release],
            events: [],
          });
        }
        if (path === "/members") {
          return Promise.resolve({
            items: [
              {
                id: "member-1",
                role: "pilot",
                displayName: "Test Pilot",
                pilotCallsign: "SAS101",
                status: "active",
              },
            ],
          });
        }
        if (
          path === "/flights/flight-1/simbrief/dispatches" &&
          !options.method
        ) {
          return Promise.resolve({ items: [] });
        }
        if (
          path === "/flights/flight-1/simbrief/dispatches" &&
          options.method === "POST"
        ) {
          expect(JSON.parse(options.body ?? "{}")).toEqual({
            expectedFlightVersion: 3,
            expectedAssignmentRevision: 2,
            releaseId: "35000000-0000-4000-8000-000000000001",
            releaseRevision: 4,
          });
          return Promise.resolve({ dispatch: {} });
        }
        throw new Error(
          `Unexpected API call: ${String(path)} ${JSON.stringify(options)}`,
        );
      },
    );

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <DispatcherFlightDetail slug="vsas" flightId="flight-1" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("Prepare immutable release R4"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Route")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Dispatcher remarks"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Prepare SimBrief from R4" }),
    );
    expect(
      await screen.findByText(
        /SimBrief preparation saved from immutable release R4/i,
      ),
    ).toBeInTheDocument();
  });
});
