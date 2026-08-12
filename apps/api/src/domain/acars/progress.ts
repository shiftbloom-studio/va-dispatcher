import type { FlightEventKind } from "../../db/schema.js";

export type ParsedOperationalInteraction = {
  kind: Extract<FlightEventKind, "flt_init" | "out" | "off" | "on" | "in">;
  flightNumber: string | null;
  occurredAt: Date;
};

const INTERACTION_PATTERN =
  /^(?:(?<prefix>[A-Z]{1,4}\d{1,6})\s+)?(?<event>FLT[ -]?INIT|OUT|OFF|ON|IN)(?:[\/\s]+(?<time>\d{4})Z?)?(?:\s+(?<suffix>[A-Z]{1,4}\d{1,6}))?$/i;

/**
 * Intentionally conservative: only an entire, recognizable progress payload
 * is actionable. Free text containing one of these words is never parsed.
 */
export function parseOperationalInteraction(
  body: string,
  receivedAt: Date,
): ParsedOperationalInteraction | null {
  const normalized = body.trim().replace(/\s+/g, " ").toUpperCase();
  const match = INTERACTION_PATTERN.exec(normalized);
  if (!match?.groups) return null;

  const rawEvent = match.groups.event?.replace(/[ -]/g, "_");
  let kind: ParsedOperationalInteraction["kind"] | null = null;
  if (rawEvent === "FLT_INIT") kind = "flt_init";
  if (rawEvent === "OUT") kind = "out";
  if (rawEvent === "OFF") kind = "off";
  if (rawEvent === "ON") kind = "on";
  if (rawEvent === "IN") kind = "in";
  if (!kind) return null;

  const time = match.groups.time;
  const occurredAt = time ? nearestZuluTime(time, receivedAt) : receivedAt;
  if (!occurredAt) return null;
  return {
    kind,
    flightNumber: match.groups.prefix ?? match.groups.suffix ?? null,
    occurredAt,
  };
}

function nearestZuluTime(value: string, reference: Date): Date | null {
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2, 4));
  if (hour > 23 || minute > 59) return null;

  const sameDay = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    hour,
    minute,
  );
  const candidates = [sameDay - 86_400_000, sameDay, sameDay + 86_400_000];
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate - reference.getTime()) <
    Math.abs(best - reference.getTime())
      ? candidate
      : best,
  );
  return new Date(nearest);
}
