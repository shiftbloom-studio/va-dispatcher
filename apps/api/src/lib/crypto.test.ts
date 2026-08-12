import { describe, expect, it } from "vitest";
import {
  createTokenMac,
  decryptOpaqueToken,
  decryptSecret,
  encryptOpaqueToken,
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

  it("seals purpose-bound opaque tokens with authenticated encryption", () => {
    const sealed = encryptOpaqueToken(
      "random-state-id",
      rootKey,
      "navigraph-oauth-state",
    );
    const tampered = `${sealed.slice(0, -2)}${sealed.at(-2) === "A" ? "B" : "A"}${sealed.at(-1)}`;

    expect(sealed).not.toContain("random-state-id");
    expect(decryptOpaqueToken(sealed, rootKey, "navigraph-oauth-state")).toBe(
      "random-state-id",
    );
    expect(() =>
      decryptOpaqueToken(tampered, rootKey, "navigraph-oauth-state"),
    ).toThrow();
    expect(() =>
      decryptOpaqueToken(
        sealed,
        Buffer.alloc(32, 8).toString("base64"),
        "navigraph-oauth-state",
      ),
    ).toThrow();
  });

  it("creates deterministic token authenticators", () => {
    const callbackMac = createTokenMac(
      "v1.random-state-id",
      rootKey,
      "simbrief-dispatch-callback",
    );

    expect(callbackMac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      verifyTokenMac(
        "v1.tampered-state-id",
        callbackMac,
        rootKey,
        "simbrief-dispatch-callback",
      ),
    ).toBe(false);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        callbackMac,
        rootKey,
        "simbrief-dispatch-callback",
      ),
    ).toBe(true);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        callbackMac,
        Buffer.alloc(32, 8).toString("base64"),
        "simbrief-dispatch-callback",
      ),
    ).toBe(false);
    expect(
      verifyTokenMac(
        "v1.random-state-id",
        "not-a-valid-token-mac",
        rootKey,
        "simbrief-dispatch-callback",
      ),
    ).toBe(false);
  });
});
