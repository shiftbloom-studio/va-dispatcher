import { describe, expect, it } from "vitest";
import {
  createTokenMac,
  decryptSecret,
  encryptSecret,
  verifyTokenMac,
} from "./crypto.js";

const rootKey = Buffer.alloc(32, 7).toString("base64");

describe("secret crypto", () => {
  it("round-trips authenticated encryption", () => {
    const encrypted = encryptSecret("sensitive value", rootKey);

    expect(encrypted).not.toContain("sensitive value");
    expect(decryptSecret(encrypted, rootKey)).toBe("sensitive value");
  });

  it("creates deterministic, purpose-separated token authenticators", () => {
    const oauthMac = createTokenMac(
      "v1.random-state-id",
      rootKey,
      "navigraph-oauth-state",
    );
    const callbackMac = createTokenMac(
      "v1.random-state-id",
      rootKey,
      "simbrief-dispatch-callback",
    );

    expect(oauthMac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callbackMac).not.toBe(oauthMac);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        oauthMac,
        rootKey,
        "navigraph-oauth-state",
      ),
    ).toBe(true);
    expect(
      verifyTokenMac(
        "v1.tampered-state-id",
        oauthMac,
        rootKey,
        "navigraph-oauth-state",
      ),
    ).toBe(false);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        oauthMac,
        rootKey,
        "simbrief-dispatch-callback",
      ),
    ).toBe(false);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        oauthMac,
        Buffer.alloc(32, 8).toString("base64"),
        "navigraph-oauth-state",
      ),
    ).toBe(false);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        "not-a-valid-mac",
        rootKey,
        "navigraph-oauth-state",
      ),
    ).toBe(false);
  });
});
