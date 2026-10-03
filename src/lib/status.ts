// Status vocabularies.
//
// The Prisma schema stores these as plain strings (SQLite-friendly, Postgres-
// portable). These zod enums are the single source of truth for what the
// strings may be, both when we write them and when we validate API input.

import { z } from "zod";

export const documentStatusSchema = z.enum(["PROCESSING", "READY", "FAILED"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const answerStatusSchema = z.enum(["DRAFT", "APPROVED", "REJECTED"]);
export type AnswerStatus = z.infer<typeof answerStatusSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export function asAnswerStatus(value: string): AnswerStatus {
  const parsed = answerStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "DRAFT";
}

export function asConfidence(value: string): Confidence {
  const parsed = confidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : "low";
}

export function asDocumentStatus(value: string): DocumentStatus {
  const parsed = documentStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "FAILED";
}
