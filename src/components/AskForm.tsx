"use client";

// Ad-hoc question form. Posts to /api/ask and renders the answer, its citations
// and every passage the model was shown, so you can see *why* it said what it said.

import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { messageOf, postJson } from "@/lib/api-client";
import { formatMs } from "@/lib/format";
import type { AnswerResult } from "@/lib/rag/answer";
import { AnswerText } from "./AnswerText";
import { CitationList, ConfidenceBadge, SourceLocation, type CitationView } from "./Citations";
import { Badge, Button, ErrorBox, LinkButton, Notice, cn } from "./ui";

export type AskDocument = {
  id: string;
  title: string;
  /** A few section names, for suggested questions. */
  topics: string[];
};

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "max-w-64 truncate rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-ink text-white"
          : "bg-surface text-ink-muted ring-1 ring-inset ring-line hover:text-ink hover:ring-line-strong",
      )}
    >
      {children}
    </button>
  );
}

function suggestionsFor(documents: AskDocument[], selected: Set<string>): string[] {
  const inScope = selected.size > 0 ? documents.filter((d) => selected.has(d.id)) : documents;
  const one = inScope.length === 1;
  const topics = (inScope[0]?.topics ?? []).slice(0, 2);
  return [
    one ? "Summarise this document" : "What are these documents about?",
    "What are the key findings?",
    ...topics.map((t) => `What does it say about ${t}?`),
  ];
}

export function AskForm({
  documents,
  initialSelected = [],
  demo = false,
}: {
  documents: AskDocument[];
  initialSelected?: string[];
  demo?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);

  const filtering = selected.size > 0;
  const noDocuments = documents.length === 0;
  const suggestions = useMemo(() => suggestionsFor(documents, selected), [documents, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { result } = await postJson<{ result: AnswerResult }>("/api/ask", {
        question: text,
        documentIds: filtering ? [...selected] : undefined,
      });
      setResult(result);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    void ask(question);
  }

  const citations: CitationView[] =
    result?.citations.map((c) => ({
      ...c,
      passage: result.sources.find((s) => s.chunkId === c.chunkId)?.content,
    })) ?? [];
  const overview = result?.mode === "overview";

  return (
    <div className="mx-auto max-w-3xl">
      {noDocuments && (
        <Notice tone="neutral" className="mb-6">
          There are no searchable documents yet.{" "}
          <LinkButton href="/#upload" variant="dark" size="sm" className="ml-1">
            Upload one <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </LinkButton>
        </Notice>
      )}

      <form
        onSubmit={submit}
        className="rounded-3xl border border-line/70 bg-surface p-2 shadow-float transition focus-within:ring-4 focus-within:ring-brand/10"
      >
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <div className="flex gap-3 px-4 pt-3">
          <Search aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-ink-faint" />
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            rows={3}
            placeholder="Ask a question, or ask for a summary…"
            className="w-full resize-none bg-transparent text-[17px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
            disabled={noDocuments}
          />
        </div>
        <div className="flex items-center justify-end gap-3 px-2 pb-1">
          <span className="hidden text-xs text-ink-faint sm:inline">⌘ / Ctrl + Enter</span>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={busy}
            disabled={noDocuments || question.trim().length === 0}
          >
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </div>
      </form>

      {!noDocuments && (
        <div className="mt-6 space-y-3 text-center">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-[13px] text-ink-faint">Search in</span>
            <Chip active={!filtering} onClick={() => setSelected(new Set())}>
              All documents
            </Chip>
            {documents.map((d) => (
              <Chip
                key={d.id}
                active={selected.has(d.id)}
                onClick={() => toggle(d.id)}
                title={d.title}
              >
                {d.title}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-[13px] text-ink-faint">Try</span>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  void ask(s);
                }}
                disabled={busy}
                className="max-w-full truncate rounded-full bg-muted px-3.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <ErrorBox className="mt-8">{error}</ErrorBox>}

      {busy && !result && (
        <div className="mt-10 animate-pulse space-y-3 rounded-2xl border border-line p-8">
          <div className="h-4 w-1/3 rounded-full bg-muted" />
          <div className="h-4 w-full rounded-full bg-muted" />
          <div className="h-4 w-5/6 rounded-full bg-muted" />
        </div>
      )}

      {result && (
        <div className={cn("mt-10 space-y-10 transition-opacity", busy && "opacity-50")}>
          <article className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">
                {overview ? "Overview" : "Answer"}
              </span>
              {!result.insufficient && <ConfidenceBadge confidence={result.confidence} />}
              <span className="ml-auto text-xs text-ink-faint">
                {result.model}
                {result.timings.embedMs > 0 && ` · embed ${formatMs(result.timings.embedMs)}`} ·
                retrieve {formatMs(result.timings.retrieveMs)} · generate{" "}
                {formatMs(result.timings.generateMs)}
              </span>
            </div>

            {result.notice && (
              <Notice tone="neutral" className="mb-5">
                {result.notice}
              </Notice>
            )}

            {result.insufficient && (
              <Notice tone="warn" className="mb-5">
                {result.sources.length === 0
                  ? "Nothing relevant was found, so no answer was generated."
                  : "The retrieved passages don't answer this directly. Check the passages below — the answer may use different words than your question."}
              </Notice>
            )}

            <AnswerText
              text={result.answer}
              className="text-[17px] leading-8 whitespace-pre-wrap text-ink"
            />

            {demo && !result.insufficient && (
              <p className="mt-5 text-xs leading-relaxed text-ink-faint">
                Demo mode answers by quoting the best-matching sentences. Connect a model (OpenAI,
                or a free local one with Ollama — see the README) for written explanations.
              </p>
            )}

            <h3 className="mt-8 mb-3 text-sm font-semibold text-ink">Citations</h3>
            <CitationList citations={citations} />
          </article>

          {result.sources.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-ink">
                {overview ? "Passages used" : "Retrieved passages"}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {overview
                  ? "The document's opening, introduction, conclusion and most representative sections, in reading order."
                  : "What the model was shown, best match first. Relevance combines meaning and exact keywords."}
              </p>
              <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {result.sources.map((s, i) => {
                  const cited = result.citations.some((c) => c.chunkId === s.chunkId);
                  return (
                    <li key={s.chunkId} className="px-5 py-4 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="cite-marker !ml-0">{i + 1}</span>
                        <SourceLocation {...s} />
                        {cited && <Badge tone="accent">Cited</Badge>}
                        {!overview && (
                          <span
                            className="ml-auto flex items-center gap-2"
                            title={`meaning ${s.vectorScore.toFixed(2)} · keywords ${Math.round(s.keywordScore * 100)}%`}
                          >
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-brand-gradient"
                                style={{ width: `${Math.max(3, Math.min(100, s.score * 100))}%` }}
                              />
                            </span>
                            <span className="w-9 text-right text-xs tabular-nums text-ink-faint">
                              {Math.round(s.score * 100)}%
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">
                        {s.content}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
