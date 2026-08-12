import { describe, expect, it } from "vitest";

import { redactAuditMeta } from "./service.js";

describe("audit metadata redaction", () => {
  it("redacts secrets and provider payloads recursively while retaining safe fields", () => {
    expect(
      redactAuditMeta({
        status: "active",
        nested: {
          accessToken: "token-value",
          apiKey: "api-key-value",
          bearer: "bearer-value",
          hoppieRaw: { raw: "provider data" },
          HOPPIE_LOGON: "hoppie-logon-value",
          passwordHash: "secret-value",
          privateKey: "private-key-value",
          signing_key: "signing-key-value",
          encryptionKey: "encryption-key-value",
          authorizationUrl: "https://identity.invalid/authorize?code=x",
          pkceVerifier: "pkce-value",
          callbackCode: "callback-value",
          simbriefUserId: "123456",
          navigraph_subject: "subject-value",
          navigraphUsername: "provider-username",
          providerAccountId: "provider-account-id",
          SESSION_ID: "session-id",
          packet: { payload: "raw message" },
          key: "safe-business-key",
          keyboardLayout: "QWERTY",
          reason: "operator action",
        },
        body: "ACARS content",
      }),
    ).toEqual({
      status: "active",
      nested: {
        accessToken: "[REDACTED]",
        apiKey: "[REDACTED]",
        bearer: "[REDACTED]",
        hoppieRaw: "[REDACTED]",
        HOPPIE_LOGON: "[REDACTED]",
        passwordHash: "[REDACTED]",
        privateKey: "[REDACTED]",
        signing_key: "[REDACTED]",
        encryptionKey: "[REDACTED]",
        authorizationUrl: "[REDACTED]",
        pkceVerifier: "[REDACTED]",
        callbackCode: "[REDACTED]",
        simbriefUserId: "[REDACTED]",
        navigraph_subject: "[REDACTED]",
        navigraphUsername: "[REDACTED]",
        providerAccountId: "[REDACTED]",
        SESSION_ID: "[REDACTED]",
        packet: "[REDACTED]",
        key: "safe-business-key",
        keyboardLayout: "QWERTY",
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
