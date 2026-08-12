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
const OPAQUE_TOKEN_KEY_LENGTH_BYTES = 32;
const OPAQUE_TOKEN_SALT = Buffer.from("va-dispatch:opaque-token:v1", "utf8");

export type TokenMacPurpose = "simbrief-dispatch-callback";
export type OpaqueTokenPurpose = "navigraph-oauth-state";

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
    return encryptWithKey(plaintext, key);
  } finally {
    key.fill(0);
  }
}

export function decryptSecret(
  payload: string,
  encodedKey: string | undefined,
): string {
  const key = decodeEncryptionKey(encodedKey);
  try {
    return decryptWithKey(payload, key);
  } finally {
    key.fill(0);
  }
}

/** Seal an opaque browser token with a purpose-derived authenticated key. */
export function encryptOpaqueToken(
  value: string,
  encodedKey: string | undefined,
  purpose: OpaqueTokenPurpose,
): string {
  const context = opaqueTokenContext(purpose);
  const key = deriveKey(
    encodedKey,
    OPAQUE_TOKEN_SALT,
    context,
    OPAQUE_TOKEN_KEY_LENGTH_BYTES,
  );
  try {
    return encryptWithKey(value, key, context);
  } finally {
    key.fill(0);
  }
}

/** Open and authenticate a token produced by {@link encryptOpaqueToken}. */
export function decryptOpaqueToken(
  payload: string,
  encodedKey: string | undefined,
  purpose: OpaqueTokenPurpose,
): string {
  const context = opaqueTokenContext(purpose);
  const key = deriveKey(
    encodedKey,
    OPAQUE_TOKEN_SALT,
    context,
    OPAQUE_TOKEN_KEY_LENGTH_BYTES,
  );
  try {
    return decryptWithKey(payload, key, context);
  } finally {
    key.fill(0);
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
  return deriveKey(
    encodedKey,
    TOKEN_MAC_SALT,
    `va-dispatch:${purpose}:v1`,
    TOKEN_MAC_LENGTH_BYTES,
  );
}

function deriveKey(
  encodedKey: string | undefined,
  salt: Buffer,
  context: string,
  length: number,
): Buffer {
  const rootKey = decodeEncryptionKey(encodedKey);
  try {
    return Buffer.from(
      hkdfSync("sha256", rootKey, salt, Buffer.from(context, "utf8"), length),
    );
  } finally {
    rootKey.fill(0);
  }
}

function opaqueTokenContext(purpose: OpaqueTokenPurpose): string {
  return `va-dispatch:opaque-token:${purpose}:v1`;
}

function encryptWithKey(
  plaintext: string,
  key: Buffer,
  context?: string,
): string {
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_LENGTH_BYTES);
  const cipher = createCipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    initializationVector,
  );
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
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
}

function decryptWithKey(
  payload: string,
  key: Buffer,
  context?: string,
): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new AppError("UNPROCESSABLE", "Invalid encrypted secret payload");
  }
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
    if (context) decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(authenticationTag);
    decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } finally {
    decrypted?.fill(0);
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
