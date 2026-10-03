// GET /api/question-sets/:id/export?scope=approved|all — download answers as CSV.
//
// "approved" (default) exports only human-approved rows: that is the file you would
// actually send to someone. "all" includes drafts and rejected rows with their status.

import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { questionSetInclude, toQuestionSetDTO } from "@/lib/dto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withErrorHandling, type RouteContext } from "@/lib/http";
import { formatPages } from "@/lib/locate";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const GET = withErrorHandling<Context>(async (request, { params }) => {
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get("scope") ?? "approved";
  if (scope !== "approved" && scope !== "all") {
    throw new ValidationError("scope must be 'approved' or 'all'");
  }

  const row = await prisma.questionSet.findUnique({ where: { id }, include: questionSetInclude });
  if (!row) throw new NotFoundError("Question set");
  const set = toQuestionSetDTO(row);

  const questions =
    scope === "approved"
      ? set.questions.filter((q) => q.answer?.status === "APPROVED")
      : set.questions;

  const header = ["#", "Question", "Answer", "Status", "Confidence", "Sources"];
  const body = questions.map((q) => {
    const answer = q.answer;
    const sources = answer
      ? [
          ...new Set(
            answer.citations.map((c) =>
              [`${c.documentTitle} §${c.chunkIndex + 1}`, formatPages(c.pageStart, c.pageEnd)]
                .filter(Boolean)
                .join(", "),
            ),
          ),
        ].join("; ")
      : "";
    return [
      String(q.index + 1),
      q.text,
      answer ? answer.text : "",
      answer ? answer.status : "PENDING",
      answer ? answer.confidence : "",
      sources,
    ];
  });

  const csv = toCsv([header, ...body]);
  const safeName = set.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "answers";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${scope}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
