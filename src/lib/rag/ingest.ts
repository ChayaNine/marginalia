// Document ingestion: file → structured blocks → chunks → embeddings → rows.
//
//   extract   PDF layout analysis / DOCX / Markdown / text  → headings, paragraphs,
//             tables with page numbers (src/lib/extract.ts)
//   chunk     whole sentences, one section at a time, ~300 tokens (./chunk.ts)
//   embed     each chunk *with its document title and section path*, so a passage
//             that never names its topic is still found by it
//   summarise abstract, key points and outline, computed without a model (./summary.ts)
//   store     chunks + vectors, the summary, and the original file (for "open the
//             PDF at this page" and for re-processing)
//
// The Document row is created *first* with status PROCESSING and flipped to READY
// or FAILED at the end, so a failure leaves a visible record (with the reason)
// instead of vanishing.
//
// Everything runs inside the upload request: a few seconds for files of a few MB.
// A job queue is the next step for bigger inputs (see NOTES.md).

import { createHash } from "node:crypto";
import type { AIProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  ConflictError,
  ExtractionError,
  FileTooLargeError,
  NotFoundError,
  errorMessage,
} from "@/lib/errors";
import { extractDocument } from "@/lib/extract";
import { detectFileKind, titleFromFilename, type FileKind } from "@/lib/file-kinds";
import { PIPELINE_VERSION } from "@/lib/pipeline";
import { blocksToText } from "@/lib/text/doc-model";
import { chunkBlocks, contextualText } from "./chunk";
import { summarizeDocument } from "./summary";
import { approxTokenCount } from "./tokens";
import { vectorToBytes } from "./vectors";

export { PIPELINE_VERSION } from "@/lib/pipeline";

export type IngestInput = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  provider: AIProvider;
};

export type IngestedDocument = {
  id: string;
  title: string;
  status: "READY";
  chunkCount: number;
  charCount: number;
  pageCount: number | null;
  /** True when an existing document was re-processed instead of a new one created. */
  reprocessed: boolean;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ingestDocument(input: IngestInput): Promise<IngestedDocument> {
  const { provider, bytes } = input;
  const maxMb = getEnv().MAX_UPLOAD_MB;
  if (bytes.byteLength > maxMb * 1024 * 1024) throw new FileTooLargeError(maxMb);
  if (bytes.byteLength === 0) throw new ConflictError("The uploaded file is empty");

  // Validate the type before touching the database.
  const kind = detectFileKind(input.filename, input.mimeType);
  const mimeType = input.mimeType || "application/octet-stream";
  const sha256 = sha256Hex(bytes);

  const existing = await prisma.document.findUnique({
    where: { sha256 },
    select: { id: true, title: true, status: true, pipelineVersion: true, embeddingModel: true },
  });
  if (existing) {
    const stale =
      existing.status === "FAILED" ||
      (existing.status === "READY" &&
        (existing.pipelineVersion < PIPELINE_VERSION ||
          existing.embeddingModel !== provider.embeddingModel));
    if (!stale) {
      throw new ConflictError(`This exact file was already uploaded as "${existing.title}".`, {
        documentId: existing.id,
        status: existing.status,
      });
    }
    // Same bytes, but processed by an older pipeline, a different embedding model,
    // or it failed last time: process it again in place (keeps the id and URL).
    await prisma.document.update({
      where: { id: existing.id },
      data: {
        status: "PROCESSING",
        error: null,
        filename: input.filename,
        mimeType,
        sizeBytes: bytes.byteLength,
      },
    });
    return processDocument(existing.id, { bytes, kind, filename: input.filename, provider }, true);
  }

  const document = await prisma.document.create({
    data: {
      title: titleFromFilename(input.filename),
      filename: input.filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      status: "PROCESSING",
      embeddingModel: provider.embeddingModel,
    },
    select: { id: true },
  });
  return processDocument(document.id, { bytes, kind, filename: input.filename, provider }, false);
}

/**
 * Re-runs the pipeline on a stored document's original file — after a pipeline
 * upgrade, or to re-embed with a different model. Chunks are replaced, so
 * citations in existing answers that pointed at this document's old chunks are
 * removed (the answers themselves stay).
 */
export async function reprocessDocument(
  documentId: string,
  provider: AIProvider,
): Promise<IngestedDocument> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      status: true,
      file: { select: { data: true } },
    },
  });
  if (!document) throw new NotFoundError("Document");
  if (document.status === "PROCESSING")
    throw new ConflictError("This document is already being processed.");
  if (!document.file) {
    throw new ConflictError(
      "The original file was not kept for this document (it was uploaded before files were stored). Upload the same file again to re-process it.",
      { documentId },
    );
  }
  const kind = detectFileKind(document.filename, document.mimeType);
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "PROCESSING", error: null },
  });
  return processDocument(
    documentId,
    { bytes: new Uint8Array(document.file.data), kind, filename: document.filename, provider },
    true,
  );
}

type ProcessInput = { bytes: Uint8Array; kind: FileKind; filename: string; provider: AIProvider };

async function processDocument(
  documentId: string,
  input: ProcessInput,
  reprocessed: boolean,
): Promise<IngestedDocument> {
  const { provider } = input;
  try {
    const extracted = await extractDocument(input.bytes, input.kind);
    const title = chooseTitle(extracted.title, input.filename);
    const chunks = chunkBlocks(extracted.blocks);
    if (chunks.length === 0) throw new ExtractionError("The file contains no readable text.");

    const vectors = await provider.embed(chunks.map((chunk) => contextualText(chunk, title)));
    if (vectors.length !== chunks.length) {
      throw new Error(`Provider returned ${vectors.length} vectors for ${chunks.length} chunks`);
    }

    const summary = summarizeDocument(extracted.blocks, chunks);
    const charCount = blocksToText(extracted.blocks).length;
    const pageCount = extracted.pageCount ?? null;
    const fileBytes = new Uint8Array(new ArrayBuffer(input.bytes.byteLength));
    fileBytes.set(input.bytes);

    await prisma.$transaction([
      prisma.chunk.deleteMany({ where: { documentId } }),
      prisma.chunk.createMany({
        data: chunks.map((chunk, i) => ({
          documentId,
          index: chunk.index,
          content: chunk.content,
          heading: chunk.heading,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          tokenCount: approxTokenCount(chunk.content),
          embedding: vectorToBytes(vectors[i]),
        })),
      }),
      prisma.documentFile.upsert({
        where: { documentId },
        create: { documentId, data: fileBytes },
        update: { data: fileBytes },
      }),
      prisma.document.update({
        where: { id: documentId },
        data: {
          status: "READY",
          error: null,
          title,
          charCount,
          pageCount,
          summary: JSON.stringify(summary),
          pipelineVersion: PIPELINE_VERSION,
          embeddingModel: provider.embeddingModel,
        },
      }),
    ]);

    return {
      id: documentId,
      title,
      status: "READY",
      chunkCount: chunks.length,
      charCount,
      pageCount,
      reprocessed,
    };
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "FAILED", error: errorMessage(error).slice(0, 1000) },
    });
    throw error;
  }
}

/**
 * A PDF's own title ("Towards Robust UAV Tracking in GNSS-Denied Environments")
 * beats its filename ("2310.09165v1.pdf") — when the detected title looks like a
 * real one. Otherwise the cleaned-up filename.
 */
export function chooseTitle(detected: string | undefined, filename: string): string {
  const title = detected?.replace(/\s+/g, " ").trim();
  if (title && title.length >= 8 && title.length <= 200 && title.split(" ").length >= 2)
    return title;
  return titleFromFilename(filename);
}
