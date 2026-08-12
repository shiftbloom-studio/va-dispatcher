import { LEGAL_NOTICE_VERSION } from "@/lib/legal";

export const PRIVACY_PREFERENCES_STORAGE_KEY =
  "va-dispatch.privacy-preferences";
export const OPEN_COOKIE_SETTINGS_EVENT = "va-dispatch:open-cookie-settings";
export const PRIVACY_PREFERENCES_CHANGED_EVENT =
  "va-dispatch:privacy-preferences-changed";

export type PrivacyPreferencesRecord = {
  version: string;
  decidedAt: string;
  analyticsAllowed: boolean;
};

export function parsePrivacyPreferencesRecord(
  raw: string | null,
): PrivacyPreferencesRecord | null {
  if (!raw) return null;

  try {
    const candidate: unknown = JSON.parse(raw);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("version" in candidate) ||
      !("decidedAt" in candidate) ||
      !("analyticsAllowed" in candidate) ||
      candidate.version !== LEGAL_NOTICE_VERSION ||
      typeof candidate.decidedAt !== "string" ||
      Number.isNaN(Date.parse(candidate.decidedAt)) ||
      typeof candidate.analyticsAllowed !== "boolean"
    ) {
      return null;
    }
    return {
      version: candidate.version,
      decidedAt: candidate.decidedAt,
      analyticsAllowed: candidate.analyticsAllowed,
    };
  } catch {
    return null;
  }
}

export function readPrivacyPreferences(
  storage: Pick<Storage, "getItem">,
): PrivacyPreferencesRecord | null {
  try {
    return parsePrivacyPreferencesRecord(
      storage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function savePrivacyPreferences(
  storage: Pick<Storage, "setItem">,
  analyticsAllowed: boolean,
  now: Date = new Date(),
): PrivacyPreferencesRecord {
  const record = {
    version: LEGAL_NOTICE_VERSION,
    decidedAt: now.toISOString(),
    analyticsAllowed,
  };
  try {
    storage.setItem(PRIVACY_PREFERENCES_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable in hardened/private browser modes. The current
    // page still applies the choice without blocking access to the service.
  }
  return record;
}

export function clearPrivacyPreferences(
  storage: Pick<Storage, "removeItem">,
): void {
  try {
    storage.removeItem(PRIVACY_PREFERENCES_STORAGE_KEY);
  } catch {
    // See savePrivacyPreferences: controls must remain usable without storage.
  }
}
