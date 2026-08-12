import { env } from "../../env.js";

type WeatherProduct = "metar" | "taf";

export type WeatherSnapshot = {
  source: "aviationweather.gov";
  fetchedAt: string;
  stations: string[];
  metar: unknown[] | null;
  taf: unknown[] | null;
  unavailable: WeatherProduct[];
};

const CACHE_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: WeatherSnapshot }>();

export async function fetchWeatherSnapshot(
  stationIds: string[],
  options?: { fetch?: typeof fetch; now?: Date },
): Promise<WeatherSnapshot> {
  const stations = [...new Set(stationIds.map((id) => id.toUpperCase()))]
    .filter((id) => /^[A-Z0-9]{4}$/.test(id))
    .sort();
  const now = options?.now ?? new Date();
  const cacheKey = stations.join(",");
  const cached = cache.get(cacheKey);
  if (!options?.fetch && cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  const fetchImpl = options?.fetch ?? fetch;
  const [metar, taf] = await Promise.all([
    fetchProduct("metar", stations, fetchImpl),
    fetchProduct("taf", stations, fetchImpl),
  ]);
  const unavailable: WeatherProduct[] = [];
  if (metar === null) unavailable.push("metar");
  if (taf === null) unavailable.push("taf");

  const snapshot: WeatherSnapshot = {
    source: "aviationweather.gov",
    fetchedAt: now.toISOString(),
    stations,
    metar,
    taf,
    unavailable,
  };
  if (!options?.fetch) {
    cache.set(cacheKey, {
      expiresAt: now.getTime() + CACHE_MS,
      value: snapshot,
    });
  }
  return snapshot;
}

async function fetchProduct(
  product: WeatherProduct,
  stations: string[],
  fetchImpl: typeof fetch,
): Promise<unknown[] | null> {
  if (stations.length === 0) return [];
  const config = env();
  const url = new URL(`${config.AVIATION_WEATHER_API_ORIGIN}/${product}`);
  url.searchParams.set("ids", stations.join(","));
  url.searchParams.set("format", "json");

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": config.AVIATION_WEATHER_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204) return [];
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
