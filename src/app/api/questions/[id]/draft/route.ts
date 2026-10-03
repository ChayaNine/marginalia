// POST /api/questions/:id/draft — (re)generate the draft for a single question.
// Approved answers are protected: un-approve first (409 otherwise).

import { getProvider } from "@/lib/ai";
import { draftAnswer } from "@/lib/drafting";
import { json, withErrorHandling, type RouteContext } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const POST = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const answer = await draftAnswer(id, getProvider());
  return json({ answer });
});
