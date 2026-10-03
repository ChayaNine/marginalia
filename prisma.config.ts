// Prisma 7 configuration. The CLI (generate / db push / migrate / studio) reads
// this file; the app itself never imports it.
//
// Prisma 7 does not load .env automatically, so we pull it in here for the CLI.
// Next.js loads .env on its own for the running app.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Default matches src/lib/env.ts, so a fresh clone can `npm install` (which runs
// `prisma generate`) before a .env file exists.
const DEFAULT_DATABASE_URL = "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  },
  migrations: {
    seed: "tsx scripts/seed.ts",
  },
});
