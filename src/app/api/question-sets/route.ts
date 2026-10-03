// GET  /api/question-sets — list sets with progress counts
// POST /api/question-sets — create a set from CSV text
// Body: { name: string, csv: string, column?: number | string, hasHeader?: boolean }

import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractQuestions, parseCsv } from "@/lib/csv";
import { questionSetInclude, toQuestionSetDTO, toQuestionSetSummaryDTO } from "@/lib/dto";
import { ValidationError } from "@/lib/errors";
import { json, parseJsonBody, withErrorHandling } from "@/lib/http";
import { MAX_QUESTIONS_PER_SET } from "@/lib/limits";
import { MAX_QUESTION_CHARS } from "@/lib/rag/answer";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  csv: z.string().min(1, "CSV content is required").max(2_000_000),
  column: z.union([z.number().int().min(0), z.string().min(1)]).optional(),
  hasHeader: z.boolean().optional(),
});

export const GET = withErrorHandling(async () => {
  const rows = await prisma.questionSet.findMany({
    orderBy: { createdAt: "desc" },
    include: { questions: { select: { answer: { select: { status: true } } } } },
  });
  return json({ questionSets: rows.map(toQuestionSetSummaryDTO) });
});

export const POST = withErrorHandling(async (request) => {
  const body = await parseJsonBody(request, bodySchema);

  const { rows } = parseCsv(body.csv);
  const { questions } = extractQuestions(rows, { column: body.column, hasHeader: body.hasHeader });

  if (questions.length === 0) {
    throw new ValidationError(
      "No questions found. Check the column selection and that the file is not empty.",
    );
  }
  if (questions.length > MAX_QUESTIONS_PER_SET) {
    throw new ValidationError(
      `Too many questions (${questions.length}); the limit is ${MAX_QUESTIONS_PER_SET} per set.`,
    );
  }
  const tooLong = questions.findIndex((q) => q.length > MAX_QUESTION_CHARS);
  if (tooLong !== -1) {
    throw new ValidationError(
      `Question ${tooLong + 1} is longer than ${MAX_QUESTION_CHARS} characters.`,
    );
  }

  const created = await prisma.questionSet.create({
    data: {
      name: body.name,
      questions: { create: questions.map((text, index) => ({ index, text })) },
    },
    include: questionSetInclude,
  });

  return json({ questionSet: toQuestionSetDTO(created) }, { status: 201 });
});
