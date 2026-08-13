import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const isolatedDirectory = mkdtempSync(join(tmpdir(), "va-dispatch-api-"));
const isolatedBundle = join(isolatedDirectory, "app.mjs");
const previousNodeEnv = process.env.NODE_ENV;

try {
  copyFileSync(new URL("../dist/vercel.js", import.meta.url), isolatedBundle);
  process.env.NODE_ENV = "test";

  const { default: app } = await import(pathToFileURL(isolatedBundle).href);
  const response = await app.request("https://bundle.test/health");
  const payload = await response.json();

  if (
    response.status !== 200 ||
    payload?.ok !== true ||
    payload?.service !== "va-dispatch-api"
  ) {
    throw new Error("The isolated Vercel API bundle failed its health check.");
  }
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  rmSync(isolatedDirectory, { recursive: true, force: true });
}
