// Validated environment.
//
// Read process.env exactly once, through a zod schema, so a typo in .env fails
// loudly at startup with a readable message instead of surfacing later as
// `undefined` somewhere deep in a request.

import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const DEFAULT_DATABASE_URL = "file:./dev.db";

const envSchema = z.object({
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().default(DEFAULT_DATABASE_URL)),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  // Any OpenAI-compatible server: Ollama, LM Studio, Groq, OpenRouter, Gemini…
  OPENAI_BASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^https?:\/\/[^\s/]+/, "must be a full URL such as http://localhost:11434/v1")
      .optional(),
  ),
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["openai", "mock"]).optional()),
  OPENAI_CHAT_MODEL: z.preprocess(emptyToUndefined, z.string().default("gpt-4o-mini")),
  OPENAI_EMBEDDING_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().default("text-embedding-3-small"),
  ),
  // "local" embeds offline (the demo-mode hashing) while a real model writes the
  // answers — for chat-only services without an embeddings endpoint (Groq, OpenRouter).
  EMBEDDING_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["openai", "local"]).optional()),
  MAX_UPLOAD_MB: z.preprocess(emptyToUndefined, z.coerce.number().positive().default(10)),
});

export type ProviderName = "openai" | "mock";

export type Env = z.infer<typeof envSchema> & {
  /**
   * Resolved provider: explicit AI_PROVIDER, else "openai" when a key or a
   * compatible base URL is configured, else "mock" (offline demo mode).
   */
  provider: ProviderName;
};

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${problems}`);
  }

  const data = parsed.data;
  const provider: ProviderName =
    data.AI_PROVIDER ?? (data.OPENAI_API_KEY || data.OPENAI_BASE_URL ? "openai" : "mock");

  // Local servers (Ollama, LM Studio) need no key; api.openai.com does.
  if (provider === "openai" && !data.OPENAI_API_KEY && !data.OPENAI_BASE_URL) {
    throw new Error(
      "AI_PROVIDER is 'openai' but neither OPENAI_API_KEY nor OPENAI_BASE_URL is set.",
    );
  }

  cached = { ...data, provider };
  return cached;
}

/** Test helper: forget the cached env so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
