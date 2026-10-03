// Helpers for route handlers.
//
// Every API response is JSON. Errors always have the same envelope:
//   { "error": { "code": "not_found", "message": "Document not found", "details"?: ... } }
// so the UI can rely on `error.message` being safe to show a person.

import { ZodError, type ZodType } from "zod";
import {
  AppError,
  SCHEMA_OUT_OF_DATE_MESSAGE,
  ValidationError,
  isAppError,
  isSchemaOutOfDate,
} from "@/lib/errors";

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
    return Response.json(body, { status: error.status });
  }

  if (error instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: "validation_error",
        message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
        details: error.issues,
      },
    };
    return Response.json(body, { status: 400 });
  }

  if (isSchemaOutOfDate(error)) {
    const body: ApiErrorBody = {
      error: { code: "schema_out_of_date", message: SCHEMA_OUT_OF_DATE_MESSAGE },
    };
    return Response.json(body, { status: 500 });
  }

  // Unknown → a bug. Log everything, reveal nothing.
  console.error("[api] unhandled error", error);
  const body: ApiErrorBody = {
    error: {
      code: "internal_error",
      message: "Something went wrong on our side. Please try again.",
    },
  };
  return Response.json(body, { status: 500 });
}

/** Route context shape for dynamic segments in Next.js 15 (params is a Promise). */
export type RouteContext<TParams extends Record<string, string | string[] | undefined>> = {
  params: Promise<TParams>;
};

/**
 * Wraps a route handler so thrown errors become JSON responses. `TContext` is the
 * second argument Next.js passes (e.g. `RouteContext<{ id: string }>`); Next.js
 * type-checks that argument at build time, so the default must be a valid context.
 */
export function withErrorHandling<
  TContext extends RouteContext<Record<string, string | string[] | undefined>> = RouteContext<
    Record<string, never>
  >,
>(
  handler: (request: Request, context: TContext) => Promise<Response>,
): (request: Request, context: TContext) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Parses and validates a JSON body; a malformed body is a 400, not a 500.
 * With `{ optional: true }`, an empty body is treated as `{}` (useful for POST
 * endpoints whose every field has a default).
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options: { optional?: boolean } = {},
): Promise<T> {
  const text = await request.text();
  let raw: unknown;
  if (text.trim() === "") {
    if (!options.optional) throw new ValidationError("Request body is required");
    raw = {};
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError("Request body must be valid JSON");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

export function assertAppError(error: unknown): asserts error is AppError {
  if (!isAppError(error)) throw error;
}
