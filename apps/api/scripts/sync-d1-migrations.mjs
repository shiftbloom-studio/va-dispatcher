// Copies drizzle-kit output (drizzle/<timestamp>_<name>/migration.sql) into
// the flat, numbered layout that `wrangler d1 migrations apply` expects
// (migrations/0001_<name>.sql). Existing numbered files are never rewritten.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "drizzle");
const target = path.join(root, "migrations");
mkdirSync(target, { recursive: true });

const generated = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const existing = readdirSync(target).filter((name) => name.endsWith(".sql"));

generated.forEach((directory, index) => {
  const name = directory.replace(/^\d+_/, "");
  const number = String(index + 1).padStart(4, "0");
  const file = `${number}_${name}.sql`;
  if (existing.some((candidate) => candidate.startsWith(`${number}_`))) return;
  const migration = path.join(source, directory, "migration.sql");
  if (!existsSync(migration)) return;
  copyFileSync(migration, path.join(target, file));
  console.log(`migrations/${file}`);
});
