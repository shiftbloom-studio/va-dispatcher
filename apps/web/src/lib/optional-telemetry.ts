import { readPrivacyPreferences } from "@/lib/privacy-storage";

export function filterOptionalTelemetryEvent<T>(event: T): T | null {
  if (typeof window === "undefined") return null;
  return readPrivacyPreferences(window.localStorage)?.analyticsAllowed === true
    ? event
    : null;
}
