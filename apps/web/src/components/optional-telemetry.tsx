"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useEffect, useState } from "react";

import {
  PRIVACY_PREFERENCES_CHANGED_EVENT,
  readPrivacyPreferences,
} from "@/lib/privacy-storage";

export function filterOptionalTelemetryEvent<T>(event: T): T | null {
  if (typeof window === "undefined") return null;
  return readPrivacyPreferences(window.localStorage)?.analyticsAllowed === true
    ? event
    : null;
}

export function OptionalTelemetry() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => {
      if (
        readPrivacyPreferences(window.localStorage)?.analyticsAllowed === true
      ) {
        setLoaded(true);
      }
    };

    refresh();
    window.addEventListener(PRIVACY_PREFERENCES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PRIVACY_PREFERENCES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (!loaded) return null;

  return (
    <>
      <Analytics beforeSend={filterOptionalTelemetryEvent} />
      <SpeedInsights beforeSend={filterOptionalTelemetryEvent} />
    </>
  );
}
