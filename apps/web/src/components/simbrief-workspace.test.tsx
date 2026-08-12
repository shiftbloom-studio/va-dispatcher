import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SimbriefWorkspace } from "@/components/simbrief-workspace";
import type {
  DispatchRelease,
  Flight,
  SimbriefDispatch,
} from "@/lib/api/schemas";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const flight: Flight = {
  id: "flight-1",
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: "pilot-1",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-09-10T08:00:00.000Z",
  eta: "2026-09-10T09:20:00.000Z",
  aircraftType: "A320",
  version: 2,
  status: "briefed",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: "Gate changed to C12",
  assignmentRevision: 1,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: "2026-08-01T00:00:00.000Z",
  assignmentConfirmationRequired: false,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:01:00.000Z",
};

const release: DispatchRelease = {
  id: "35000000-0000-4000-8000-000000000001",
  flightId: flight.id,
  revision: 1,
  operationalRoute: "NEXEN Z711 MONAK",
  sid: null,
  star: null,
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
  releaseNotes: null,
  dispatcherRemarks: null,
  releasedByMembershipId: "dispatcher-1",
  releasedAt: "2026-09-01T09:00:00.000Z",
};

const dispatch: SimbriefDispatch = {
  id: "40000000-0000-4000-8000-000000000001",
  flightId: flight.id,
  preparedByMembershipId: "dispatcher-1",
  generatedByMembershipId: null,
  dispatcherName: "Test Dispatcher",
  dispatcherRemarks: null,
  staticId: "VAD_CURRENT",
  status: "prepared",
  revision: 1,
  flightVersion: 1,
  assignmentRevision: 1,
  releaseId: release.id,
  releaseRevision: release.revision,
  request: {},
  ofp: null,
  simbriefRequestId: null,
  generatedAt: null,
  syncedAt: null,
  lastError: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

describe("SimbriefWorkspace planning freshness", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("keeps launch enabled when only the coarse flight version changed", async () => {
    mockWorkspaceApi(dispatch.id);

    renderWorkspace();

    expect(
      await screen.findByRole("button", { name: "Open SimBrief" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/material planning details/i),
    ).not.toBeInTheDocument();
  });

  it("disables launch when the server marks the planning snapshot stale", async () => {
    mockWorkspaceApi(null);

    renderWorkspace();

    expect(
      await screen.findByRole("button", { name: "Open SimBrief" }),
    ).toBeDisabled();
    expect(screen.getByText(/material planning details/i)).toBeInTheDocument();
  });
});

function mockWorkspaceApi(currentDispatchId: string | null) {
  apiMock.mockImplementation((path: string) => {
    if (path === `/flights/${flight.id}/simbrief/dispatches`) {
      return Promise.resolve({ items: [dispatch], currentDispatchId });
    }
    if (path === "/simbrief/connection") {
      return Promise.resolve({
        connection: {
          connected: true,
          userId: "123456",
          verified: true,
          verifiedAt: "2026-08-01T00:00:00.000Z",
          oauth: {
            configured: false,
            connected: false,
            username: null,
            connectedAt: null,
          },
        },
      });
    }
    throw new Error(`Unexpected API call: ${path}`);
  });
}

function renderWorkspace() {
  render(
    <TestQueryProvider>
      <SimbriefWorkspace
        slug="vsas"
        flight={flight}
        release={release}
        mode="pilot"
      />
    </TestQueryProvider>,
  );
}
