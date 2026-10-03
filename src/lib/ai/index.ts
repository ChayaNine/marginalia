// Provider factory.
//
// `getProvider()` is the only place that decides *which* implementation runs. It
// reads the validated env once and caches the result for the process lifetime.

import { getEnv } from "@/lib/env";
import { createMockProvider } from "./mock";
import { createOpenAIProvider } from "./openai";
import type { AIProvider } from "./provider";

let cached: AIProvider | undefined;

export function getProvider(): AIProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.provider === "mock") {
    cached = createMockProvider();
    return cached;
  }

  const remote = createOpenAIProvider({
    // Local OpenAI-compatible servers ignore the key, but the SDK requires one.
    apiKey: env.OPENAI_API_KEY ?? "not-needed",
    baseURL: env.OPENAI_BASE_URL,
    chatModel: env.OPENAI_CHAT_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  });

  if (env.EMBEDDING_PROVIDER === "local") {
    // Real model for answers, offline lexical embeddings for search.
    const local = createMockProvider();
    cached = {
      ...remote,
      embeddingModel: local.embeddingModel,
      relevanceThreshold: local.relevanceThreshold,
      embed: local.embed,
    };
  } else {
    cached = remote;
  }
  return cached;
}

/** Short human description of the running provider, for the UI. */
export function providerLabel(): string {
  const provider = getProvider();
  if (provider.name === "mock") return "Demo mode";
  const base = getEnv().OPENAI_BASE_URL;
  let host = "OpenAI";
  if (base) {
    try {
      host = new URL(base).host;
    } catch {
      host = base;
    }
  }
  return `${host} · ${provider.chatModel}`;
}

/** Test helper. */
export function resetProviderCache(): void {
  cached = undefined;
}

export type { AIProvider } from "./provider";
