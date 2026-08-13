"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import {
  PRIVACY_PREFERENCES_CHANGED_EVENT,
  readPrivacyPreferences,
} from "@/lib/privacy-storage";

const OptionalTelemetrySinks = dynamic(
  () =>
    import("@/components/optional-telemetry-sinks").then(
      (module) => module.OptionalTelemetrySinks,
    ),
  { ssr: false },
);

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

  return <OptionalTelemetrySinks />;
}
