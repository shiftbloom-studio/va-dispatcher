import { describe, expect, it } from "vitest";
import { validateTenantLogo } from "./logo.js";

describe("tenant logo validation", () => {
  it("accepts a square PNG header", async () => {
    await expect(validateTenantLogo(pngFile(128, 128))).resolves.toBe("png");
  });

  it("rejects a non-square image", async () => {
    await expect(validateTenantLogo(pngFile(128, 64))).rejects.toMatchObject({
      code: "UNPROCESSABLE",
      message: "The organization logo must be square",
    });
  });

  it("rejects a MIME type that does not match the bytes", async () => {
    const file = new File([pngBytes(64, 64)], "logo.webp", {
      type: "image/webp",
    });
    await expect(validateTenantLogo(file)).rejects.toMatchObject({
      code: "UNPROCESSABLE",
      message: "The logo file contents are invalid",
    });
  });
});

function pngFile(width: number, height: number): File {
  return new File([pngBytes(width, height)], "logo.png", {
    type: "image/png",
  });
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeU32Be(bytes, 16, width);
  writeU32Be(bytes, 20, height);
  return bytes;
}

function writeU32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
