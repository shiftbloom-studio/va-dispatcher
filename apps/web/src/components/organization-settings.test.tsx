import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationSettings } from "@/components/organization-settings";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const tenant = {
  id: "tenant-vsas",
  slug: "vsas",
  name: "Virtual SAS",
  hoppieStation: "VSAS",
  hasHoppieLogon: false,
  acarsProvider: "hoppie",
  hoppiePollingEnabled: false,
  hoppieLastTestedAt: null,
  brand: {
    seedColor: "#e64646",
    presence: "balanced",
    logoUrl: null,
  },
  settings: {},
};

describe("organization settings", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/tenant" && !options.method)
          return Promise.resolve(tenant);
        if (path === "/tenant/acars-config" && options.method === "PUT") {
          return Promise.resolve({
            hoppieStation: "SAS",
            hasHoppieLogon: true,
            acarsProvider: "hoppie",
            hoppiePollingEnabled: true,
            hoppieLastTestedAt: "2026-08-12T12:00:00.000Z",
          });
        }
        if (path === "/tenant/brand" && options.method === "PATCH") {
          const body = JSON.parse(options.body ?? "{}");
          return Promise.resolve({
            brand: {
              seedColor: body.seedColor,
              presence: body.presence,
              logoUrl: null,
            },
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("tests and saves the tenant ground-station credential", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <OrganizationSettings slug="vsas" />
      </TestQueryProvider>,
    );

    const station = await screen.findByLabelText("Ground-station callsign");
    await user.clear(station);
    await user.type(station, "sas");
    await user.type(
      screen.getByLabelText("Ground-station Hoppie logon"),
      "private-logon",
    );
    await user.click(screen.getByRole("button", { name: "Test and save" }));

    expect(
      await screen.findByText(/Hoppie accepted the credential test/),
    ).toBeInTheDocument();
    const configCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/tenant/acars-config" && options.method === "PUT",
    );
    expect(JSON.parse(configCall?.[1].body ?? "{}")).toEqual({
      hoppieStation: "SAS",
      hoppieLogon: "private-logon",
    });
    await waitFor(() =>
      expect(screen.getByText("Connected")).toBeInTheDocument(),
    );
  });

  it("previews and saves the one-color airline identity", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <OrganizationSettings slug="vsas" />
      </TestQueryProvider>,
    );

    const color = await screen.findByLabelText("Hex value");
    await user.clear(color);
    await user.type(color, "#174ea6");
    await user.click(screen.getByRole("radio", { name: /High visibility/ }));
    await user.click(screen.getByRole("button", { name: "Save identity" }));

    const brandCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/tenant/brand" && options.method === "PATCH",
    );
    expect(JSON.parse(brandCall?.[1].body ?? "{}")).toEqual({
      seedColor: "#174ea6",
      presence: "high",
    });
    expect(
      await screen.findByText("Brand color and presence saved."),
    ).toBeInTheDocument();
  });
});
