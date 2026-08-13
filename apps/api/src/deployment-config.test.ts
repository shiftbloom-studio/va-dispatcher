import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { config } from "../../../vercel.js";

describe("Vercel service packaging", () => {
  it("keeps the Hono handler inside an ESM package boundary", () => {
    const rootPackage = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { type?: string };

    expect(config.services.api.framework).toBe("hono");
    expect(
      config.services.api.functions["src/index.ts"].includeFiles,
    ).toBe("package.json");
    expect(rootPackage.type).toBe("module");
  });

  it("runs web and API compute beside the eu-central-1 database", () => {
    expect(config.regions).toEqual(["fra1"]);
  });
});
