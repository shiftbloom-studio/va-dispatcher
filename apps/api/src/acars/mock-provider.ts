import {
  drainMockAcarsQueue,
  enqueueMockAcars,
} from "../db/repositories/acars.js";
import type { AcarsProvider, InboundMessage, SendResult } from "./types.js";

/**
 * DB-backed Hoppie test adapter for local development and automated tests.
 * Outbound telex can optionally enqueue an echo reply to the ground station.
 */
export class MockAcarsProvider implements AcarsProvider {
  readonly name = "mock" as const;

  constructor(
    private readonly options: {
      tenantId: string;
      groundStation: string;
      echoReplies?: boolean;
    },
  ) {}

  async sendTelex(input: {
    from: string;
    to: string;
    body: string;
  }): Promise<SendResult> {
    if (this.options.echoReplies) {
      await enqueueMockAcars({
        tenantId: this.options.tenantId,
        toStation: input.from,
        fromStation: input.to,
        msgType: "telex",
        body: `ACK: ${input.body.slice(0, 200)}`,
      });
    }
    return {
      ok: true,
      providerMessageId: `mock-out-${Date.now()}`,
      raw: { mock: true, from: input.from, to: input.to },
    };
  }

  async poll(input: { station: string }): Promise<InboundMessage[]> {
    const queuedMessages = await drainMockAcarsQueue(
      this.options.tenantId,
      input.station,
    );
    return queuedMessages.map((message) => ({
      providerMessageId: message.id,
      from: message.fromStation,
      to: message.toStation,
      type: message.msgType,
      body: message.body,
      raw: { mock: true, queueId: message.id },
      receivedAt: new Date(),
    }));
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
