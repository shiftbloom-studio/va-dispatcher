"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { filterOptionalTelemetryEvent } from "@/lib/optional-telemetry";

export function OptionalTelemetrySinks() {
  return (
    <>
      <Analytics beforeSend={filterOptionalTelemetryEvent} />
      <SpeedInsights beforeSend={filterOptionalTelemetryEvent} />
    </>
  );
}
