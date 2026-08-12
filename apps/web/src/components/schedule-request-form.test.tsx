import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleRequestForm } from "@/components/schedule-request-form";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();
const pushMock = vi.fn();
const backMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}));

describe("ScheduleRequestForm", () => {
  beforeEach(() => {
    apiMock.mockReset();
    pushMock.mockReset();
  });

  it("submits normalized UTC availability in the flexible preferences field", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ request: { id: "request-1" } });
    render(
      <TestQueryProvider>
        <ScheduleRequestForm slug="vsas" />
      </TestQueryProvider>,
    );

    await user.clear(screen.getByLabelText("Number of flights"));
    await user.type(screen.getByLabelText("Number of flights"), "2");
    fireEvent.change(screen.getByLabelText("Start (UTC)"), {
      target: { value: "2026-09-10T08:00" },
    });
    fireEvent.change(screen.getByLabelText("End (UTC)"), {
      target: { value: "2026-09-10T12:00" },
    });
    await user.type(
      screen.getByLabelText("Title (optional)"),
      "September pair",
    );
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const [, options] = apiMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      desiredFlightCount: 2,
      windowStart: "2026-09-10T08:00:00.000Z",
      windowEnd: "2026-09-10T12:00:00.000Z",
      preferences: {
        availability: [
          {
            startAt: "2026-09-10T08:00:00.000Z",
            endAt: "2026-09-10T12:00:00.000Z",
          },
        ],
      },
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/vsas/portal/schedule-requests/request-1",
    );
  });

  it("blocks overlapping intervals before an API call", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <ScheduleRequestForm slug="vsas" />
      </TestQueryProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Add interval" }));
    const starts = screen.getAllByLabelText(/Start \(UTC\)/);
    const ends = screen.getAllByLabelText(/End \(UTC\)/);
    fireEvent.change(starts[0], { target: { value: "2026-09-10T08:00" } });
    fireEvent.change(ends[0], { target: { value: "2026-09-10T12:00" } });
    fireEvent.change(starts[1], { target: { value: "2026-09-10T11:00" } });
    fireEvent.change(ends[1], { target: { value: "2026-09-10T14:00" } });
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(
      await screen.findByText("Availability intervals cannot overlap."),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
