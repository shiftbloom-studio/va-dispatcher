import type {
  AcarsMsgType,
  AcarsProvider,
  InboundMessage,
  SendResult,
} from "./types.js";

/**
 * Real Hoppie ACARS HTTP client.
 *
 * Protocol: POST/GET https://www.hoppie.nl/acars/system/connect.html
 * Params: logon, from, to, type, packet
 *
 * Poll etiquette: ~45–75s between polls; 15s HTTP timeout; no hammering.
 * Prefer type=poll for stations; peek only for offline loggers.
 *
 * v1 skeleton: fully structured; enable via ACARS_PROVIDER=hoppie when logon is set.
 */
const DEFAULT_BASE =
  "https://www.hoppie.nl/acars/system/connect.html";

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

  private async connect(
    params: Record<string, string>,
  ): Promise<{ ok: boolean; text: string }> {
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
      return { ok: res.ok, text };
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
    const { ok, text } = await this.connect({
      logon,
      from: input.from,
      to: input.to,
      type: "telex",
      packet: input.body,
    });
    return {
      ok,
      providerMessageId: `hoppie-${Date.now()}`,
      raw: text,
    };
  }

  async poll(input: {
    logon?: string;
    station: string;
  }): Promise<InboundMessage[]> {
    const logon = input.logon ?? this.opts.logon;
    const { text } = await this.connect({
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
    const { ok, text } = await this.connect({
      logon,
      from: input?.station ?? "SERVER",
      to: "SERVER",
      type: "ping",
      packet: "",
    });
    return ok && /ok/i.test(text);
  }
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
