import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function verifyVercelBundle(bundlePath) {
  const isolatedDirectory = mkdtempSync(join(tmpdir(), "va-dispatch-api-"));
  const isolatedBundle = join(isolatedDirectory, "app.mjs");
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    copyFileSync(bundlePath, isolatedBundle);
    process.env.NODE_ENV = "test";

    const { default: app } = await import(pathToFileURL(isolatedBundle).href);
    const response = await app.request("https://bundle.test/health");
    const payload = await response.json();

    if (
      response.status !== 200 ||
      payload?.ok !== true ||
      payload?.service !== "va-dispatch-api"
    ) {
      throw new Error(
        "The isolated Vercel API bundle failed its health check.",
      );
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url)
  : undefined;

if (invokedPath && process.argv[1] === invokedPath) {
  const bundleArgument = process.argv[2];
  if (!bundleArgument) {
    throw new Error("Expected the Vercel bundle path as the first argument.");
  }
  await verifyVercelBundle(bundleArgument);
}
