import { useEffect, useState } from "react";
import {
  PRIVACY_PREFERENCES_CHANGED_EVENT,
  readPrivacyPreferences,
} from "@/lib/privacy-storage";
import { OptionalTelemetrySinks } from "@/components/optional-telemetry-sinks";

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

