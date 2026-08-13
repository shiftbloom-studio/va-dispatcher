import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

import { verifyVercelBundle } from "./verify-vercel-bundle.mjs";

const outputArgument = process.argv[2];

if (!outputArgument) {
  throw new Error(
    "Expected the Vercel bundle output path as the first argument.",
  );
}

const outputPath = resolve(outputArgument);

await mkdir(dirname(outputPath), { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: outputPath,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

await verifyVercelBundle(outputPath);
