import { describe, expect, it } from "vitest";

import { redactAuditMeta } from "./service.js";

describe("audit metadata redaction", () => {
  it("redacts secrets and provider payloads recursively while retaining safe fields", () => {
    expect(
      redactAuditMeta({
        status: "active",
        nested: {
          accessToken: "token-value",
          hoppieRaw: { raw: "provider data" },
          passwordHash: "secret-value",
          authorizationUrl: "https://identity.invalid/authorize?code=x",
          pkceVerifier: "pkce-value",
          callbackCode: "callback-value",
          simbriefUserId: "123456",
          navigraph_subject: "subject-value",
          packet: { payload: "raw message" },
          reason: "operator action",
        },
        body: "ACARS content",
      }),
    ).toEqual({
      status: "active",
      nested: {
        accessToken: "[REDACTED]",
        hoppieRaw: "[REDACTED]",
        passwordHash: "[REDACTED]",
        authorizationUrl: "[REDACTED]",
        pkceVerifier: "[REDACTED]",
        callbackCode: "[REDACTED]",
        simbriefUserId: "[REDACTED]",
        navigraph_subject: "[REDACTED]",
        packet: "[REDACTED]",
        reason: "operator action",
      },
      body: "[REDACTED]",
    });
  });

  it("bounds large strings and nested structures", () => {
    const output = redactAuditMeta({
      note: "x".repeat(600),
      deep: { a: { b: { c: { d: { e: { f: { g: { h: "no" } } } } } } } },
    }) as Record<string, unknown>;
    expect(String(output.note)).toHaveLength(501);
    expect(JSON.stringify(output.deep)).toContain("[MAX_DEPTH]");
  });
});
