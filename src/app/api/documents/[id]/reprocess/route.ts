// POST /api/documents/:id/reprocess — run the current pipeline (and embedding
// model) over the stored original file. Replaces the document's passages.

import { getProvider } from "@/lib/ai";
import { json, withErrorHandling, type RouteContext } from "@/lib/http";
import { reprocessDocument } from "@/lib/rag/ingest";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const POST = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const result = await reprocessDocument(id, getProvider());
  return json({ document: result });
});
