// SPDX-License-Identifier: AGPL-3.0-or-later
// Fills the <PLACEHOLDERS> in wrangler.jsonc from environment variables (or a
// local .env.deploy file) and writes wrangler.deploy.jsonc. Keeps
// installation-specific values out of the repository.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [
  ,
  ,
  templateArg = "wrangler.jsonc",
  outputArg = "wrangler.deploy.jsonc",
] = process.argv;
const cwd = process.cwd();
const template = path.resolve(cwd, templateArg);
const output = path.resolve(cwd, outputArg);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const env = { ...process.env };
for (const file of [
  path.join(cwd, ".env.deploy"),
  path.join(repoRoot, ".env.deploy"),
]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    // KEY=value with surrounding whitespace trimmed, parsed without a
    // backtracking regex.
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z0-9_]+$/.test(key) || key in env) continue;
    env[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

let config = readFileSync(template, "utf8");
// Optional bindings: drop their lines when the setting is empty.
for (const key of ["AUTH_IDENTITY_WORKER"]) {
  if (env[key]?.trim()) continue;
  config = config
    .split("\n")
    .filter((line) => !line.includes(`<${key}>`))
    .join("\n");
}
const keys = new Set(
  [
    ...config
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .matchAll(/<([A-Z0-9_]+)>/g),
  ].map((m) => m[1]),
);
// May be empty; everything else is required.
const optional = new Set(["VSAS_AUTH_ORG_ID", "AUTH_CLIENT_ID"]);
const missing = [...keys].filter((key) => !env[key] && !optional.has(key));
if (missing.length) {
  console.error(
    `Missing deploy settings for ${path.basename(template)}:\n  ${missing.join("\n  ")}`,
  );
  console.error(
    "Set them as environment variables (Workers Builds: Settings > Build > Variables) or in .env.deploy.",
  );
  process.exit(1);
}
for (const key of keys) {
  config = config.replaceAll(
    `<${key}>`,
    JSON.stringify(env[key] ?? "").slice(1, -1),
  );
}
writeFileSync(output, config);
console.log(`wrote ${path.relative(cwd, output)}`);
