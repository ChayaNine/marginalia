// CSV parsing and writing, dependency-free.
//
// Parsing follows RFC 4180: fields may be quoted, quotes inside quoted fields are
// doubled (""), quoted fields may contain the delimiter and newlines, and both LF
// and CRLF line endings are accepted. The delimiter is auto-detected from the first
// line (comma, semicolon or tab) because exports from spreadsheets in some locales
// use semicolons.
//
// This module has no Node-only imports on purpose: the question-set import form
// runs it in the browser to preview columns before uploading.

export type ParsedCsv = {
  rows: string[][];
  delimiter: string;
};

const CANDIDATE_DELIMITERS = [",", ";", "\t"] as const;

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: string = ",";
  let bestCount = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

export function parseCsv(text: string, options: { delimiter?: string } = {}): ParsedCsv {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && input[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush the final field/row unless the input ended cleanly on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty (e.g. blank trailing lines).
  return { rows: rows.filter((r) => r.some((cell) => cell.trim().length > 0)), delimiter };
}

const HEADER_PATTERN = /^(question|questions|prompt|prompts|query|queries|text|item|q)$/i;

/** Index of the column that looks like it holds questions, or -1. */
export function guessQuestionColumn(headerRow: string[]): number {
  return headerRow.findIndex((cell) => HEADER_PATTERN.test(cell.trim()));
}

export function looksLikeHeader(firstRow: string[]): boolean {
  return guessQuestionColumn(firstRow) !== -1;
}

export type ExtractedQuestions = {
  questions: string[];
  header: string[] | null;
  column: number;
};

/**
 * Pulls the question text out of parsed rows. `column` may be an index or a header
 * name; `hasHeader` defaults to auto-detection.
 */
export function extractQuestions(
  rows: string[][],
  options: { column?: number | string; hasHeader?: boolean } = {},
): ExtractedQuestions {
  if (rows.length === 0) return { questions: [], header: null, column: 0 };

  const hasHeader = options.hasHeader ?? looksLikeHeader(rows[0]);
  const header = hasHeader ? rows[0] : null;

  let column: number;
  if (typeof options.column === "number") {
    column = options.column;
  } else if (typeof options.column === "string" && header) {
    column = header.findIndex(
      (h) => h.trim().toLowerCase() === options.column?.toString().trim().toLowerCase(),
    );
    if (column === -1) column = 0;
  } else {
    column = header ? Math.max(0, guessQuestionColumn(header)) : 0;
  }

  const body = hasHeader ? rows.slice(1) : rows;
  const questions = body
    .map((r) => (r[column] ?? "").replace(/\s+/g, " ").trim())
    .filter((q) => q.length > 0);

  return { questions, header, column };
}

/** Formats rows as CSV text (CRLF line endings, which Excel prefers). */
export function toCsv(
  rows: string[][],
  options: { delimiter?: string; protectFormulas?: boolean } = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const protect = options.protectFormulas ?? true;
  return (
    rows
      .map((row) => row.map((cell) => escapeCell(cell, delimiter, protect)).join(delimiter))
      .join("\r\n") + "\r\n"
  );
}

function escapeCell(value: string, delimiter: string, protectFormulas: boolean): string {
  let cell = value ?? "";
  // Spreadsheets execute cells beginning with = + - @ as formulas ("CSV injection").
  // A leading apostrophe makes the spreadsheet treat the cell as text.
  if (protectFormulas && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (cell.includes('"') || cell.includes(delimiter) || /[\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
