import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterOptionalTelemetryEvent,
  OptionalTelemetry,
} from "@/components/optional-telemetry";
import {
  PRIVACY_PREFERENCES_CHANGED_EVENT,
  PRIVACY_PREFERENCES_STORAGE_KEY,
  savePrivacyPreferences,
} from "@/lib/privacy-storage";

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe("OptionalTelemetry", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PRIVACY_PREFERENCES_STORAGE_KEY);
  });

  it("does not load telemetry before consent", async () => {
    render(<OptionalTelemetry />);

    await waitFor(() => {
      expect(screen.queryByTestId("analytics")).not.toBeInTheDocument();
      expect(screen.queryByTestId("speed-insights")).not.toBeInTheDocument();
    });
  });

  it("loads telemetry for a stored affirmative choice", async () => {
    savePrivacyPreferences(window.localStorage, true);

    render(<OptionalTelemetry />);

    expect(await screen.findByTestId("analytics")).toBeInTheDocument();
    expect(screen.getByTestId("speed-insights")).toBeInTheDocument();
  });

  it("blocks events after withdrawal while keeping initialized clients stable", async () => {
    savePrivacyPreferences(window.localStorage, true);
    render(<OptionalTelemetry />);
    expect(await screen.findByTestId("analytics")).toBeInTheDocument();

    savePrivacyPreferences(window.localStorage, false);
    window.dispatchEvent(new Event(PRIVACY_PREFERENCES_CHANGED_EVENT));

    expect(screen.getByTestId("analytics")).toBeInTheDocument();
    expect(filterOptionalTelemetryEvent({ type: "pageview" })).toBeNull();
  });

  it("applies preference changes received from another tab", async () => {
    savePrivacyPreferences(window.localStorage, true);
    render(<OptionalTelemetry />);
    expect(await screen.findByTestId("analytics")).toBeInTheDocument();

    savePrivacyPreferences(window.localStorage, false);
    window.dispatchEvent(new StorageEvent("storage"));

    expect(screen.getByTestId("analytics")).toBeInTheDocument();
    expect(filterOptionalTelemetryEvent({ type: "pageview" })).toBeNull();
  });

  it("checks current consent before every telemetry event", () => {
    const event = { type: "pageview", url: "/vsas" };

    expect(filterOptionalTelemetryEvent(event)).toBeNull();
    savePrivacyPreferences(window.localStorage, true);
    expect(filterOptionalTelemetryEvent(event)).toBe(event);
  });
});
