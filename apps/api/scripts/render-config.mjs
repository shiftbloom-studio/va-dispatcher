// SPDX-License-Identifier: AGPL-3.0-or-later
// Fills the <PLACEHOLDERS> in wrangler.jsonc from environment variables (or a
// local .env.deploy file) and writes wrangler.deploy.jsonc. Keeps
// installation-specific values out of the repository.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , templateArg = "wrangler.jsonc", outputArg = "wrangler.deploy.jsonc"] = process.argv;
const cwd = process.cwd();
const template = path.resolve(cwd, templateArg);
const output = path.resolve(cwd, outputArg);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const env = { ...process.env };
for (const file of [path.join(cwd, ".env.deploy"), path.join(repoRoot, ".env.deploy")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

let config = readFileSync(template, "utf8");
const keys = new Set(
  [...config.replace(/^\s*\/\/.*$/gm, "").matchAll(/<([A-Z0-9_]+)>/g)].map((m) => m[1]),
);
// May be empty; everything else is required.
const optional = new Set(["VSAS_CLERK_ORG_ID"]);
const missing = [...keys].filter((key) => !env[key] && !optional.has(key));
if (missing.length) {
  console.error(`Missing deploy settings for ${path.basename(template)}:\n  ${missing.join("\n  ")}`);
  console.error("Set them as environment variables (Workers Builds: Settings > Build > Variables) or in .env.deploy.");
  process.exit(1);
}
for (const key of keys) {
  config = config.replaceAll(`<${key}>`, JSON.stringify(env[key] ?? "").slice(1, -1));
}
writeFileSync(output, config);
console.log(`wrote ${path.relative(cwd, output)}`);
