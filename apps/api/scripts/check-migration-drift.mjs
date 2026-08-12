import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const apiRoot = resolve(import.meta.dirname, "..");
const sourceMigrations = join(apiRoot, "drizzle");
const temporaryRoot = mkdtempSync(join(tmpdir(), "va-dispatch-drizzle-"));
const temporaryMigrations = join(temporaryRoot, "drizzle");
const manifest = JSON.parse(
  readFileSync(join(sourceMigrations, "baseline.json"), "utf8"),
);
const baselineName = manifest.name;
const baselineSql = readFileSync(
  join(sourceMigrations, baselineName, "migration.sql"),
);
const baselineHash = createHash("sha256").update(baselineSql).digest("hex");
const releasedSignatures = JSON.parse(
  readFileSync(
    join(sourceMigrations, "adoption/released_signatures.json"),
    "utf8",
  ),
);

if (baselineHash !== manifest.sha256) {
  throw new Error(
    "The immutable baseline migration hash does not match baseline.json",
  );
}
if (
  !/^\d{14}_[a-z0-9_]+$/.test(baselineName) ||
  !Number.isSafeInteger(manifest.createdAt)
) {
  throw new Error("baseline.json contains an invalid Drizzle identity");
}
for (const [shape, signature] of Object.entries(releasedSignatures)) {
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new Error(
      `Released schema ${shape} has an invalid catalog signature`,
    );
  }
}

try {
  cpSync(sourceMigrations, temporaryMigrations, { recursive: true });
  const before = new Set(readdirSync(temporaryMigrations));
  const result = spawnSync(
    process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit",
    [
      "generate",
      "--schema",
      "./src/db/schema.ts",
      "--out",
      temporaryMigrations,
      "--dialect",
      "postgresql",
      "--name",
      "schema_drift_detected",
    ],
    {
      cwd: apiRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);

  const generated = readdirSync(temporaryMigrations).filter(
    (entry) => !before.has(entry),
  );
  if (generated.length > 0) {
    console.error(
      `Schema drift detected. Generate and review a migration before committing: ${generated.join(", ")}`,
    );
    process.exit(1);
  }

  console.log("Drizzle schema and migration snapshots are aligned.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
