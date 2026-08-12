import type { CSSProperties } from "react";

import type { TenantBrand } from "@/lib/api/schemas";

export const DEFAULT_BRAND: TenantBrand = {
  seedColor: "#e64646",
  presence: "balanced",
  logoUrl: null,
};

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

export function brandStyle(brand: TenantBrand): CSSProperties {
  const seed = parseHex(brand.seedColor) ?? parseHex(DEFAULT_BRAND.seedColor)!;
  const seedHsl = rgbToHsl(seed);
  const action = ensureContrast(seed, { r: 255, g: 255, b: 255 }, 4.5);
  const onAction =
    contrast(action, { r: 255, g: 255, b: 255 }) >=
    contrast(action, { r: 13, g: 23, b: 42 })
      ? { r: 255, g: 255, b: 255 }
      : { r: 13, g: 23, b: 42 };
  const complement = hslToRgb({
    h: (seedHsl.h + 180) % 360,
    s: Math.min(seedHsl.s * 0.7, 0.62),
    l: 0.38,
  });

  return {
    "--brand": toHex(seed),
    "--brand-action": toHex(action),
    "--brand-on-action": toHex(onAction),
    "--brand-strong": toHex(hslToRgb({ ...seedHsl, l: 0.25 })),
    "--brand-soft": toHex(mix(seed, { r: 255, g: 255, b: 255 }, 0.86)),
    "--brand-faint": toHex(mix(seed, { r: 255, g: 255, b: 255 }, 0.94)),
    "--brand-border": toHex(mix(seed, { r: 255, g: 255, b: 255 }, 0.63)),
    "--brand-complement": toHex(complement),
    "--accent": toHex(action),
  } as CSSProperties;
}

export function organizationInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "VA";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function parseHex(value: string): Rgb | null {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mix(a: Rgb, b: Rgb, bWeight: number): Rgb {
  return {
    r: a.r * (1 - bWeight) + b.r * bWeight,
    g: a.g * (1 - bWeight) + b.g * bWeight,
    b: a.b * (1 - bWeight) + b.b * bWeight,
  };
}

function luminance(rgb: Rgb): number {
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function ensureContrast(color: Rgb, background: Rgb, target: number): Rgb {
  if (contrast(color, background) >= target) return color;
  const hsl = rgbToHsl(color);
  let candidate = color;
  for (let lightness = hsl.l; lightness >= 0.12; lightness -= 0.02) {
    candidate = hslToRgb({ ...hsl, l: lightness });
    if (contrast(candidate, background) >= target) return candidate;
  }
  return candidate;
}

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]!;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
