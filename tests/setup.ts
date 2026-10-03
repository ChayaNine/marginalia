// Per-test-file setup. Runs before the file's imports are evaluated, so the
// environment is in place before src/lib/db.ts creates its Prisma client.
//
// Each file gets a fresh SQLite database built from the checked-in migrations.
// Applying the SQL directly (rather than shelling out to `prisma db push`) keeps
// the suite hermetic and fast: no CLI, no network, ~10 ms per database.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../prisma/migrations");
const TEST_DB_DIR = path.resolve(__dirname, "../.test-dbs");

const dbPath = path.join(TEST_DB_DIR, `${randomUUID()}.db`);
const db = new Database(dbPath);

for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  db.exec(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
}
db.close();

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.AI_PROVIDER = "mock";
process.env.OPENAI_API_KEY = "";
process.env.MAX_UPLOAD_MB = "10";
