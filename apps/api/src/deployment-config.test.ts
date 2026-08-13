import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Vercel service packaging", () => {
  it("bundles the Hono handler and keeps its ESM package boundary", () => {
    const vercelConfig = readFileSync(
      new URL("../../../vercel.ts", import.meta.url),
      "utf8",
    );
    const rootPackage = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { type?: string };
    const apiPackage = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(vercelConfig).toContain('framework: "hono"');
    expect(vercelConfig).toContain('entrypoint: "dist/vercel.js"');
    expect(vercelConfig).toContain('buildCommand: "pnpm run build:vercel"');
    expect(vercelConfig).toContain('"dist/vercel.js": {');
    expect(vercelConfig).toContain('includeFiles: "package.json"');
    expect(apiPackage.scripts?.["build:vercel"]).toContain("--bundle");
    expect(apiPackage.scripts?.["build:vercel"]).toContain("createRequire");
    expect(apiPackage.scripts?.["build:vercel"]).toContain(
      "verify-vercel-bundle.mjs",
    );
    expect(rootPackage.type).toBe("module");
  });

  it("runs web and API compute beside the eu-central-1 database", () => {
    const vercelConfig = readFileSync(
      new URL("../../../vercel.ts", import.meta.url),
      "utf8",
    );

    expect(vercelConfig).toContain('regions: ["fra1"]');
  });
});
