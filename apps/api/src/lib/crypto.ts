import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function keyFromEnv(keyB64: string | undefined): Buffer {
  if (!keyB64) {
    throw new AppError(
      "INTERNAL",
      "TENANT_SECRETS_KEY is not configured",
      { status: 500 },
    );
  }
  const key = Buffer.from(keyB64, "base64");
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
export function encryptSecret(plaintext: string, keyB64: string | undefined): string {
  const key = keyFromEnv(keyB64);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, keyB64: string | undefined): string {
  const key = keyFromEnv(keyB64);
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new AppError("UNPROCESSABLE", "Invalid encrypted secret payload");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
