import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DispatcherFlightDetail } from "@/components/dispatcher-flight-detail";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("DispatcherFlightDetail concurrency", () => {
  beforeEach(() => {
    apiMock.mockReset();
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
});
