import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError, apiErrorMessage, requestJson } from "@/lib/api/http";

afterEach(() => vi.unstubAllGlobals());

describe("typed API client", () => {
  it("forwards bearer auth and validates consumed fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 42, ignored: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestJson("https://api.test/value", {
        schema: z.object({ value: z.number() }),
        token: "token-123",
      }),
    ).resolves.toEqual({ value: 42 });
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization"),
    ).toBe("Bearer token-123");
  });

  it("maps the API envelope and request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "State changed" },
          }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": "req-42",
            },
          },
        ),
      ),
    );
    const error = await requestJson("https://api.test/value", {
      schema: z.object({ value: z.number() }),
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "CONFLICT",
      requestId: "req-42",
    });
    expect(apiErrorMessage(error)).toContain("req-42");
  });

  it("fails safely when a successful response drifts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: "wrong" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(
      requestJson("https://api.test/value", {
        schema: z.object({ value: z.number() }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
