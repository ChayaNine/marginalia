// GET    /api/question-sets/:id — the set with every question, answer and citation
// DELETE /api/question-sets/:id — remove it (questions, answers, citations cascade)

import { prisma } from "@/lib/db";
import { questionSetInclude, toQuestionSetDTO } from "@/lib/dto";
import { NotFoundError } from "@/lib/errors";
import { json, withErrorHandling, type RouteContext } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

export const GET = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const row = await prisma.questionSet.findUnique({ where: { id }, include: questionSetInclude });
  if (!row) throw new NotFoundError("Question set");
  return json({ questionSet: toQuestionSetDTO(row) });
});

export const DELETE = withErrorHandling<Context>(async (_request, { params }) => {
  const { id } = await params;
  const existing = await prisma.questionSet.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Question set");
  await prisma.questionSet.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
