import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotDashboard } from "@/components/pilot-dashboard";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({ useApi: () => apiMock }));

const baseFlight = {
  id: "flight-upcoming",
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: "pilot-1",
  flightNumber: "SK901",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-08-13T08:00:00.000Z",
  eta: "2026-08-13T09:20:00.000Z",
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

describe("pilot dashboard flight groups", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/schedule-requests")) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      if (path.startsWith("/flights")) {
        return Promise.resolve({
          items: [
            baseFlight,
            {
              ...baseFlight,
              id: "flight-active",
              flightNumber: "SK902",
              status: "active",
            },
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
  });

  it("keeps a pilot's active flight in a visible in-progress group", async () => {
    render(
      <TestQueryProvider>
        <PilotDashboard slug="vsas" />
      </TestQueryProvider>,
    );

    const heading = await screen.findByRole("heading", {
      name: "Active flights",
    });
    const group = heading.closest<HTMLElement>(".overflow-hidden");
    expect(group).not.toBeNull();
    expect(within(group!).getByText("SK902")).toBeVisible();
    expect(within(group!).queryByText("SK901")).not.toBeInTheDocument();
    expect(within(group!).getByRole("link", { name: /SK902/ })).toHaveAttribute(
      "href",
      "/vsas/portal/flights/flight-active",
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/flights?status=active&limit=100",
      expect.any(Object),
    );
  });
});
