import { describe, expect, it, vi } from "vitest";

import { LEGAL_NOTICE_VERSION } from "@/lib/legal";
import {
  PRIVACY_PREFERENCES_STORAGE_KEY,
  clearPrivacyPreferences,
  parsePrivacyPreferencesRecord,
  readPrivacyPreferences,
  savePrivacyPreferences,
} from "@/lib/privacy-storage";

describe("privacy-preference storage", () => {
  it("accepts only the current, well-formed notice version", () => {
    const current = JSON.stringify({
      version: LEGAL_NOTICE_VERSION,
      decidedAt: "2026-08-12T12:00:00.000Z",
      analyticsAllowed: true,
    });

    expect(parsePrivacyPreferencesRecord(current)).toEqual({
      version: LEGAL_NOTICE_VERSION,
      decidedAt: "2026-08-12T12:00:00.000Z",
      analyticsAllowed: true,
    });
    expect(
      parsePrivacyPreferencesRecord(
        JSON.stringify({
          version: "old-version",
          decidedAt: "2026-08-12T12:00:00.000Z",
          analyticsAllowed: true,
        }),
      ),
    ).toBeNull();
    expect(
      parsePrivacyPreferencesRecord(
        JSON.stringify({
          version: LEGAL_NOTICE_VERSION,
          decidedAt: "2026-08-12T12:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(parsePrivacyPreferencesRecord("not-json")).toBeNull();
  });

  it("writes, reads, and clears the acknowledgement", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    savePrivacyPreferences(
      storage,
      false,
      new Date("2026-08-12T12:00:00.000Z"),
    );
    expect(readPrivacyPreferences(storage)).toEqual({
      version: LEGAL_NOTICE_VERSION,
      decidedAt: "2026-08-12T12:00:00.000Z",
      analyticsAllowed: false,
    });

    clearPrivacyPreferences(storage);
    expect(values.has(PRIVACY_PREFERENCES_STORAGE_KEY)).toBe(false);
  });

  it("does not break the privacy UI when browser storage is unavailable", () => {
    const getItem = vi.fn(() => {
      throw new Error("blocked");
    });
    const setItem = vi.fn(() => {
      throw new Error("blocked");
    });
    const removeItem = vi.fn(() => {
      throw new Error("blocked");
    });

    expect(readPrivacyPreferences({ getItem })).toBeNull();
    expect(() => savePrivacyPreferences({ setItem }, false)).not.toThrow();
    expect(() => clearPrivacyPreferences({ removeItem })).not.toThrow();
  });
});
