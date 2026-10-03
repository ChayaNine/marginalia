// Application error types.
//
// Every error we *expect* (bad input, missing record, unsupported file, upstream AI
// failure) is an AppError with a stable machine-readable `code` and an HTTP status.
// Route handlers turn these into JSON via src/lib/http.ts. Anything that is not an
// AppError is a bug, gets logged with its stack, and is returned as a generic 500
// so we never leak internals to the browser.

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation_error", message, 400, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super("not_found", `${what} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super("conflict", message, 409, details);
    this.name = "ConflictError";
  }
}

export class UnsupportedFileError extends AppError {
  constructor(message: string) {
    super("unsupported_file", message, 415);
    this.name = "UnsupportedFileError";
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxMb: number) {
    super("file_too_large", `File is larger than the ${maxMb} MB limit`, 413);
    this.name = "FileTooLargeError";
  }
}

export class ExtractionError extends AppError {
  constructor(message: string, details?: unknown) {
    super("extraction_failed", message, 422, details);
    this.name = "ExtractionError";
  }
}

export class AIProviderError extends AppError {
  constructor(message: string, details?: unknown) {
    super("ai_provider_error", message, 502, details);
    this.name = "AIProviderError";
  }
}

/**
 * The database file is older than the code (a column or table is missing):
 * happens after pulling a new version without running `npm run db:push`.
 */
export const SCHEMA_OUT_OF_DATE_MESSAGE =
  "The database is from an older version of Marginalia. Stop the app, run `npm run db:push`, and start it again.";

export function isSchemaOutOfDate(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "P2021" || code === "P2022") return true;
  return (
    e instanceof Error &&
    /no such (table|column)|does not exist in the current database/i.test(e.message)
  );
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Best-effort message from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}
