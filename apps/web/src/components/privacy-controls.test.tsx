import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CookieSettingsButton,
  PrivacyControls,
} from "@/components/privacy-controls";
import {
  COOKIE_NOTICE_STORAGE_KEY,
  saveCookieNotice,
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

  it("shows an accurate necessary-storage notice and remembers dismissal", async () => {
    const user = userEvent.setup();
    render(<PrivacyControls />);

    expect(await screen.findByLabelText("Cookie notice")).toBeVisible();
    expect(
      screen.getByText(/do not use analytics, advertising, or marketing/i),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Understood" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument(),
    );
    expect(
      window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY),
    ).not.toBeNull();
  });

  it("acknowledges from settings and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<PrivacyControls />);

    await user.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");

    await user.click(
      screen.getByRole("button", { name: "Acknowledge notice" }),
    );

    expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument();
  });

  it("does not show the notice again for the current acknowledged version", async () => {
    saveCookieNotice(window.localStorage, new Date("2026-08-12T12:00:00.000Z"));

    render(<PrivacyControls />);

    await waitFor(() =>
      expect(screen.queryByLabelText("Cookie notice")).not.toBeInTheDocument(),
    );
  });

  it("keeps details accessible and lets the user show the notice again", async () => {
    const user = userEvent.setup();
    saveCookieNotice(window.localStorage);
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
    expect(window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY)).toBeNull();
  });
});
