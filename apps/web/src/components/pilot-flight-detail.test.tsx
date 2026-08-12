import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotFlightDetail } from "@/components/pilot-flight-detail";
import type { Flight } from "@/lib/api/schemas";
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
  pilotMembershipId: "member-1",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-09-10T08:00:00.000Z",
  eta: "2026-09-10T09:20:00.000Z",
  aircraftType: "A320",
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
      reason: "Schedule conflict",
    });
    expect(
      await screen.findByText("This flight is read-only in its current state."),
    ).toBeInTheDocument();
  });
});
