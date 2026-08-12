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
    apiMock.mockResolvedValue({ flights: [] });
    const onOffered = vi.fn().mockResolvedValue(undefined);
    render(
      <TestQueryProvider>
        <OfferBuilder
          slug="vsas"
          requestId="request-1"
          desiredFlightCount={2}
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
      screen.getByRole("button", { name: "Offer complete schedule" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(apiMock.mock.calls[0][1].body);
    expect(payload.scheduleRequestId).toBe("request-1");
    expect(payload.flights).toHaveLength(2);
    expect(payload.flights[0]).toMatchObject({
      flightNumber: "SK101",
      depIcao: "EKCH",
      arrIcao: "ENGM",
    });
    expect(onOffered).toHaveBeenCalled();
  });
});
