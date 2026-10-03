// Data transfer objects: the JSON shapes the API returns and the UI renders.
//
// Prisma rows carry Dates, Uint8Array embeddings and nested relations that we don't
// want on the wire. These mappers flatten them into plain, serialisable objects
// with a stable shape that both server components and client components share.

import type { Prisma } from "@/generated/prisma/client";
import { PIPELINE_VERSION } from "@/lib/pipeline";
import { parseSummary, type DocumentSummary } from "@/lib/rag/summary";
import { asAnswerStatus, asConfidence, asDocumentStatus } from "@/lib/status";
import type { AnswerStatus, Confidence, DocumentStatus } from "@/lib/status";
import { computeStats, type QuestionSetStats } from "@/lib/stats";

export { computeStats, type QuestionSetStats } from "@/lib/stats";

export type DocumentDTO = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  charCount: number;
  pageCount: number | null;
  chunkCount: number;
  embeddingModel: string;
  /** Processed by an older pipeline; re-processing will improve its passages. */
  outdated: boolean;
  /** The original file is stored (it can be opened and re-processed). */
  hasFile: boolean;
  createdAt: string;
};

export type DocumentDetailDTO = DocumentDTO & { summary: DocumentSummary | null };

export type ChunkDTO = {
  id: string;
  index: number;
  content: string;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
};

export type CitationDTO = {
  id: string;
  order: number;
  chunkId: string;
  chunkIndex: number;
  documentId: string;
  documentTitle: string;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  quote: string;
  verified: boolean;
};

export type AnswerDTO = {
  id: string;
  draft: string;
  finalText: string | null;
  /** What a reader should see: the human edit if there is one, else the draft. */
  text: string;
  confidence: Confidence;
  insufficient: boolean;
  status: AnswerStatus;
  model: string;
  citations: CitationDTO[];
  updatedAt: string;
};

export type QuestionDTO = {
  id: string;
  index: number;
  text: string;
  answer: AnswerDTO | null;
};

export type QuestionSetSummaryDTO = {
  id: string;
  name: string;
  createdAt: string;
  stats: QuestionSetStats;
};

export type QuestionSetDTO = QuestionSetSummaryDTO & {
  questions: QuestionDTO[];
};

/* ---------- Prisma query shapes the mappers accept ---------- */

export const documentWithCountInclude = {
  _count: { select: { chunks: true } },
  file: { select: { documentId: true } }, // existence only, never the bytes
} satisfies Prisma.DocumentInclude;

type DocumentWithCount = Prisma.DocumentGetPayload<{ include: typeof documentWithCountInclude }>;

export const answerWithCitationsInclude = {
  citations: {
    orderBy: { order: "asc" },
    include: {
      chunk: {
        select: {
          index: true,
          heading: true,
          pageStart: true,
          pageEnd: true,
          document: { select: { id: true, title: true } },
        },
      },
    },
  },
} satisfies Prisma.AnswerInclude;

type AnswerWithCitations = Prisma.AnswerGetPayload<{ include: typeof answerWithCitationsInclude }>;

export const questionSetInclude = {
  questions: {
    orderBy: { index: "asc" },
    include: { answer: { include: answerWithCitationsInclude } },
  },
} satisfies Prisma.QuestionSetInclude;

type QuestionSetWithQuestions = Prisma.QuestionSetGetPayload<{
  include: typeof questionSetInclude;
}>;

/* ---------- Mappers ---------- */

export function toDocumentDTO(row: DocumentWithCount): DocumentDTO {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: asDocumentStatus(row.status),
    error: row.error,
    charCount: row.charCount,
    pageCount: row.pageCount,
    chunkCount: row._count.chunks,
    embeddingModel: row.embeddingModel,
    outdated: row.status !== "PROCESSING" && row.pipelineVersion < PIPELINE_VERSION,
    hasFile: row.file !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDocumentDetailDTO(row: DocumentWithCount): DocumentDetailDTO {
  return { ...toDocumentDTO(row), summary: parseSummary(row.summary) };
}

export function toAnswerDTO(row: AnswerWithCitations): AnswerDTO {
  return {
    id: row.id,
    draft: row.draft,
    finalText: row.finalText,
    text: row.finalText ?? row.draft,
    confidence: asConfidence(row.confidence),
    insufficient: row.insufficient,
    status: asAnswerStatus(row.status),
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
    citations: row.citations.map((c) => ({
      id: c.id,
      order: c.order,
      chunkId: c.chunkId,
      chunkIndex: c.chunk.index,
      documentId: c.chunk.document.id,
      documentTitle: c.chunk.document.title,
      heading: c.chunk.heading,
      pageStart: c.chunk.pageStart,
      pageEnd: c.chunk.pageEnd,
      quote: c.quote,
      verified: c.verified,
    })),
  };
}

export function toQuestionSetDTO(row: QuestionSetWithQuestions): QuestionSetDTO {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    stats: computeStats(row.questions),
    questions: row.questions.map((q) => ({
      id: q.id,
      index: q.index,
      text: q.text,
      answer: q.answer ? toAnswerDTO(q.answer) : null,
    })),
  };
}

export function toQuestionSetSummaryDTO(row: {
  id: string;
  name: string;
  createdAt: Date;
  questions: { answer: { status: string } | null }[];
}): QuestionSetSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    stats: computeStats(row.questions),
  };
}
