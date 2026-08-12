import { AppError } from "../../lib/errors.js";

export const TENANT_LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function validateTenantLogo(
  file: File,
): Promise<"jpg" | "png" | "webp"> {
  if (file.size === 0 || file.size > TENANT_LOGO_MAX_BYTES) {
    throw invalidLogo("Logo images must be no larger than 1 MB");
  }
  if (!LOGO_MIME_TYPES.has(file.type)) {
    throw invalidLogo("Logo images must be PNG, JPEG, or WebP");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = verifiedExtension(bytes, file.type);
  if (!extension) {
    throw invalidLogo("The logo file contents are invalid");
  }
  const dimensions = imageDimensions(bytes, extension);
  if (!dimensions) {
    throw invalidLogo("The logo dimensions could not be read");
  }
  if (dimensions.width !== dimensions.height) {
    throw invalidLogo("The organization logo must be square");
  }
  return extension;
}

function invalidLogo(message: string): AppError {
  return new AppError("UNPROCESSABLE", message);
}

function verifiedExtension(
  bytes: Uint8Array,
  mime: string,
): "jpg" | "png" | "webp" | null {
  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
  const isWebp =
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP";

  if (isPng && mime === "image/png") return "png";
  if (isJpeg && mime === "image/jpeg") return "jpg";
  if (isWebp && mime === "image/webp") return "webp";
  return null;
}

function imageDimensions(
  bytes: Uint8Array,
  extension: "jpg" | "png" | "webp",
): { width: number; height: number } | null {
  if (extension === "png") {
    if (ascii(bytes, 12, 16) !== "IHDR") return null;
    return dimensions(readU32Be(bytes, 16), readU32Be(bytes, 20));
  }
  if (extension === "jpg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const length = readU16Be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (isStartOfFrame(marker) && length >= 7) {
      return dimensions(
        readU16Be(bytes, offset + 5),
        readU16Be(bytes, offset + 3),
      );
    }
    offset += length;
  }
  return null;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, offset + 4);
    const size = readU32Le(bytes, offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;

    if (chunk === "VP8X" && size >= 10) {
      return dimensions(
        1 + readU24Le(bytes, data + 4),
        1 + readU24Le(bytes, data + 7),
      );
    }
    if (chunk === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1]!;
      const b2 = bytes[data + 2]!;
      const b3 = bytes[data + 3]!;
      const b4 = bytes[data + 4]!;
      return dimensions(
        1 + (b1 | ((b2 & 0x3f) << 8)),
        1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
      );
    }
    if (
      chunk === "VP8 " &&
      size >= 10 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      return dimensions(
        readU16Le(bytes, data + 6) & 0x3fff,
        readU16Le(bytes, data + 8) & 0x3fff,
      );
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function dimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) +
      ((bytes[offset + 1] ?? 0) << 8) +
      ((bytes[offset + 2] ?? 0) << 16) +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  );
}
