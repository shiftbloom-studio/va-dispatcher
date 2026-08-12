import { describe, expect, it } from "vitest";
import { parseHoppiePollResponse } from "./hoppie-provider.js";

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
