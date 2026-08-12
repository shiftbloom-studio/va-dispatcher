import type {
  AcarsMsgType,
  AcarsProvider,
  InboundMessage,
  SendResult,
} from "./types.js";
import { AcarsProviderError } from "./types.js";

/**
 * Real Hoppie ACARS HTTP client.
 *
 * Protocol: POST/GET https://www.hoppie.nl/acars/system/connect.html
 * Params: logon, from, to, type, packet
 *
 * Poll etiquette: ~45–75s between polls; 15s HTTP timeout; no hammering.
 * Prefer type=poll for stations; peek only for offline loggers.
 *
 * Production uses this provider exclusively. Each tenant supplies its own
 * encrypted Hoppie ground-station logon.
 */
const DEFAULT_BASE = "https://www.hoppie.nl/acars/system/connect.html";

export class HoppieAcarsProvider implements AcarsProvider {
  readonly name = "hoppie" as const;

  constructor(
    private readonly opts: {
      baseUrl?: string;
      /** Default logon if not passed per call */
      logon: string;
      timeoutMs?: number;
    },
  ) {}

  private url(): string {
    return this.opts.baseUrl ?? DEFAULT_BASE;
  }

  private async connect(params: Record<string, string>): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 15_000,
    );
    try {
      const body = new URLSearchParams(params);
      const res = await fetch(this.url(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new AcarsProviderError(
          res.status === 429 ? "rate_limited" : "unavailable",
          res.status === 429
            ? "Hoppie is rate-limiting this station. Wait before retrying."
            : "Hoppie is temporarily unavailable.",
        );
      }
      return assertHoppieSuccess(text);
    } catch (error) {
      if (error instanceof AcarsProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AcarsProviderError(
          "timeout",
          "Hoppie did not respond within 15 seconds.",
          { cause: error },
        );
      }
      throw new AcarsProviderError(
        "unavailable",
        "Hoppie could not be reached.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendTelex(input: {
    logon?: string;
    from: string;
    to: string;
    body: string;
  }): Promise<SendResult> {
    const logon = input.logon ?? this.opts.logon;
    const text = await this.connect({
      logon,
      from: input.from,
      to: input.to,
      type: "telex",
      packet: input.body,
    });
    return {
      ok: true,
      raw: text,
    };
  }

  async poll(input: {
    logon?: string;
    station: string;
  }): Promise<InboundMessage[]> {
    const logon = input.logon ?? this.opts.logon;
    const text = await this.connect({
      logon,
      from: input.station,
      to: "SERVER",
      type: "poll",
      packet: "",
    });
    return parseHoppiePollResponse(text, input.station);
  }

  async ping(input?: { logon?: string; station?: string }): Promise<boolean> {
    const logon = input?.logon ?? this.opts.logon;
    await this.connect({
      logon,
      from: input?.station ?? "SERVER",
      to: "SERVER",
      type: "ping",
      packet: "",
    });
    return true;
  }
}

/**
 * Hoppie uses HTTP 200 for both accepted and rejected application requests.
 * Treat only a protocol-level `ok` response as success.
 */
export function assertHoppieSuccess(text: string): string {
  const response = text.trim();
  if (/^ok(?:\s|$)/i.test(response)) return response;

  if (!/^error(?:\s|$)/i.test(response)) {
    throw new AcarsProviderError(
      "invalid_response",
      "Hoppie returned an invalid response.",
    );
  }

  const detail = response
    .replace(/^error\s*/i, "")
    .replace(/^\{([\s\S]*)\}$/, "$1")
    .trim()
    .toLowerCase();

  if (/illegal logon|invalid logon|logon.*(?:invalid|unknown)/i.test(detail)) {
    throw new AcarsProviderError(
      "authentication",
      "Hoppie rejected the logon code.",
    );
  }
  if (/callsign.*(?:already|in use|locked)/i.test(detail)) {
    throw new AcarsProviderError(
      "callsign_in_use",
      "This Hoppie callsign is already in use. Wait about two minutes before retrying.",
    );
  }
  if (/rate|too (?:many|fast)|flood/i.test(detail)) {
    throw new AcarsProviderError(
      "rate_limited",
      "Hoppie is rate-limiting this station. Wait before retrying.",
    );
  }
  throw new AcarsProviderError("rejected", "Hoppie rejected the request.");
}

/**
 * Hoppie poll replies look like:
 * ok {callsign telex {message}} {callsign progress {message}} ...
 * Parsing is intentionally conservative; unknown shapes become type=other.
 */
export function parseHoppiePollResponse(
  text: string,
  defaultTo: string,
): InboundMessage[] {
  const trimmed = text.trim();
  if (!trimmed || /^error/i.test(trimmed)) {
    return [];
  }
  // Strip leading "ok"
  const payload = trimmed.replace(/^ok\s*/i, "").trim();
  if (!payload) return [];

  const messages: InboundMessage[] = [];
  // Match blocks: {FROM type {body}}  — nested braces for body
  const blockRe = /\{([A-Z0-9-]+)\s+([a-z]+)\s+\{([\s\S]*?)\}\s*\}/gi;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = blockRe.exec(payload)) !== null) {
    const from = match[1] ?? "UNKNOWN";
    const typeRaw = (match[2] ?? "other").toLowerCase();
    const body = match[3] ?? "";
    messages.push({
      providerMessageId: `hoppie-poll-${Date.now()}-${i++}`,
      from,
      to: defaultTo,
      type: mapHoppieType(typeRaw),
      body,
      raw: match[0],
      receivedAt: new Date(),
    });
  }
  return messages;
}

function mapHoppieType(type: string): AcarsMsgType {
  switch (type) {
    case "telex":
      return "telex";
    case "progress":
      return "progress";
    case "cpdlc":
      return "cpdlc";
    case "position":
      return "position";
    default:
      return "other";
  }
}
