import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import pg from "pg";
import { readSchemaSignature } from "./migration-signature.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const target = new URL(databaseUrl);
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (
  !databaseName ||
  process.env.MIGRATION_CONFIRM_DATABASE !== databaseName ||
  process.env.ADOPT_PR29_BASELINE !== "I_HAVE_A_VERIFIED_BACKUP"
) {
  throw new Error(
    "Set MIGRATION_CONFIRM_DATABASE to the exact database name and ADOPT_PR29_BASELINE=I_HAVE_A_VERIFIED_BACKUP",
  );
}

const injectFailure = process.env.ADOPTION_TEST_FAIL_AFTER_UPGRADE === "true";
if (injectFailure && process.env.MIGRATION_TEST_MODE !== "true") {
  throw new Error(
    "ADOPTION_TEST_FAIL_AFTER_UPGRADE is available only in explicit migration test mode",
  );
}

const drizzleRoot = resolve(import.meta.dirname, "../drizzle");
const manifest = JSON.parse(
  await readFile(resolve(drizzleRoot, "baseline.json"), "utf8"),
);
const releasedSignatures = JSON.parse(
  await readFile(
    resolve(drizzleRoot, "adoption/released_signatures.json"),
    "utf8",
  ),
);
if (!/^\d{14}_[a-z0-9_]+$/.test(manifest.name)) {
  throw new Error("Invalid migration baseline name in baseline.json");
}
const migrationPath = resolve(drizzleRoot, manifest.name, "migration.sql");
if (basename(resolve(migrationPath, "..")) !== manifest.name) {
  throw new Error("Migration baseline path escaped the Drizzle directory");
}
const migrationSql = await readFile(migrationPath);
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
if (migrationHash !== manifest.sha256) {
  throw new Error(
    "The PR29 migration hash does not match baseline.json; stop and review the migration",
  );
}

const upgrades = {
  [releasedSignatures.prePr14]: {
    name: "pre-PR14",
    files: [
      "upgrade_pre_pr14_to_post_pr14.sql",
      "upgrade_post_pr14_to_pr29.sql",
    ],
  },
  [releasedSignatures.postPr14]: {
    name: "post-PR14",
    files: ["upgrade_post_pr14_to_pr29.sql"],
  },
  [releasedSignatures.pr29]: {
    name: "PR29",
    files: [],
  },
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
let sourceName = "unknown";

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [1_987_012_834]);

  const existingLedger = await client.query(
    `select
       to_regnamespace('drizzle') is not null as "schemaExists",
       to_regclass('drizzle.__drizzle_migrations') is not null as "ledgerExists"`,
  );
  if (
    existingLedger.rows[0]?.schemaExists ||
    existingLedger.rows[0]?.ledgerExists
  ) {
    throw new Error(
      "A Drizzle schema or migration ledger already exists; use db:migrate or stop and investigate",
    );
  }

  const initialSignature = await readSchemaSignature(client);
  const source = upgrades[initialSignature.sha256];
  if (!source) {
    throw new Error(
      `Public schema signature ${initialSignature.sha256} is not an audited released shape; no DDL was attempted`,
    );
  }
  sourceName = source.name;

  const publicTables = await client.query(
    `select format('%I.%I', schemaname, tablename) as table_name
     from pg_tables
     where schemaname = 'public'
     order by tablename`,
  );
  if (publicTables.rows.length > 0) {
    await client.query(
      `LOCK TABLE ${publicTables.rows.map((row) => row.table_name).join(", ")} IN ACCESS EXCLUSIVE MODE`,
    );
  }
  const lockedSignature = await readSchemaSignature(client);
  if (lockedSignature.sha256 !== initialSignature.sha256) {
    throw new Error("Public schema changed while adoption locks were acquired");
  }

  if (source.files.length > 0) {
    const invalidFlights = await client.query(
      "select count(*)::int as count from flights where eta <= etd",
    );
    if (invalidFlights.rows[0]?.count > 0) {
      throw new Error(
        `Cannot add the PR29 flight time constraint: ${invalidFlights.rows[0].count} existing flight(s) have eta <= etd`,
      );
    }
  }

  for (const file of source.files) {
    const upgradeSql = await readFile(
      resolve(drizzleRoot, "adoption", file),
      "utf8",
    );
    await client.query(upgradeSql);
  }

  const finalSignature = await readSchemaSignature(client);
  if (finalSignature.sha256 !== releasedSignatures.pr29) {
    throw new Error(
      `Adoption produced schema signature ${finalSignature.sha256}, expected ${releasedSignatures.pr29}`,
    );
  }
  if (injectFailure) {
    throw new Error("Synthetic adoption failure after upgrade");
  }

  await client.query("CREATE SCHEMA drizzle");
  await client.query(`
    CREATE TABLE drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint,
      name text,
      applied_at timestamp with time zone DEFAULT now()
    )
  `);
  await client.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at, name)
     values ($1, $2, $3)`,
    [manifest.sha256, manifest.createdAt, manifest.name],
  );
  await client.query("COMMIT");
  console.log(
    `Adopted ${sourceName} schema as ${manifest.name} on ${databaseName}.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
