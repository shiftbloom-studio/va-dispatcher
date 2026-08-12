import { createHash, createSecretKey, type KeyObject } from "node:crypto";

export type SimbriefLegacySignatureInput = {
  origin: string;
  destination: string;
  aircraftType: string;
  timestamp: number;
  outputPage: string;
};

/**
 * Narrow compatibility boundary for SimBrief's server-side Dispatch Redirect
 * helper. SimBrief defines `apicode` as an MD5 digest over its issued machine
 * credential and the exact request fields. The algorithm cannot be replaced
 * without changing the provider protocol.
 *
 * The credential is therefore kept in an opaque KeyObject, never joined into
 * an immutable JavaScript string, and exposed only as a short-lived Buffer
 * that is overwritten immediately after signing.
 */
export class SimbriefLegacySigner {
  readonly #credential: KeyObject;

  constructor(credential: string) {
    const bytes = Buffer.from(credential, "utf8");
    try {
      if (bytes.length === 0) {
        throw new Error("SimBrief signing credential must not be empty");
      }
      this.#credential = createSecretKey(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  sign(input: SimbriefLegacySignatureInput): string {
    const bytes = this.#credential.export();
    try {
      return createHash("md5")
        .update(bytes)
        .update(input.origin, "utf8")
        .update(input.destination, "utf8")
        .update(input.aircraftType, "utf8")
        .update(String(input.timestamp), "utf8")
        .update(input.outputPage, "utf8")
        .digest("hex");
    } finally {
      bytes.fill(0);
    }
  }
}
