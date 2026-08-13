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
    const checkedInEntrypoint = readFileSync(
      new URL("../vercel-entry.ts", import.meta.url),
      "utf8",
    );
    const bundleScript = readFileSync(
      new URL("../scripts/build-vercel-bundle.mjs", import.meta.url),
      "utf8",
    );

    expect(vercelConfig).toContain('framework: "hono"');
    expect(vercelConfig).toContain('entrypoint: "vercel-entry.ts"');
    expect(vercelConfig).toContain(
      '"node scripts/build-vercel-bundle.mjs vercel-entry.ts"',
    );
    expect(vercelConfig).toContain('"vercel-entry.ts": {');
    expect(vercelConfig).toContain('includeFiles: "package.json"');
    expect(apiPackage.scripts?.["build:vercel"]).toBe(
      "node scripts/build-vercel-bundle.mjs dist/vercel.js",
    );
    expect(checkedInEntrypoint).toContain(
      'export { default } from "./src/index.js"',
    );
    expect(bundleScript).toContain("bundle: true");
    expect(bundleScript).toContain("createRequire");
    expect(bundleScript).toContain("verifyVercelBundle");
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
