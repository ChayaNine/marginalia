// The OpenAI provider against a fake SDK client: verifies request shape, response
// parsing, retry behaviour and error mapping. Nothing here touches the network.

import OpenAI, { APIConnectionError, APIError } from "openai";
import { describe, expect, it, vi } from "vitest";
import { getProvider, providerLabel, resetProviderCache } from "@/lib/ai";
import { MOCK_EMBEDDING_MODEL } from "@/lib/ai/mock";
import { createOpenAIProvider, parseJsonReply, withRetry } from "@/lib/ai/openai";
import { resetEnvCache } from "@/lib/env";
import { AIProviderError } from "@/lib/errors";

type EmbeddingsCreate = (params: { model: string; input: string[] }) => Promise<unknown>;
type ChatCreate = (params: Record<string, unknown>) => Promise<unknown>;

function fakeClient(opts: { embeddings?: EmbeddingsCreate; chat?: ChatCreate }): OpenAI {
  return {
    embeddings: { create: opts.embeddings ?? vi.fn() },
    chat: { completions: { create: opts.chat ?? vi.fn() } },
  } as unknown as OpenAI;
}

function apiError(status: number, message = "boom", code?: string): APIError {
  // The SDK reads `code` off the object passed as the second argument.
  return new APIError(status, { message, code, type: "error" }, message, new Headers()) as APIError;
}

const noSleep = async () => {};

describe("embed", () => {
  it("batches inputs, preserves order and returns Float32Arrays", async () => {
    const calls: string[][] = [];
    const client = fakeClient({
      embeddings: async ({ input }) => {
        calls.push(input);
        // Return in reverse order with explicit indexes, to prove we sort by index.
        return {
          data: input.map((_, i) => ({ index: i, embedding: [i, i * 2] })).reverse(),
        };
      },
    });
    const provider = createOpenAIProvider({
      apiKey: "k",
      chatModel: "c",
      embeddingModel: "e",
      embeddingBatchSize: 2,
      client,
    });

    const vectors = await provider.embed(["a", "b", "c"]);
    expect(calls).toEqual([["a", "b"], ["c"]]);
    expect(vectors.map((v) => Array.from(v))).toEqual([
      [0, 0],
      [1, 2],
      [0, 0],
    ]);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it("fails loudly when the API returns the wrong number of vectors", async () => {
    const client = fakeClient({ embeddings: async () => ({ data: [] }) });
    const provider = createOpenAIProvider({
      apiKey: "k",
      chatModel: "c",
      embeddingModel: "e",
      client,
    });
    await expect(provider.embed(["a"])).rejects.toThrow(/0 vectors for 1 inputs/);
  });
});

describe("generate", () => {
  const goodJson = {
    answer: "Quiet hours start at 11 pm [1].",
    citations: [{ source: 1, quote: "Quiet hours start at 11 pm" }],
    confidence: "high",
    insufficient: false,
  };

  it("sends structured-output settings and parses the JSON reply", async () => {
    let params: Record<string, unknown> | undefined;
    const client = fakeClient({
      chat: async (p) => {
        params = p;
        return {
          model: "gpt-4o-mini-2024-07-18",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(goodJson) } }],
        };
      },
    });
    const provider = createOpenAIProvider({
      apiKey: "k",
      chatModel: "gpt-4o-mini",
      embeddingModel: "e",
      client,
    });

    const result = await provider.generate({
      question: "When do quiet hours start?",
      sources: [
        {
          index: 1,
          documentTitle: "Handbook",
          chunkIndex: 0,
          content: "Quiet hours start at 11 pm.",
        },
      ],
    });

    expect(result).toEqual({ ...goodJson, model: "gpt-4o-mini-2024-07-18" });
    expect(params?.model).toBe("gpt-4o-mini");
    expect(params?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    const messages = params?.messages as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain('[1] "Handbook"\nQuiet hours start at 11 pm.');
    expect(messages[1].content).toContain("QUESTION: When do quiet hours start?");
  });

  it("rejects malformed or off-schema JSON with a provider error", async () => {
    const bad = fakeClient({
      chat: async () => ({ choices: [{ message: { content: "not json" } }] }),
    });
    await expect(
      createOpenAIProvider({
        apiKey: "k",
        chatModel: "c",
        embeddingModel: "e",
        client: bad,
      }).generate({ question: "q", sources: [] }),
    ).rejects.toThrow(/malformed JSON/);

    const offSchema = fakeClient({
      chat: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 1 }) } }] }),
    });
    await expect(
      createOpenAIProvider({
        apiKey: "k",
        chatModel: "c",
        embeddingModel: "e",
        client: offSchema,
      }).generate({ question: "q", sources: [] }),
    ).rejects.toThrow(/expected shape/);
  });

  it("surfaces refusals and truncation", async () => {
    const refused = fakeClient({
      chat: async () => ({ choices: [{ message: { refusal: "no" } }] }),
    });
    await expect(
      createOpenAIProvider({
        apiKey: "k",
        chatModel: "c",
        embeddingModel: "e",
        client: refused,
      }).generate({ question: "q", sources: [] }),
    ).rejects.toThrow(/refused/);

    const truncated = fakeClient({
      chat: async () => ({ choices: [{ finish_reason: "length", message: { content: "{" } }] }),
    });
    await expect(
      createOpenAIProvider({
        apiKey: "k",
        chatModel: "c",
        embeddingModel: "e",
        client: truncated,
      }).generate({ question: "q", sources: [] }),
    ).rejects.toThrow(/cut off/);
  });
});

