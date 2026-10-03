// Turning uploaded files into structured documents. Server-only (pulls in the PDF
// and DOCX parsers).
//
// Every format becomes an ExtractedDocument: ordered Blocks (headings, paragraphs,
// tables, captions) with page numbers where the format has pages. See
// src/lib/text/doc-model.ts for why structure matters downstream.

import mammoth from "mammoth";
import { ExtractionError } from "@/lib/errors";
import type { FileKind } from "@/lib/file-kinds";
import { blocksToText, type ExtractedDocument } from "@/lib/text/doc-model";
import { extractPdfLayout } from "@/lib/text/pdf-layout";
import { csvToBlocks, htmlToBlocks, markdownToBlocks, textToBlocks } from "@/lib/text/structure";

export { detectFileKind, titleFromFilename, SUPPORTED_EXTENSIONS } from "@/lib/file-kinds";
export type { FileKind } from "@/lib/file-kinds";

/** Minimum amount of text we consider a usable document. */
export const MIN_TEXT_CHARS = 20;

export async function extractDocument(
  bytes: Uint8Array,
  kind: FileKind,
): Promise<ExtractedDocument> {
  let doc: ExtractedDocument;
  try {
    switch (kind) {
      case "pdf":
        doc = await extractPdfLayout(bytes);
        break;
      case "docx": {
        const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
        doc = htmlToBlocks(value);
        break;
      }
      case "markdown":
        doc = markdownToBlocks(fromUtf8(bytes));
        break;
      case "csv":
        doc = csvToBlocks(fromUtf8(bytes));
        break;
      case "text":
        doc = textToBlocks(fromUtf8(bytes));
        break;
    }
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new ExtractionError(`Could not read this ${kind} file: ${reason}`);
  }

  const blocks = doc.blocks.filter((b) => b.text.trim().length > 0);
  const total = blocks.reduce((n, b) => n + b.text.trim().length, 0);
  if (total < MIN_TEXT_CHARS) {
    throw new ExtractionError(
      kind === "pdf"
        ? "No text layer found in this PDF. It may be a scanned image; OCR is not supported yet."
        : "The file contains no readable text.",
    );
  }
  return { ...doc, blocks };
}

/** Plain text of a file: title, then headings and paragraphs separated by blank lines. */
export async function extractTextFromFile(bytes: Uint8Array, kind: FileKind): Promise<string> {
  const doc = await extractDocument(bytes, kind);
  const body = blocksToText(doc.blocks);
  return doc.title ? `${doc.title}\n\n${body}` : body;
}

function fromUtf8(bytes: Uint8Array): string {
  // fatal:false replaces invalid sequences with U+FFFD instead of throwing.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
}
