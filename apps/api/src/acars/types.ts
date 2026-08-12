export type AcarsMsgType =
  | "telex"
  | "progress"
  | "cpdlc"
  | "position"
  | "other";

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

export interface AcarsProvider {
  readonly name: AcarsProviderName;
  sendTelex(input: {
    logon?: string;
    from: string;
    to: string;
    body: string;
  }): Promise<SendResult>;
  poll(input: {
    logon?: string;
    station: string;
  }): Promise<InboundMessage[]>;
  peek?(input: {
    logon?: string;
    station: string;
  }): Promise<InboundMessage[]>;
  ping?(input?: { logon?: string; station?: string }): Promise<boolean>;
}
