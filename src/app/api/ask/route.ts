// POST /api/ask — answer an ad-hoc question from the knowledge base.
// Body: { question: string, documentIds?: string[] }
// Nothing is persisted; this is the "quick check" path. Question sets are the
// reviewed, exportable path.

import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { json, parseJsonBody, withErrorHandling } from "@/lib/http";
import { MAX_QUESTION_CHARS, answerQuestion } from "@/lib/rag/answer";
import { createDbRetriever } from "@/lib/rag/retrieve";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  question: z.string().min(1, "Question is required").max(MAX_QUESTION_CHARS),
  documentIds: z.array(z.string().min(1)).max(100).optional(),
});

export const POST = withErrorHandling(async (request) => {
  const body = await parseJsonBody(request, bodySchema);
  const provider = getProvider();

  const result = await answerQuestion({
    question: body.question,
    documentIds: body.documentIds,
    provider,
    retriever: createDbRetriever(provider.embeddingModel),
  });

  return json({ result });
});
