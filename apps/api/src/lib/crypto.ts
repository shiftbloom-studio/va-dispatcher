import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./errors.js";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const INITIALIZATION_VECTOR_LENGTH_BYTES = 12;
const TOKEN_MAC_LENGTH_BYTES = 32;
const TOKEN_MAC_SALT = Buffer.from("va-dispatch:token-mac:v1", "utf8");

export type TokenMacPurpose =
  "navigraph-oauth-state" | "simbrief-dispatch-callback";

function decodeEncryptionKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    throw new AppError("INTERNAL", "TENANT_SECRETS_KEY is not configured", {
      status: 500,
    });
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    key.fill(0);
    throw new AppError(
      "INTERNAL",
      "TENANT_SECRETS_KEY must be 32 bytes base64-encoded",
      { status: 500 },
    );
  }
  return key;
}

/** Encrypt a tenant secret (e.g. Hoppie logon). Format: iv.tag.ciphertext base64url parts. */
export function encryptSecret(
  plaintext: string,
  encodedKey: string | undefined,
): string {
  const key = decodeEncryptionKey(encodedKey);
  try {
    const initializationVector = randomBytes(
      INITIALIZATION_VECTOR_LENGTH_BYTES,
    );
    const cipher = createCipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      initializationVector,
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();
    return [
      initializationVector.toString("base64url"),
      authenticationTag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  } finally {
    key.fill(0);
  }
}

export function decryptSecret(
  payload: string,
  encodedKey: string | undefined,
): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new AppError("UNPROCESSABLE", "Invalid encrypted secret payload");
  }
  const key = decodeEncryptionKey(encodedKey);
  const [encodedInitializationVector, encodedAuthenticationTag, encodedData] =
    parts as [string, string, string];
  const initializationVector = Buffer.from(
    encodedInitializationVector,
    "base64url",
  );
  const authenticationTag = Buffer.from(encodedAuthenticationTag, "base64url");
  const encryptedData = Buffer.from(encodedData, "base64url");
  let decrypted: Buffer | undefined;
  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      initializationVector,
    );
    decipher.setAuthTag(authenticationTag);
    decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } finally {
    key.fill(0);
    decrypted?.fill(0);
  }
}

/**
 * Create a deterministic, domain-separated authenticator for an opaque token.
 * The root key never becomes part of the stored value and each protocol gets a
 * distinct HKDF-derived key.
 */
export function createTokenMac(
  value: string,
  encodedKey: string | undefined,
  purpose: TokenMacPurpose,
): string {
  const key = deriveTokenMacKey(encodedKey, purpose);
  try {
    return createHmac("sha256", key).update(value, "utf8").digest("base64url");
  } finally {
    key.fill(0);
  }
}

export function verifyTokenMac(
  value: string,
  expectedMac: string,
  encodedKey: string | undefined,
  purpose: TokenMacPurpose,
): boolean {
  const expected = decodeTokenMac(expectedMac);
  if (!expected) return false;
  let actual: Buffer | undefined;
  try {
    actual = Buffer.from(
      createTokenMac(value, encodedKey, purpose),
      "base64url",
    );
    return timingSafeEqual(actual, expected);
  } finally {
    actual?.fill(0);
    expected.fill(0);
  }
}

function deriveTokenMacKey(
  encodedKey: string | undefined,
  purpose: TokenMacPurpose,
): Buffer {
  const rootKey = decodeEncryptionKey(encodedKey);
  try {
    return Buffer.from(
      hkdfSync(
        "sha256",
        rootKey,
        TOKEN_MAC_SALT,
        Buffer.from(`va-dispatch:${purpose}:v1`, "utf8"),
        TOKEN_MAC_LENGTH_BYTES,
      ),
    );
  } finally {
    rootKey.fill(0);
  }
}

function decodeTokenMac(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== TOKEN_MAC_LENGTH_BYTES ||
    decoded.toString("base64url") !== value
  ) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}
