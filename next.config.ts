import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages load native code or Node-only APIs at runtime, so the server
  // bundle must `require` them from node_modules instead of trying to bundle them.
  // (Next externalises @prisma/client and better-sqlite3 by default; the adapter
  // and the document parsers are ours to declare.)
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "unpdf", "mammoth"],
};

export default nextConfig;
