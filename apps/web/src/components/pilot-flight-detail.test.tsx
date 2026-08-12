import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotFlightDetail } from "@/components/pilot-flight-detail";
import type { Flight } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/http";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const offeredFlight: Flight = {
  id: "flight-1",
  scheduleRequestId: "request-1",
  replacesFlightId: null,
  pilotMembershipId: "member-1",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-09-10T08:00:00.000Z",
  eta: "2026-09-10T09:20:00.000Z",
  aircraftType: "A320",
  version: 1,
  status: "offered",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: null,
  assignmentConfirmedAt: null,
  assignmentConfirmationRequired: false,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("PilotFlightDetail decisions", () => {
  beforeEach(() => {
    apiMock.mockReset();
    let currentFlight = offeredFlight;
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/flights/flight-1" && !options.method)
        return Promise.resolve({
          flight: currentFlight,
          release: null,
          releaseRevisions: [],
          events: [],
        });
      if (path === "/flights/flight-1/simbrief/dispatches")
        return Promise.resolve({ items: [] });
      if (path === "/simbrief/connection")
        return Promise.resolve({
          connection: {
            connected: false,
            userId: null,
            verified: false,
            verifiedAt: null,
            oauth: {
              configured: false,
              connected: false,
              username: null,
              connectedAt: null,
            },
          },
        });
      if (path === "/flights/flight-1/decline") {
        currentFlight = {
          ...offeredFlight,
          status: "declined",
          declinedReason: "Schedule conflict",
        };
        return Promise.resolve({
          flight: currentFlight,
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
  });

  it("sends an optional decline reason and advances to a read-only state", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <PilotFlightDetail slug="vsas" flightId="flight-1" />
      </TestQueryProvider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Decline flight" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Schedule conflict",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Decline flight" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/flights/flight-1/decline",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const declineCall = apiMock.mock.calls.find(
      ([path]) => path === "/flights/flight-1/decline",
    );
    expect(JSON.parse(declineCall![1].body)).toEqual({
      expectedVersion: 1,
      reason: "Schedule conflict",
    });
    expect(
      await screen.findByText("This flight is read-only in its current state."),
    ).toBeInTheDocument();
  });

  it("reloads the latest flight after a stale pilot response", async () => {
    apiMock.mockReset();
    let reads = 0;
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/flights/flight-1" && !options.method) {
        reads += 1;
        return Promise.resolve({
          flight:
            reads === 1
              ? offeredFlight
              : { ...offeredFlight, status: "cancelled", version: 2 },
          release: null,
          releaseRevisions: [],
          events: [],
        });
      }
      if (path === "/flights/flight-1/decline") {
        return Promise.reject(
          new ApiError({
            status: 409,
            code: "CONFLICT",
            message: "Flight changed since it was loaded",
          }),
        );
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <PilotFlightDetail slug="vsas" flightId="flight-1" />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Decline flight" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Decline flight",
      }),
    );

    expect(
      await screen.findByText(/current state has been reloaded/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
  });

  it("surfaces SimBrief callback recovery on the flight workspace", async () => {
    render(
      <TestQueryProvider>
        <PilotFlightDetail
          slug="vsas"
          flightId="flight-1"
          simbriefRecovery="ready"
        />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText(/SimBrief returned successfully/i),
    ).toBeVisible();
  });
});
