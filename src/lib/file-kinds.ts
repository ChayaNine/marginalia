// Which file types we accept, and how to recognise them.
//
// Browser-safe (no Node imports) so client components can reuse the same list
// for the file picker's `accept` attribute and hint text. The actual text
// extraction lives in src/lib/extract.ts, which is server-only.

import { UnsupportedFileError } from "@/lib/errors";

export type FileKind = "pdf" | "docx" | "text" | "markdown" | "csv";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".csv"] as const;

const BY_EXTENSION: Record<string, FileKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".csv": "csv",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/csv": "csv",
};

/**
 * Extension first, MIME type second: browsers are inconsistent about MIME types
 * for .md and .csv (often empty or text/plain), but extensions are what people see.
 */
export function detectFileKind(filename: string, mimeType: string): FileKind {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  const kind = BY_EXTENSION[ext] ?? BY_MIME[mimeType.toLowerCase()];
  if (!kind) {
    throw new UnsupportedFileError(
      `Unsupported file type "${ext || mimeType || "unknown"}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    );
  }
  return kind;
}

/** "Q3_housing-handbook (final).pdf" → "Q3 housing handbook (final)" */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled document";
}
