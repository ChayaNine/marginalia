// GET /api/health — is the app alive, which provider is active, can it reach the DB?

import { getProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { json, withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const provider = getProvider();
  const [documents, questionSets] = await Promise.all([
    prisma.document.count(),
    prisma.questionSet.count(),
  ]);
  return json({
    ok: true,
    provider: provider.name,
    chatModel: provider.chatModel,
    embeddingModel: provider.embeddingModel,
    documents,
    questionSets,
  });
});
