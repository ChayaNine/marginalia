import { ZodError, z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";
import { AppError, NotFoundError, isSchemaOutOfDate } from "@/lib/errors";
import { errorResponse, parseJsonBody, withErrorHandling } from "@/lib/http";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
});

describe("getEnv", () => {
  it("falls back to the mock provider when no key is set", () => {
    process.env.OPENAI_API_KEY = "";
    delete process.env.AI_PROVIDER;
    resetEnvCache();
    expect(getEnv().provider).toBe("mock");
  });

  it("uses OpenAI automatically when a key is present", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.AI_PROVIDER;
    resetEnvCache();
    const env = getEnv();
    expect(env.provider).toBe("openai");
    expect(env.OPENAI_CHAT_MODEL).toBe("gpt-4o-mini");
    expect(env.OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  it("lets AI_PROVIDER=mock override a present key", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_PROVIDER = "mock";
    resetEnvCache();
    expect(getEnv().provider).toBe("mock");
  });

  it("refuses AI_PROVIDER=openai with neither a key nor a base URL", () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_BASE_URL = "";
    process.env.AI_PROVIDER = "openai";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/neither OPENAI_API_KEY nor OPENAI_BASE_URL/);
  });

  it("uses an OpenAI-compatible server (e.g. Ollama) when only a base URL is set", () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    delete process.env.AI_PROVIDER;
    resetEnvCache();
    expect(getEnv()).toMatchObject({
      provider: "openai",
      OPENAI_BASE_URL: "http://localhost:11434/v1",
    });
  });

  it("rejects a malformed base URL", () => {
    process.env.OPENAI_BASE_URL = "localhost:11434";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/OPENAI_BASE_URL/);
  });

  it("reports invalid values readably", () => {
    process.env.MAX_UPLOAD_MB = "lots";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/MAX_UPLOAD_MB/);
  });
});

describe("errorResponse", () => {
  it("serialises AppErrors with their status and code", async () => {
    const res = errorResponse(new NotFoundError("Document"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Document not found" },
    });
  });

  it("turns zod errors into 400s with field paths", async () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    const res = errorResponse(result.error as ZodError);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toMatch(/^name:/);
  });

  it("explains an out-of-date database instead of a generic 500", async () => {
    const missingColumn = Object.assign(
      new Error("The column `pipelineVersion` does not exist in the current database."),
      {
        code: "P2022",
      },
    );
    expect(isSchemaOutOfDate(missingColumn)).toBe(true);
    expect(isSchemaOutOfDate(new Error("SqliteError: no such table: DocumentFile"))).toBe(true);
    expect(isSchemaOutOfDate(new Error("something else"))).toBe(false);

    const res = errorResponse(missingColumn);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("schema_out_of_date");
    expect(body.error.message).toMatch(/npm run db:push/);
  });

  it("hides unknown errors behind a generic 500", async () => {
    const res = errorResponse(new Error("secret internal detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

describe("withErrorHandling / parseJsonBody", () => {
  const schema = z.object({ n: z.number() });
  const handler = withErrorHandling(async (request) => {
    const body = await parseJsonBody(request, schema);
    return Response.json({ doubled: body.n * 2 });
  });
  const ctx = { params: Promise.resolve({}) };

  it("passes valid requests through", async () => {
    const res = await handler(
      new Request("http://t/", { method: "POST", body: JSON.stringify({ n: 21 }) }),
      ctx,
    );
    expect(await res.json()).toEqual({ doubled: 42 });
  });

  it("rejects invalid JSON and schema violations with 400", async () => {
    const bad = await handler(new Request("http://t/", { method: "POST", body: "{nope" }), ctx);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/valid JSON/);

    const wrong = await handler(
      new Request("http://t/", { method: "POST", body: JSON.stringify({ n: "x" }) }),
      ctx,
    );
    expect(wrong.status).toBe(400);
  });

  it("converts thrown AppErrors", async () => {
    const throwing = withErrorHandling(async () => {
      throw new AppError("teapot", "I'm a teapot", 418);
    });
    const res = await throwing(new Request("http://t/"), ctx);
    expect(res.status).toBe(418);
  });
});
