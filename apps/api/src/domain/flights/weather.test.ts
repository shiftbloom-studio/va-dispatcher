import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv, resetEnvCache } from "../../env.js";
import { fetchWeatherSnapshot } from "./weather.js";

describe("dispatch weather snapshots", () => {
  afterEach(() => resetEnvCache());

  it("batches and normalizes stations with an identifiable user agent", async () => {
    loadEnv({
      NODE_ENV: "test",
      AVIATION_WEATHER_API_ORIGIN: "https://weather.test/api/data",
      AVIATION_WEATHER_USER_AGENT: "va-dispatch-test/contact@example.test",
    });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("ids")).toBe("EKCH,ENGM");
        expect(url.searchParams.get("format")).toBe("json");
        expect(init?.headers).toMatchObject({
          "User-Agent": "va-dispatch-test/contact@example.test",
        });
        return new Response(
          JSON.stringify([
            { icaoId: "EKCH", product: url.pathname.split("/").at(-1) },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const snapshot = await fetchWeatherSnapshot(["engm", "EKCH", "engm"], {
      fetch: fetchMock as typeof fetch,
      now: new Date("2026-09-01T10:00:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(snapshot.stations).toEqual(["EKCH", "ENGM"]);
    expect(snapshot.unavailable).toEqual([]);
    expect(snapshot.fetchedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("discloses partial upstream failure without blocking a release", async () => {
    loadEnv({
      NODE_ENV: "test",
      AVIATION_WEATHER_API_ORIGIN: "https://weather.test/api/data",
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/metar")
        ? new Response(null, { status: 204 })
        : new Response("unavailable", { status: 503 });
    });

    const snapshot = await fetchWeatherSnapshot(["EKCH"], {
      fetch: fetchMock as typeof fetch,
    });

    expect(snapshot.metar).toEqual([]);
    expect(snapshot.taf).toBeNull();
    expect(snapshot.unavailable).toEqual(["taf"]);
  });
});
