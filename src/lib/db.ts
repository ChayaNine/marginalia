// Prisma client singleton.
//
// Next.js hot-reloads server modules in development, which would otherwise create a
// new PrismaClient (and a new SQLite connection) on every save. Caching the client
// on `globalThis` is the standard workaround.
//
// Prisma 7 talks to SQLite through a JS driver adapter (better-sqlite3) instead of
// a Rust engine, which is what lets `npm install` work without downloading
// platform-specific binaries. Prisma turns on SQLite foreign-key enforcement when it
// connects, so the `onDelete: Cascade` rules in schema.prisma are honoured
// (tests/db.test.ts proves this rather than trusting it).

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: getEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
