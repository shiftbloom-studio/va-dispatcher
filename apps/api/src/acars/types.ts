export type AcarsMsgType =
  "telex" | "progress" | "cpdlc" | "position" | "other";

export type InboundMessage = {
  providerMessageId: string;
  from: string;
  to: string;
  type: AcarsMsgType;
  body: string;
  raw?: unknown;
  receivedAt: Date;
};

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  raw?: unknown;
};

export type AcarsProviderName = "mock" | "hoppie";

export type AcarsProviderErrorCode =
  | "not_configured"
  | "authentication"
  | "callsign_in_use"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "rejected"
  | "invalid_response";

/**
 * A provider failure that is safe to translate into a public API error.
 * Provider credentials and request payloads must never be attached to it.
 */
export class AcarsProviderError extends Error {
  constructor(
    readonly code: AcarsProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AcarsProviderError";
  }
}

export interface AcarsProvider {
  readonly name: AcarsProviderName;
  sendTelex(input: {
    logon?: string;
    from: string;
    to: string;
    body: string;
  }): Promise<SendResult>;
  poll(input: { logon?: string; station: string }): Promise<InboundMessage[]>;
  peek?(input: { logon?: string; station: string }): Promise<InboundMessage[]>;
  ping?(input?: { logon?: string; station?: string }): Promise<boolean>;
}
