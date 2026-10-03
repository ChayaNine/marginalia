// GET  /api/documents — list documents (newest first)
// POST /api/documents — upload one file (multipart/form-data, field "file").
//   201 with the new document; 200 when the same file was already uploaded and
//   has been re-processed with the current pipeline instead.

import { getProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { documentWithCountInclude, toDocumentDTO } from "@/lib/dto";
import { ValidationError } from "@/lib/errors";
import { json, withErrorHandling } from "@/lib/http";
import { ingestDocument } from "@/lib/rag/ingest";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const rows = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: documentWithCountInclude,
  });
  return json({ documents: rows.map(toDocumentDTO) });
});

export const POST = withErrorHandling(async (request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("Expected multipart/form-data with a 'file' field");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Missing 'file' field");
  if (!file.name) throw new ValidationError("Uploaded file has no name");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await ingestDocument({
    filename: file.name,
    mimeType: file.type,
    bytes,
    provider: getProvider(),
  });

  return json({ document: result }, { status: result.reprocessed ? 200 : 201 });
});
