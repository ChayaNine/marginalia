// Drafting answers for question sets (the batch workflow).
//
// draftAnswer()   – answer one question and persist the draft + citations.
// draftPending()  – answer the next `limit` unanswered questions in a set.
//
// Batches are deliberately small and sequential: the browser calls the endpoint in
// a loop and shows progress, and each request stays well under typical HTTP
// timeouts. A queue with workers would be the production version (NOTES.md).

import type { AIProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import { answerWithCitationsInclude, toAnswerDTO, type AnswerDTO } from "@/lib/dto";
import { ConflictError, NotFoundError, errorMessage } from "@/lib/errors";
import { answerQuestion } from "@/lib/rag/answer";
import { createDbRetriever } from "@/lib/rag/retrieve";

export async function draftAnswer(questionId: string, provider: AIProvider): Promise<AnswerDTO> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: { select: { status: true } } },
  });
  if (!question) throw new NotFoundError("Question");
  if (question.answer?.status === "APPROVED") {
    throw new ConflictError("This answer is approved. Un-approve it before regenerating.");
  }

  const result = await answerQuestion({
    question: question.text,
    provider,
    retriever: createDbRetriever(provider.embeddingModel),
  });

  const saved = await prisma.$transaction(async (tx) => {
    const answer = await tx.answer.upsert({
      where: { questionId },
      create: {
        questionId,
        draft: result.answer,
        confidence: result.confidence,
        insufficient: result.insufficient,
        status: "DRAFT",
        model: result.model,
      },
      update: {
        draft: result.answer,
        finalText: null,
        confidence: result.confidence,
        insufficient: result.insufficient,
        status: "DRAFT",
        model: result.model,
      },
    });

    await tx.citation.deleteMany({ where: { answerId: answer.id } });
    if (result.citations.length > 0) {
      await tx.citation.createMany({
        data: result.citations.map((c) => ({
          answerId: answer.id,
          chunkId: c.chunkId,
          quote: c.quote,
          verified: c.verified,
          order: c.order,
        })),
      });
    }

    return tx.answer.findUniqueOrThrow({
      where: { id: answer.id },
      include: answerWithCitationsInclude,
    });
  });

  return toAnswerDTO(saved);
}

export type DraftBatchResult = {
  drafted: number;
  /** Questions in the set that still have no answer (including ones that just failed). */
  remaining: number;
  failed: { questionId: string; error: string }[];
};

export async function draftPending(
  questionSetId: string,
  provider: AIProvider,
  limit = 5,
): Promise<DraftBatchResult> {
  const set = await prisma.questionSet.findUnique({
    where: { id: questionSetId },
    select: { id: true },
  });
  if (!set) throw new NotFoundError("Question set");

  const pending = await prisma.question.findMany({
    where: { questionSetId, answer: null },
    orderBy: { index: "asc" },
    take: limit,
    select: { id: true },
  });

  let drafted = 0;
  const failed: DraftBatchResult["failed"] = [];
  for (const q of pending) {
    try {
      await draftAnswer(q.id, provider);
      drafted++;
    } catch (error) {
      failed.push({ questionId: q.id, error: errorMessage(error) });
    }
  }

  const remaining = await prisma.question.count({ where: { questionSetId, answer: null } });
  return { drafted, remaining, failed };
}
