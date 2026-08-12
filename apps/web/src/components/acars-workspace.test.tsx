import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcarsWorkspace } from "@/components/acars-workspace";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();
const getHealthMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("ACARS compose", () => {
  beforeEach(() => {
    let attempts = 0;
    apiMock.mockReset();
    getHealthMock.mockReset().mockResolvedValue({
      ok: true,
      service: "api",
      database: true,
      acarsProvider: "hoppie",
    });
    apiMock.mockImplementation((path: string, options: { method?: string }) => {
      if (path === "/dispatch/inbox")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/flights?limit=100")
        return Promise.resolve({ items: [], nextCursor: null });
      if (path === "/acars/messages" && options.method === "POST") {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("Provider unavailable"))
          : Promise.resolve({
              message: {
                id: "m1",
                direction: "outbound",
                fromStation: "VSAS",
                toStation: "SAS101",
                body: "HELLO",
                provider: "mock",
              },
            });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
  });

  it("retains a failed draft and retries only after a manual action", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AcarsWorkspace slug="vsas" />
      </TestQueryProvider>,
    );
    await screen.findByText("No ACARS messages");
    await user.type(screen.getByLabelText("Recipient station"), "sas101");
    await user.type(screen.getByLabelText("Message"), "HELLO FROM OPS");
    await user.click(screen.getByRole("button", { name: "Send telex" }));

    expect(
      await screen.findByRole("button", { name: "Retry send" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("HELLO FROM OPS");
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/acars/messages"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry send" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Message")).toHaveValue(""),
    );
    expect(screen.getByText("Telex sent to SAS101.")).toBeInTheDocument();
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/acars/messages"),
    ).toHaveLength(2);
  });
});
