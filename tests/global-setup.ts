// Runs once before the whole suite: make sure the scratch folder for per-file
// databases exists, and remove it afterwards.

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const TEST_DB_DIR = path.resolve(__dirname, "../.test-dbs");

export default function globalSetup() {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DB_DIR, { recursive: true });
  return () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  };
}
