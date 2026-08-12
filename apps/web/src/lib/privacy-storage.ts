import { LEGAL_NOTICE_VERSION } from "@/lib/legal";

export const COOKIE_NOTICE_STORAGE_KEY = "va-dispatch.cookie-notice";
export const OPEN_COOKIE_SETTINGS_EVENT = "va-dispatch:open-cookie-settings";

export type CookieNoticeRecord = {
  version: string;
  acknowledgedAt: string;
};

export function parseCookieNoticeRecord(
  raw: string | null,
): CookieNoticeRecord | null {
  if (!raw) return null;

  try {
    const candidate: unknown = JSON.parse(raw);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("version" in candidate) ||
      !("acknowledgedAt" in candidate) ||
      candidate.version !== LEGAL_NOTICE_VERSION ||
      typeof candidate.acknowledgedAt !== "string" ||
      Number.isNaN(Date.parse(candidate.acknowledgedAt))
    ) {
      return null;
    }
    return {
      version: candidate.version,
      acknowledgedAt: candidate.acknowledgedAt,
    };
  } catch {
    return null;
  }
}

export function readCookieNotice(
  storage: Pick<Storage, "getItem">,
): CookieNoticeRecord | null {
  try {
    return parseCookieNoticeRecord(storage.getItem(COOKIE_NOTICE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveCookieNotice(
  storage: Pick<Storage, "setItem">,
  now: Date = new Date(),
): CookieNoticeRecord {
  const record = {
    version: LEGAL_NOTICE_VERSION,
    acknowledgedAt: now.toISOString(),
  };
  try {
    storage.setItem(COOKIE_NOTICE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable in hardened/private browser modes. The current
    // page still dismisses the notice without blocking access to the service.
  }
  return record;
}

export function clearCookieNotice(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(COOKIE_NOTICE_STORAGE_KEY);
  } catch {
    // See saveCookieNotice: privacy controls must remain usable without storage.
  }
}
