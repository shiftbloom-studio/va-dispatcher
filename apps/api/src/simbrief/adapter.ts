import type { SimbriefLegacySigner } from "./legacy-signer.js";

const DEFAULT_DISPATCH_URL = "https://www.simbrief.com/ofp/ofp.loader.api.php";
const DEFAULT_FETCH_URL = "https://www.simbrief.com/api/xml.fetcher.php";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OFP_BYTES = 10 * 1024 * 1024;
const RESERVED_DISPATCH_PARAMETERS = new Set([
  "apicode",
  "outputpage",
  "timestamp",
]);

export type SimbriefOfpResult = {
  ofp: Record<string, unknown>;
  requestId: string | null;
  generatedAt: Date | null;
};

export type SimbriefAdapterErrorReason =
  | "not_ready"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "mismatch"
  | "response_too_large";

export class SimbriefAdapterError extends Error {
  constructor(
    readonly reason: SimbriefAdapterErrorReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "SimbriefAdapterError";
  }
}

/**
 * Create the official SimBrief Dispatch Redirect URL. Credential access stays
 * inside the narrow server-side compatibility signer.
 */
export function buildSimbriefDispatchUrl(input: {
  signer: SimbriefLegacySigner;
  outputPage: string;
  timestamp: number;
  parameters: Record<string, string>;
  dispatchUrl?: string;
}): string {
  for (const name of RESERVED_DISPATCH_PARAMETERS) {
    if (Object.hasOwn(input.parameters, name)) {
      throw new Error(`Reserved SimBrief dispatch parameter: ${name}`);
    }
  }

  const origin = requiredParameter(input.parameters, "orig");
  const destination = requiredParameter(input.parameters, "dest");
  const aircraftType = requiredParameter(input.parameters, "type");
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw new Error("SimBrief dispatch timestamp must be a positive integer");
  }

  const apiCode = input.signer.sign({
    origin,
    destination,
    aircraftType,
    timestamp: input.timestamp,
    outputPage: input.outputPage,
  });

  const url = new URL(input.dispatchUrl ?? DEFAULT_DISPATCH_URL);
  for (const [name, value] of Object.entries(input.parameters)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("apicode", apiCode);
  url.searchParams.set("outputpage", input.outputPage);
  url.searchParams.set("timestamp", String(input.timestamp));
  return url.toString();
}

export class SimbriefAdapter {
  constructor(
    private readonly options: {
      fetchUrl?: string;
      timeoutMs?: number;
    } = {},
  ) {}

  async fetchFlightPlan(input: {
    userId: string;
    staticId: string;
    origin: string;
    destination: string;
  }): Promise<SimbriefOfpResult> {
    const url = new URL(this.options.fetchUrl ?? DEFAULT_FETCH_URL);
    url.searchParams.set("userid", input.userId);
    url.searchParams.set("static_id", input.staticId);
    url.searchParams.set("json", "1");

    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 404) {
          throw new SimbriefAdapterError(
            "not_ready",
            "The SimBrief flight plan is not ready. Complete generation in the SimBrief window, then retry.",
          );
        }
        if (response.status === 429) {
          throw new SimbriefAdapterError(
            "rate_limited",
            "SimBrief is rate-limiting flight-plan requests. Retry later.",
          );
        }
        throw new SimbriefAdapterError(
          "unavailable",
          "SimBrief is temporarily unavailable.",
        );
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_OFP_BYTES) {
        throw new SimbriefAdapterError(
          "response_too_large",
          "SimBrief returned a flight plan larger than the supported limit.",
        );
      }

      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_OFP_BYTES) {
        throw new SimbriefAdapterError(
          "response_too_large",
          "SimBrief returned a flight plan larger than the supported limit.",
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new SimbriefAdapterError(
          "invalid_response",
          "SimBrief returned an invalid flight-plan response.",
          { cause: error },
        );
      }
      if (!isRecord(parsed)) {
        throw new SimbriefAdapterError(
          "invalid_response",
          "SimBrief returned an invalid flight-plan response.",
        );
      }

      assertExpectedOfp(parsed, input);
      return {
        ofp: parsed,
        requestId: optionalScalar(parsed, ["params", "request_id"]),
        generatedAt: generatedDate(
          optionalScalar(parsed, ["params", "time_generated"]),
        ),
      };
    } catch (error) {
      if (error instanceof SimbriefAdapterError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SimbriefAdapterError(
          "timeout",
          `SimBrief did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`,
          { cause: error },
        );
      }
      throw new SimbriefAdapterError(
        "unavailable",
        "SimBrief could not be reached.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertExpectedOfp(
  ofp: Record<string, unknown>,
  expected: {
    userId: string;
    staticId: string;
    origin: string;
    destination: string;
  },
): void {
  const staticId =
    optionalScalar(ofp, ["params", "static_id"]) ??
    optionalScalar(ofp, ["fetch", "static_id"]);
  const userId =
    optionalScalar(ofp, ["params", "user_id"]) ??
    optionalScalar(ofp, ["fetch", "userid"]);
  const origin = optionalScalar(ofp, ["origin", "icao_code"]);
  const destination = optionalScalar(ofp, ["destination", "icao_code"]);

  if (!staticId || !userId || !origin || !destination) {
    throw new SimbriefAdapterError(
      "invalid_response",
      "SimBrief returned a flight plan without the required identifiers.",
    );
  }
  if (
    staticId !== expected.staticId ||
    userId !== expected.userId ||
    origin.toUpperCase() !== expected.origin.toUpperCase() ||
    destination.toUpperCase() !== expected.destination.toUpperCase()
  ) {
    throw new SimbriefAdapterError(
      "mismatch",
      "SimBrief returned a flight plan that does not match this dispatch.",
    );
  }
}

function requiredParameter(
  parameters: Record<string, string>,
  name: string,
): string {
  const value = parameters[name];
  if (!value) throw new Error(`Missing SimBrief dispatch parameter: ${name}`);
  return value;
}

function optionalScalar(
  record: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  if (typeof current === "string" || typeof current === "number") {
    return String(current);
  }
  return null;
}

function generatedDate(value: string | null): Date | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
