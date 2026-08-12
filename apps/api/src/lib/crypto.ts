import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const INITIALIZATION_VECTOR_LENGTH_BYTES = 12;

function decodeEncryptionKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    throw new AppError("INTERNAL", "TENANT_SECRETS_KEY is not configured", {
      status: 500,
    });
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
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
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_LENGTH_BYTES);
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
}

export function decryptSecret(
  payload: string,
  encodedKey: string | undefined,
): string {
  const key = decodeEncryptionKey(encodedKey);
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
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    initializationVector,
  );
  decipher.setAuthTag(authenticationTag);
  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