describe("withRetry", () => {
  it("retries transient failures (429, 5xx, network) and then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts === 1) throw apiError(429, "slow down");
        if (attempts === 2) throw apiError(503, "unavailable");
        if (attempts === 3) throw new APIConnectionError({ message: "socket hang up" });
        return "ok";
      },
      { attempts: 4, sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(4);
  });

  it("gives up after the configured attempts and wraps the error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw apiError(500, "down");
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(AIProviderError);
    expect(attempts).toBe(3);
  });

  it("does not retry auth or quota errors, and explains them", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw apiError(401, "bad key");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/rejected the API key/);
    expect(attempts).toBe(1);

    await expect(
      withRetry(
        async () => {
          throw apiError(429, "quota", "insufficient_quota");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/out of credit/);
  });

  it("backs off exponentially", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw apiError(500);
        return 1;
      },
      { attempts: 3, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    expect(delays).toEqual([100, 200]);
  });
});

describe("OpenAI-compatible servers", () => {
  const sources = [
    { index: 1, documentTitle: "Handbook", chunkIndex: 0, content: "Quiet hours start at 11 pm." },
  ];
  const reply = (content: string) => ({
    model: "local",
    choices: [{ finish_reason: "stop", message: { content } }],
  });

  it("falls back from json_schema to json_object to plain JSON, and remembers what worked", async () => {
    const formats: string[] = [];
    const systemPrompts: string[] = [];
    const client = fakeClient({
      chat: async (p) => {
        const format = (p.response_format as { type?: string } | undefined)?.type ?? "none";
        formats.push(format);
        systemPrompts.push((p.messages as { content: string }[])[0].content);
        if (format !== "none") throw apiError(400, `response_format ${format} is not supported`);
        // Typical small-model output: prose, a fence, loose types.
        return reply(
          'Here you go:\n```json\n{"answer": "At 11 pm [1].", "citations": [{"source": "1", "quote": "Quiet hours start at 11 pm"}], "confidence": "High", "insufficient": "false"}\n```',
        );
      },
    });
    const provider = createOpenAIProvider({
      apiKey: "x",
      chatModel: "llama",
      embeddingModel: "e",
      client,
    });

    const first = await provider.generate({ question: "When?", sources });
    expect(formats).toEqual(["json_schema", "json_object", "none"]);
    expect(first).toEqual({
      answer: "At 11 pm [1].",
      citations: [{ source: 1, quote: "Quiet hours start at 11 pm" }],
      confidence: "high",
      insufficient: false,
      model: "local",
    });
    // Without structured outputs, the JSON shape is spelled out in the prompt.
    expect(systemPrompts[2]).toMatch(/Respond with a single JSON object/);

    formats.length = 0;
    await provider.generate({ question: "When?", sources });
    expect(formats).toEqual(["none"]);
  });

  it("does not mistake other 400s for an unsupported format", async () => {
    const client = fakeClient({
      chat: async () => Promise.reject(apiError(400, "context length exceeded")),
    });
    const provider = createOpenAIProvider({
      apiKey: "x",
      chatModel: "m",
      embeddingModel: "e",
      client,
    });
    await expect(provider.generate({ question: "q", sources })).rejects.toThrow(
      /context length exceeded/,
    );
  });

  it("uses the overview instructions for overview questions", async () => {
    let system = "";
    const client = fakeClient({
      chat: async (p) => {
        system = (p.messages as { content: string }[])[0].content;
        return reply(
          JSON.stringify({ answer: "x", citations: [], confidence: "low", insufficient: false }),
        );
      },
    });
    const provider = createOpenAIProvider({
      apiKey: "x",
      chatModel: "m",
      embeddingModel: "e",
      client,
    });
    await provider.generate({ question: "Summarise", sources, mode: "overview" });
    expect(system).toMatch(/The user wants an overview/);
  });

  it("parses JSON wrapped in prose or code fences", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure!\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonReply('The answer is {"a":3} as requested.')).toEqual({ a: 3 });
    expect(parseJsonReply("no json here")).toBeUndefined();
  });
});

describe("getProvider", () => {
  const original = { ...process.env };
  const configure = (env: Record<string, string>) => {
    process.env = {
      ...original,
      AI_PROVIDER: "",
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      EMBEDDING_PROVIDER: "",
      ...env,
    };
    resetEnvCache();
    resetProviderCache();
  };
  const restore = () => {
    process.env = { ...original };
    resetEnvCache();
    resetProviderCache();
  };

  it("labels a compatible server by its host", () => {
    try {
      configure({ OPENAI_BASE_URL: "http://localhost:11434/v1", OPENAI_CHAT_MODEL: "llama3.1" });
      expect(getProvider().name).toBe("openai");
      expect(providerLabel()).toBe("localhost:11434 · llama3.1");
      configure({ OPENAI_API_KEY: "sk-x" });
      expect(providerLabel()).toBe("OpenAI · gpt-4o-mini");
      configure({});
      expect(providerLabel()).toBe("Demo mode");
    } finally {
      restore();
    }
  });

  it("can keep search offline while a real model writes answers (EMBEDDING_PROVIDER=local)", async () => {
    try {
      configure({
        OPENAI_API_KEY: "sk-x",
        OPENAI_BASE_URL: "https://api.groq.com/openai/v1",
        EMBEDDING_PROVIDER: "local",
      });
      const provider = getProvider();
      expect(provider.name).toBe("openai");
      expect(provider.embeddingModel).toBe(MOCK_EMBEDDING_MODEL);
      const [vector] = await provider.embed(["no network needed"]); // would throw if it called the API
      expect(vector.length).toBe(512);
    } finally {
      restore();
    }
  });
});
