import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSimbriefDispatchUrl, SimbriefAdapter } from "./adapter.js";
import { SimbriefLegacySigner } from "./legacy-signer.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSimbriefDispatchUrl", () => {
  it("builds the documented signed redirect without exposing the API key", () => {
    const outputPage =
      "https://api.example.com/api/v1/simbrief/callback?dispatchId=123";
    const signer = new SimbriefLegacySigner("secret");
    const result = buildSimbriefDispatchUrl({
      signer,
      outputPage,
      timestamp: 1_700_000_000,
      parameters: {
        orig: "KORD",
        dest: "KSFO",
        type: "B738",
        static_id: "VAD_123",
      },
    });

    const url = new URL(result);
    expect(url.origin + url.pathname).toBe(
      "https://www.simbrief.com/ofp/ofp.loader.api.php",
    );
    expect(url.searchParams.get("apicode")).toBe(
      "8633764465e2af1d7a736ef3b22acbac",
    );
    expect(url.searchParams.get("outputpage")).toBe(outputPage);
    expect(url.searchParams.get("timestamp")).toBe("1700000000");
    expect(result).not.toContain("secret");
    expect(JSON.stringify(signer)).not.toContain("secret");
  });

  it("does not allow callers to override signing parameters", () => {
    expect(() =>
      buildSimbriefDispatchUrl({
        signer: new SimbriefLegacySigner("secret"),
        outputPage: "https://api.example.com/callback",
        timestamp: 1_700_000_000,
        parameters: {
          orig: "KORD",
          dest: "KSFO",
          type: "B738",
          apicode: "attacker-controlled",
        },
      }),
    ).toThrow("Reserved SimBrief dispatch parameter: apicode");
  });
});

describe("SimbriefAdapter", () => {
  it("fetches and validates the OFP bound to the user, static ID, and route", async () => {
    const ofp = {
      fetch: { userid: "123456", static_id: "VAD_123", status: "Success" },
      params: {
        request_id: "987654",
        user_id: "123456",
        static_id: "VAD_123",
        time_generated: "1700000100",
      },
      origin: { icao_code: "KORD" },
      destination: { icao_code: "KSFO" },
      general: { route: "DCT" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ofp), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SimbriefAdapter().fetchFlightPlan({
      userId: "123456",
      staticId: "VAD_123",
      origin: "KORD",
      destination: "KSFO",
    });

    expect(result).toEqual({
      ofp,
      requestId: "987654",
      generatedAt: new Date("2023-11-14T22:15:00.000Z"),
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("userid")).toBe("123456");
    expect(requested.searchParams.get("static_id")).toBe("VAD_123");
    expect(requested.searchParams.get("json")).toBe("1");
  });

  it("rejects a valid OFP belonging to a different dispatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            params: { user_id: "123456", static_id: "VAD_OTHER" },
            origin: { icao_code: "KORD" },
            destination: { icao_code: "KSFO" },
          }),
        ),
      ),
    );

    await expect(
      new SimbriefAdapter().fetchFlightPlan({
        userId: "123456",
        staticId: "VAD_123",
        origin: "KORD",
        destination: "KSFO",
      }),
    ).rejects.toMatchObject({
      name: "SimbriefAdapterError",
      reason: "mismatch",
    });
  });

  it("maps an absent OFP to a retryable not-ready error without echoing upstream data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private upstream response", { status: 400 }),
        ),
    );

    await expect(
      new SimbriefAdapter().fetchFlightPlan({
        userId: "123456",
        staticId: "VAD_123",
        origin: "KORD",
        destination: "KSFO",
      }),
    ).rejects.toMatchObject({
      reason: "not_ready",
      message:
        "The SimBrief flight plan is not ready. Complete generation in the SimBrief window, then retry.",
    });
  });
});
