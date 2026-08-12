import { describe, expect, it, vi } from "vitest";

import { LEGAL_NOTICE_VERSION } from "@/lib/legal";
import {
  COOKIE_NOTICE_STORAGE_KEY,
  clearCookieNotice,
  parseCookieNoticeRecord,
  readCookieNotice,
  saveCookieNotice,
} from "@/lib/privacy-storage";

describe("cookie-notice storage", () => {
  it("accepts only the current, well-formed notice version", () => {
    const current = JSON.stringify({
      version: LEGAL_NOTICE_VERSION,
      acknowledgedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(parseCookieNoticeRecord(current)).toEqual({
      version: LEGAL_NOTICE_VERSION,
      acknowledgedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(
      parseCookieNoticeRecord(
        JSON.stringify({
          version: "old-version",
          acknowledgedAt: "2026-08-12T12:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(parseCookieNoticeRecord("not-json")).toBeNull();
  });

  it("writes, reads, and clears the acknowledgement", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    saveCookieNotice(storage, new Date("2026-08-12T12:00:00.000Z"));
    expect(readCookieNotice(storage)).toEqual({
      version: LEGAL_NOTICE_VERSION,
      acknowledgedAt: "2026-08-12T12:00:00.000Z",
    });

    clearCookieNotice(storage);
    expect(values.has(COOKIE_NOTICE_STORAGE_KEY)).toBe(false);
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

    expect(readCookieNotice({ getItem })).toBeNull();
    expect(() => saveCookieNotice({ setItem })).not.toThrow();
    expect(() => clearCookieNotice({ removeItem })).not.toThrow();
  });
});
