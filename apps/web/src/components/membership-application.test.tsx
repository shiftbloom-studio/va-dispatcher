import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembershipApplication } from "@/components/membership-application";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  OrganizationList: (props: Record<string, unknown>) => (
    <div
      data-after-select={String(props.afterSelectOrganizationUrl)}
      data-testid="organization-list"
    />
  ),
  SignOutButton: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/api/use-api", () => ({
  useApi: () => apiMock,
  jsonBody: (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  }),
}));

const openApplicationState = {
  applicationsEnabled: true,
  allowedRoles: ["pilot", "dispatcher"],
  application: null,
};

describe("tenant membership application", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(
      (path: string, options: { method?: string; body?: string }) => {
        if (path === "/membership-application?tenantSlug=vsas") {
          return Promise.resolve(openApplicationState);
        }
        if (path === "/membership-application" && options.method === "POST") {
          const body = JSON.parse(options.body ?? "{}");
          return Promise.resolve({
            ...openApplicationState,
            application: {
              state: "pending",
              requestedRole: body.requestedRole,
              displayName: "Applicant",
              submittedAt: "2026-08-13T00:00:00.000Z",
              updatedAt: "2026-08-13T00:00:00.000Z",
            },
            submitted: true,
          });
        }
        throw new Error(
          `Unexpected API call: ${options.method ?? "GET"} ${path}`,
        );
      },
    );
  });

  it("submits the selected role and keeps the applicant outside operations", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <MembershipApplication slug="vsas" tenantName="Virtual SAS" />
      </TestQueryProvider>,
    );

    await user.selectOptions(
      await screen.findByLabelText("Requested role"),
      "dispatcher",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit application" }),
    );

    const submitCall = apiMock.mock.calls.find(
      ([path, options]) =>
        path === "/membership-application" && options.method === "POST",
    );
    expect(JSON.parse(submitCall?.[1].body ?? "{}")).toEqual({
      tenantSlug: "vsas",
      requestedRole: "dispatcher",
    });
    expect(await screen.findByText("Application pending")).toBeInTheDocument();
    expect(screen.getByTestId("organization-list")).toHaveAttribute(
      "data-after-select",
      "/:slug",
    );
  });

  it("shows a closed policy without an access-granting action", async () => {
    apiMock.mockResolvedValue({
      applicationsEnabled: false,
      allowedRoles: [],
      application: null,
    });

    render(
      <TestQueryProvider>
        <MembershipApplication slug="vsas" tenantName="Virtual SAS" />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText(/Membership applications are currently closed/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit application" }),
    ).not.toBeInTheDocument();
  });
});
