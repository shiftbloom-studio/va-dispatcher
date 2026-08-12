import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleRequestForm } from "@/components/schedule-request-form";
import { ApiError } from "@/lib/api/http";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();
const pushMock = vi.fn();
const backMock = vi.fn();

const request = {
  id: "request-1",
  pilotMembershipId: "member-1",
  title: "September pair",
  notes: "Original notes",
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
  version: 3,
  status: "pending" as const,
  rejectReason: null,
  cancelReason: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

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

  it("prepopulates and version-checks a pending pilot edit", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ request: { ...request, version: 4 } });
    render(
      <TestQueryProvider>
        <ScheduleRequestForm slug="vsas" request={request} />
      </TestQueryProvider>,
    );

    expect(screen.getByLabelText("Start (UTC)")).toHaveValue(
      "2026-09-10T08:00",
    );
    await user.clear(screen.getByLabelText("Title (optional)"));
    await user.type(screen.getByLabelText("Title (optional)"), "Updated pair");
    await user.click(screen.getByRole("button", { name: "Save request" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[0][0]).toBe("/schedule-requests/request-1");
    expect(apiMock.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(apiMock.mock.calls[0][1].body)).toMatchObject({
      expectedVersion: 3,
      title: "Updated pair",
      windowStart: "2026-09-10T08:00:00.000Z",
      windowEnd: "2026-09-10T12:00:00.000Z",
    });
  });

  it("shows a reload warning when a pilot edit loses a race", async () => {
    const user = userEvent.setup();
    apiMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "Schedule request changed since it was loaded",
      }),
    );
    render(
      <TestQueryProvider>
        <ScheduleRequestForm slug="vsas" request={request} />
      </TestQueryProvider>,
    );
    await user.clear(screen.getByLabelText("Title (optional)"));
    await user.type(screen.getByLabelText("Title (optional)"), "Stale edit");
    await user.click(screen.getByRole("button", { name: "Save request" }));

    expect(
      await screen.findByText(/changed while you were editing/i),
    ).toBeInTheDocument();
  });
});
