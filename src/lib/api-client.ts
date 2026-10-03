// Browser-side fetch wrapper.
//
// Turns the API's error envelope into a thrown ApiError whose `message` is safe to
// show in the UI, so components can `try { await api(...) } catch (e) { show(e) }`
// without each one re-implementing response parsing.

import type { ApiErrorBody } from "@/lib/http";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server. Is it running?");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope = body as Partial<ApiErrorBody> | null;
    const err = envelope?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "http_error",
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details,
    );
  }

  return body as T;
}

export function postJson<T>(url: string, payload: unknown): Promise<T> {
  return api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function patchJson<T>(url: string, payload: unknown): Promise<T> {
  return api<T>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
