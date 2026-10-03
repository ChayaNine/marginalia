// POST /api/question-sets/:id/draft — draft answers for the next few unanswered
// questions. Body: { limit?: number }. The client calls this repeatedly until
// `remaining` is 0 (or a call makes no progress), showing a progress bar meanwhile.

import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { draftPending } from "@/lib/drafting";
import { json, parseJsonBody, withErrorHandling, type RouteContext } from "@/lib/http";
import { DRAFT_BATCH_SIZE } from "@/lib/limits";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(25).optional(),
});

export const POST = withErrorHandling<Context>(async (request, { params }) => {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, { optional: true });
  const result = await draftPending(id, getProvider(), body.limit ?? DRAFT_BATCH_SIZE);
  return json(result);
});
