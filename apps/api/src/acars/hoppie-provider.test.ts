import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertHoppieSuccess,
  HoppieAcarsProvider,
  parseHoppiePollResponse,
} from "./hoppie-provider.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HoppieAcarsProvider", () => {
  it("sends the documented form payload and accepts only an ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HoppieAcarsProvider({ logon: "secret-code" });

    await expect(
      provider.sendTelex({
        from: "SAS",
        to: "SAS123",
        body: "GATE 12",
      }),
    ).resolves.toEqual({ ok: true, raw: "ok" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body?.toString()).toBe(
      "logon=secret-code&from=SAS&to=SAS123&type=telex&packet=GATE+12",
    );
  });

  it("classifies an application-level authentication rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error {illegal logon code}")),
    );
    const provider = new HoppieAcarsProvider({ logon: "wrong" });

    await expect(provider.ping({ station: "SAS" })).rejects.toMatchObject({
      name: "AcarsProviderError",
      code: "authentication",
      message: "Hoppie rejected the logon code.",
    });
  });

  it("maps HTTP rate limiting to a retry-later provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })),
    );
    const provider = new HoppieAcarsProvider({ logon: "secret-code" });

    await expect(provider.ping({ station: "SAS" })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("aborts a provider request after the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const provider = new HoppieAcarsProvider({
      logon: "secret-code",
      timeoutMs: 1,
    });

    await expect(provider.ping({ station: "SAS" })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});

describe("assertHoppieSuccess", () => {
  it("rejects an unknown response without echoing it", () => {
    expect(() =>
      assertHoppieSuccess("unexpected secret-shaped response"),
    ).toThrow("Hoppie returned an invalid response.");
  });

  it("classifies a callsign lock", () => {
    expect(() =>
      assertHoppieSuccess("error {callsign already in use}"),
    ).toThrow("This Hoppie callsign is already in use");
  });
});

describe("parseHoppiePollResponse", () => {
  it("returns empty for ok with no messages", () => {
    expect(parseHoppiePollResponse("ok", "VSAS")).toEqual([]);
  });

  it("parses a telex block", () => {
    const raw =
      "ok {SAS123 telex {REQUESTING GATE ASSIGNMENT}} {SAS456 progress {OUT/1234Z}}";
    const msgs = parseHoppiePollResponse(raw, "VSAS");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      from: "SAS123",
      to: "VSAS",
      type: "telex",
      body: "REQUESTING GATE ASSIGNMENT",
    });
    expect(msgs[1]).toMatchObject({
      from: "SAS456",
      type: "progress",
      body: "OUT/1234Z",
    });
  });

  it("returns empty on error response", () => {
    expect(parseHoppiePollResponse("error {illegal logon}", "VSAS")).toEqual(
      [],
    );
  });
});
