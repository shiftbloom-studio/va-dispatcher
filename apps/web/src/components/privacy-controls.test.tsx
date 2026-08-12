import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CookieSettingsButton,
  PrivacyControls,
} from "@/components/privacy-controls";
import {
  PRIVACY_PREFERENCES_STORAGE_KEY,
  savePrivacyPreferences,
} from "@/lib/privacy-storage";

const storageValues = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageValues.set(key, value);
    },
    removeItem: (key: string) => {
      storageValues.delete(key);
    },
    clear: () => {
      storageValues.clear();
    },
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    get length() {
      return storageValues.size;
    },
  } satisfies Storage,
});

describe("PrivacyControls", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps optional analytics off when the user continues without it", async () => {
    const user = userEvent.setup();
    render(<PrivacyControls />);

    expect(await screen.findByLabelText("Cookie notice")).toBeVisible();
    expect(screen.getByText(/stay off unless you allow them/i)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Continue without analytics" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument(),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY) ?? "{}",
      ),
    ).toMatchObject({ analyticsAllowed: false });
  });

  it("allows anonymous analytics only after an explicit choice", async () => {
    const user = userEvent.setup();
    render(<PrivacyControls />);

    await user.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Allow analytics" }));

    expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument();
    expect(screen.getByText("Allowed")).toBeVisible();
    expect(
      JSON.parse(
        window.localStorage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY) ?? "{}",
      ),
    ).toMatchObject({ analyticsAllowed: true });
  });

  it("does not show the notice again for current preferences", async () => {
    savePrivacyPreferences(
      window.localStorage,
      false,
      new Date("2026-08-12T12:00:00.000Z"),
    );

    render(<PrivacyControls />);

    await waitFor(() =>
      expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument(),
    );
  });

  it("keeps details accessible and lets the user show the notice again", async () => {
    const user = userEvent.setup();
    savePrivacyPreferences(window.localStorage, false);
    render(
      <>
        <PrivacyControls />
        <CookieSettingsButton />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByText("Authentication and security")).toBeVisible();
    expect(screen.getByText("Always active")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show notice again" }));
    expect(await screen.findByLabelText("Cookie notice")).toBeVisible();
    expect(
      window.localStorage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY),
    ).toBeNull();
  });
});
