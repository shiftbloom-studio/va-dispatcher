/**
 * Authenticated encryption for cookies (AES-256-GCM). The key is derived
 * from the session secret with HKDF, separately for each purpose, so a
 * value sealed for one cookie never opens as another.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa emits "=" only as trailing padding, so dropping every "=" is safe.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sealKey(secret: string, purpose: string): Promise<CryptoKey> {
  const cacheKey = `${purpose}\u0000${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: encoder.encode("va-dispatch-cookie"),
            info: encoder.encode(purpose),
          },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function seal(
  value: unknown,
  secret: string,
  purpose: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await sealKey(secret, purpose),
      encoder.encode(JSON.stringify(value)),
    ),
  );
  return `${base64url(iv)}.${base64url(ciphertext)}`;
}

/** Returns null for anything that was not sealed with this secret. */
export async function unseal<T>(
  sealed: string | undefined,
  secret: string,
  purpose: string,
): Promise<T | null> {
  if (!sealed) return null;
  const [iv, ciphertext] = sealed.split(".");
  if (!iv || !ciphertext) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(iv) },
      await sealKey(secret, purpose),
      fromBase64url(ciphertext),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );
}
