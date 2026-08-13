import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dispatcher-dashboard", () => ({
  DispatcherDashboard: ({ slug, view }: { slug: string; view: string }) => (
    <div data-testid="dispatcher-dashboard">
      {slug}:{view}
    </div>
  ),
}));

import DispatchPage from "./page";

describe("dispatcher page", () => {
  it.each([
    [undefined, "operations"],
    ["requests", "requests"],
    ["flights", "flights"],
    ["unknown", "operations"],
    [["flights"], "operations"],
  ])("resolves the %j query to the %s view", async (query, expected) => {
    render(
      await DispatchPage({
        params: Promise.resolve({ slug: "vsas" }),
        searchParams: Promise.resolve({ view: query }),
      }),
    );

    expect(screen.getByTestId("dispatcher-dashboard")).toHaveTextContent(
      `vsas:${expected}`,
    );
  });
});
