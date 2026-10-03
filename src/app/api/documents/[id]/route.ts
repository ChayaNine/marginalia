// GET    /api/documents/:id — document with its summary and passages (text only, no vectors)
// DELETE /api/documents/:id — remove it (passages, stored file and citations cascade)

import { prisma } from "@/lib/db";
import { documentWithCountInclude, toDocumentDetailDTO, type ChunkDTO } from "@/lib/dto";
import { NotFoundError } from "@/lib/errors";
import { json, withErrorHandling, type RouteContext } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const GET = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const row = await prisma.document.findUnique({
    where: { id },
    include: {
      ...documentWithCountInclude,
      chunks: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          content: true,
          heading: true,
          pageStart: true,
          pageEnd: true,
          tokenCount: true,
        },
      },
    },
  });
  if (!row) throw new NotFoundError("Document");

  const chunks: ChunkDTO[] = row.chunks;
  return json({ document: toDocumentDetailDTO(row), chunks });
});

export const DELETE = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const existing = await prisma.document.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Document");
  await prisma.document.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
