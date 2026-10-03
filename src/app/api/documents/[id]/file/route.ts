// GET /api/documents/:id/file — the original upload, shown inline in the browser.
// Citations link here with "#page=N", which browsers' PDF viewers honour, so a
// reader lands on the cited page.

import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { withErrorHandling, type RouteContext } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const GET = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: { filename: true, mimeType: true, file: { select: { data: true } } },
  });
  if (!document || !document.file) throw new NotFoundError("Original file");

  const data = new Uint8Array(document.file.data);
  // Only formats a browser can display safely are served inline; everything else
  // downloads. Text is served as plain text so an uploaded .html-in-.txt can't run.
  const inline = /^(application\/pdf|text\/plain|text\/markdown|text\/csv)$/.test(
    document.mimeType,
  );
  const type = document.mimeType.startsWith("text/")
    ? "text/plain; charset=utf-8"
    : document.mimeType;
  return new Response(data, {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
