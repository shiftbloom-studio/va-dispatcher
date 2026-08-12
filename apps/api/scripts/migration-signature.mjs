import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const signatureSqlPath = resolve(
  import.meta.dirname,
  "../drizzle/adoption/schema_signature.sql",
);

export async function readSchemaSignature(client) {
  const signatureSql = await readFile(signatureSqlPath, "utf8");
  const result = await client.query(signatureSql);
  const lines = result.rows.map((row) => String(row.signature));
  return {
    lines,
    sha256: createHash("sha256").update(lines.join("\n")).digest("hex"),
  };
}
