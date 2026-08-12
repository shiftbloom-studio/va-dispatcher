import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OfferBuilder } from "@/components/offer-builder";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

describe("OfferBuilder", () => {
  beforeEach(() => apiMock.mockReset());

  it("renders and submits exactly the requested flight count", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      flights: [],
      fulfillment: {
        scheduleRequestId: "request-1",
        requestStatus: "fulfilled",
        requestVersion: 4,
        linkedFlightCount: 2,
        remainingFlightCount: 0,
        flightIds: ["flight-1", "flight-2"],
      },
    });
    const onOffered = vi.fn().mockResolvedValue(undefined);
    render(
      <TestQueryProvider>
        <OfferBuilder
          slug="vsas"
          requestId="request-1"
          desiredFlightCount={2}
          expectedRequestVersion={3}
          onOffered={onOffered}
        />
      </TestQueryProvider>,
    );
    expect(screen.getByText("Flight 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Flight 2 of 2")).toBeInTheDocument();

    for (const [index, values] of [
      [0, ["SK101", "EKCH", "ENGM", "2026-09-10T08:00", "2026-09-10T09:20"]],
      [1, ["SK102", "ENGM", "EKCH", "2026-09-11T08:00", "2026-09-11T09:20"]],
    ] as const) {
      await user.type(
        screen.getByLabelText(`Flight number`, {
          selector: `#offer-${index}-flight-number`,
        }),
        values[0],
      );
      await user.type(
        screen.getByLabelText(`Departure ICAO`, {
          selector: `#offer-${index}-departure`,
        }),
        values[1],
      );
      await user.type(
        screen.getByLabelText(`Arrival ICAO`, {
          selector: `#offer-${index}-arrival`,
        }),
        values[2],
      );
      fireEvent.change(
        screen.getByLabelText(`ETD (UTC)`, { selector: `#offer-${index}-etd` }),
        { target: { value: values[3] } },
      );
      fireEvent.change(
        screen.getByLabelText(`ETA (UTC)`, { selector: `#offer-${index}-eta` }),
        { target: { value: values[4] } },
      );
    }
    await user.click(
      screen.getByRole("button", { name: "Offer flight batch" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(apiMock.mock.calls[0][1].body);
    expect(payload.scheduleRequestId).toBe("request-1");
    expect(payload.expectedRequestVersion).toBe(3);
    expect(payload.flights).toHaveLength(2);
    expect(apiMock.mock.calls[0][1].headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(payload.flights[0]).toMatchObject({
      flightNumber: "SK101",
      depIcao: "EKCH",
      arrIcao: "ENGM",
    });
    expect(onOffered).toHaveBeenCalled();
  });

  it("offers one flight now and leaves the remainder for a follow-up batch", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      flights: [],
      fulfillment: {
        scheduleRequestId: "request-1",
        requestStatus: "partially_fulfilled",
        requestVersion: 5,
        linkedFlightCount: 2,
        remainingFlightCount: 1,
        flightIds: ["flight-1"],
      },
    });
    const onOffered = vi.fn().mockResolvedValue(undefined);
    render(
      <TestQueryProvider>
        <OfferBuilder
          slug="vsas"
          requestId="request-1"
          desiredFlightCount={3}
          flightCount={2}
          expectedRequestVersion={4}
          onOffered={onOffered}
        />
      </TestQueryProvider>,
    );

    expect(screen.getByText("Flight 2 of 2")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Flights in this batch"),
      "1",
    );
    expect(screen.queryByText("Flight 2 of 2")).not.toBeInTheDocument();
    expect(screen.getByText("Flight 1 of 1")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Flight number"), "SK201");
    await user.type(screen.getByLabelText("Departure ICAO"), "EKCH");
    await user.type(screen.getByLabelText("Arrival ICAO"), "ESSA");
    fireEvent.change(screen.getByLabelText("ETD (UTC)"), {
      target: { value: "2026-09-10T10:00" },
    });
    fireEvent.change(screen.getByLabelText("ETA (UTC)"), {
      target: { value: "2026-09-10T11:10" },
    });
    await user.click(
      screen.getByRole("button", { name: "Offer flight batch" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(apiMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      scheduleRequestId: "request-1",
      expectedRequestVersion: 4,
    });
    expect(payload.flights).toHaveLength(1);
    expect(
      screen.getByText(/1 will remain for a follow-up batch/i),
    ).toBeInTheDocument();
  });

  it("reuses one idempotency key when the dispatcher retries a failed submission", async () => {
    const user = userEvent.setup();
    apiMock
      .mockRejectedValueOnce(new Error("synthetic network failure"))
      .mockResolvedValueOnce({
        flights: [],
        fulfillment: {
          scheduleRequestId: "request-1",
          requestStatus: "fulfilled",
          requestVersion: 2,
          linkedFlightCount: 1,
          remainingFlightCount: 0,
          flightIds: ["flight-1"],
        },
      });

    render(
      <TestQueryProvider>
        <OfferBuilder
          slug="vsas"
          requestId="request-1"
          desiredFlightCount={1}
          expectedRequestVersion={1}
          onOffered={vi.fn().mockResolvedValue(undefined)}
        />
      </TestQueryProvider>,
    );

    await user.type(screen.getByLabelText("Flight number"), "SK301");
    await user.type(screen.getByLabelText("Departure ICAO"), "EKCH");
    await user.type(screen.getByLabelText("Arrival ICAO"), "ENGM");
    fireEvent.change(screen.getByLabelText("ETD (UTC)"), {
      target: { value: "2026-09-10T12:00" },
    });
    fireEvent.change(screen.getByLabelText("ETA (UTC)"), {
      target: { value: "2026-09-10T13:20" },
    });

    const submit = screen.getByRole("button", { name: "Offer flight batch" });
    await user.click(submit);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await user.click(submit);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    const firstKey = apiMock.mock.calls[0][1].headers["Idempotency-Key"];
    const secondKey = apiMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondKey).toBe(firstKey);
  });
});
