import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FlightTelemetryStatus } from "@/components/flight-telemetry-status";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const current = {
  flightId: "flight-1",
  membershipId: "member-1",
  phase: "airborne",
  latitude: 55.618,
  longitude: 12.656,
  altitudeFeet: 31_000,
  groundSpeedKnots: 448,
  headingDegrees: 24,
  simulatorTime: "2026-08-12T12:00:00.000Z",
  sampleAt: "2026-08-12T12:00:01.000Z",
  sequence: 42,
};

describe("FlightTelemetryStatus", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (
          path === "/flights/flight-1/telemetry?trackLimit=0" &&
          !options.method
        ) {
          return Promise.resolve({
            presence: "online",
            current,
            track: [],
            oooiEvents: [
              {
                id: "event-off",
                eventType: "off",
                occurredAt: "2026-08-12T12:00:01.000Z",
                source: "telemetry",
                actorMembershipId: null,
                deviceId: "device-1",
                reason: null,
                createdAt: "2026-08-12T12:00:01.000Z",
              },
            ],
          });
        }
        if (path === "/flights/flight-1/oooi" && options.method === "PATCH") {
          return Promise.resolve({
            flight: {
              id: "flight-1",
              outAt: "2026-08-12T11:55:00.000Z",
              offAt: "2026-08-12T12:00:01.000Z",
              onAt: null,
              inAt: null,
            },
            oooiEvents: [],
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("shows current simulator presence and automatic OOOI provenance", async () => {
    render(
      <TestQueryProvider>
        <FlightTelemetryStatus slug="vsas" flightId="flight-1" mode="pilot" />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("Simulator online")).toBeVisible();
    expect(screen.getByText("airborne")).toBeVisible();
    expect(screen.getByText(/off · telemetry/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save OOOI correction" }),
    ).not.toBeInTheDocument();
  });

  it("submits only dispatcher-touched OOOI fields with a required reason", async () => {
    const user = userEvent.setup();
    const onOooiUpdated = vi.fn();
    render(
      <TestQueryProvider>
        <FlightTelemetryStatus
          slug="vsas"
          flightId="flight-1"
          mode="dispatcher"
          initialOooi={{
            outAt: null,
            offAt: "2026-08-12T12:00:01.000Z",
            onAt: null,
            inAt: null,
          }}
          onOooiUpdated={onOooiUpdated}
        />
      </TestQueryProvider>,
    );

    const outAt = await screen.findByLabelText("OUT · off blocks");
    fireEvent.change(outAt, { target: { value: "2026-08-12T11:55" } });
    await user.type(
      screen.getByLabelText("Correction reason"),
      "Corrected from the pilot report",
    );
    await user.click(
      screen.getByRole("button", { name: "Save OOOI correction" }),
    );

    await waitFor(() => expect(onOooiUpdated).toHaveBeenCalledOnce());
    const correctionCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/flights/flight-1/oooi" && options.method === "PATCH",
    );
    expect(JSON.parse(correctionCall?.[1].body ?? "{}")).toEqual({
      reason: "Corrected from the pilot report",
      outAt: "2026-08-12T11:55:00.000Z",
    });
    expect(
      await screen.findByText("OOOI timestamps and provenance were updated."),
    ).toBeVisible();
  });

  it("requires a changed field and reason before mutating", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <FlightTelemetryStatus
          slug="vsas"
          flightId="flight-1"
          mode="dispatcher"
        />
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Save OOOI correction" }),
    );
    expect(
      screen.getByText("Change or clear at least one OOOI timestamp."),
    ).toBeVisible();
    expect(
      apiMock.mock.calls.filter(([path]) => path.endsWith("/oooi")),
    ).toHaveLength(0);
  });
});
