"use client";

// The review workbench for one question set.
//
// State lives here as a plain copy of the QuestionSetDTO the server rendered;
// every API call returns the updated piece (an answer, or the whole set), which we
// splice back in. No global store needed at this size.

import { Check, Download, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { api, messageOf, patchJson, postJson } from "@/lib/api-client";
import type { AnswerDTO, QuestionDTO, QuestionSetDTO } from "@/lib/dto";
import { computeStats } from "@/lib/stats";
import { DRAFT_BATCH_SIZE } from "@/lib/limits";
import type { AnswerStatus } from "@/lib/status";
import type { DraftBatchResult } from "@/lib/drafting";
import { AnswerText } from "./AnswerText";
import { CitationList, ConfidenceBadge } from "./Citations";
import { DeleteButton } from "./DeleteButton";
import { ProgressBar } from "./ProgressBar";
import { formatRelative, pluralize } from "@/lib/format";
import { BackLink, Badge, Button, CheckLabel, ErrorBox, Notice, PageHeader, cn } from "./ui";

type Filter = "all" | "pending" | "drafted" | "approved" | "rejected";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "drafted", label: "Needs review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function bucket(q: QuestionDTO): Exclude<Filter, "all"> {
  if (!q.answer) return "pending";
  if (q.answer.status === "APPROVED") return "approved";
  if (q.answer.status === "REJECTED") return "rejected";
  return "drafted";
}

export function ReviewWorkbench({ initial }: { initial: QuestionSetDTO }) {
  const [set, setSet] = useState<QuestionSetDTO>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<{ running: boolean; failed: number } | null>(null);
  const cancelRef = useRef(false);

  const stats = useMemo(() => computeStats(set.questions), [set.questions]);
  const visible = useMemo(
    () => set.questions.filter((q) => filter === "all" || bucket(q) === filter),
    [set.questions, filter],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: set.questions.length,
      pending: 0,
      drafted: 0,
      approved: 0,
      rejected: 0,
    };
    for (const q of set.questions) c[bucket(q)]++;
    return c;
  }, [set.questions]);

  const replaceAnswer = useCallback((questionId: string, answer: AnswerDTO) => {
    setSet((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === questionId ? { ...q, answer } : q)),
    }));
  }, []);

  async function reloadSet() {
    const { questionSet } = await api<{ questionSet: QuestionSetDTO }>(
      `/api/question-sets/${set.id}`,
    );
    setSet(questionSet);
  }

  async function draftAll() {
    cancelRef.current = false;
    setError(null);
    setDrafting({ running: true, failed: 0 });
    let failed = 0;
    try {
      for (;;) {
        const batch = await postJson<DraftBatchResult>(`/api/question-sets/${set.id}/draft`, {
          limit: DRAFT_BATCH_SIZE,
        });
        failed += batch.failed.length;
        await reloadSet();
        setDrafting({ running: true, failed });
        if (cancelRef.current || batch.remaining === 0 || batch.drafted === 0) {
          if (batch.drafted === 0 && batch.remaining > 0 && batch.failed[0])
            setError(`Drafting stopped: ${batch.failed[0].error}`);
          break;
        }
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setDrafting({ running: false, failed });
    }
  }

  async function draftOne(questionId: string) {
    setError(null);
    try {
      const { answer } = await postJson<{ answer: AnswerDTO }>(
        `/api/questions/${questionId}/draft`,
        {},
      );
      replaceAnswer(questionId, answer);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function review(
    questionId: string,
    answerId: string,
    patch: { status?: AnswerStatus; finalText?: string | null },
  ) {
    setError(null);
    try {
      const { answer } = await patchJson<{ answer: AnswerDTO }>(`/api/answers/${answerId}`, patch);
      replaceAnswer(questionId, answer);
    } catch (e) {
      setError(messageOf(e));
      throw e;
    }
  }

  const draftingRunning = drafting?.running ?? false;

  return (
    <div className="pt-6">
      <BackLink href="/question-sets">All question sets</BackLink>

      <div className="mt-6">
        <PageHeader
          eyebrow="Question set"
          title={set.name}
          description={
            <>
              {pluralize(stats.total, "question")} · created {formatRelative(set.createdAt)}
            </>
          }
          actions={
            <>
              {stats.pending > 0 && !draftingRunning && (
                <Button variant="primary" onClick={draftAll}>
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  Draft {stats.pending === stats.total ? "all" : `${stats.pending} remaining`}
                </Button>
              )}
              {draftingRunning && (
                <Button variant="secondary" loading onClick={() => (cancelRef.current = true)}>
                  Drafting {stats.total - stats.pending} / {stats.total} · click to stop
                </Button>
              )}
              <a
                href={`/api/question-sets/${set.id}/export?scope=approved`}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-5 text-sm font-semibold text-ink ring-1 ring-line-strong ring-inset transition hover:bg-muted",
                  stats.approved === 0 && "pointer-events-none opacity-50",
                )}
                aria-disabled={stats.approved === 0}
                title={
                  stats.approved === 0
                    ? "Approve at least one answer first"
                    : "Download approved answers as CSV"
                }
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Export approved ({stats.approved})
              </a>
              <a
                href={`/api/question-sets/${set.id}/export?scope=all`}
                className="inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-ink-muted transition hover:bg-muted hover:text-ink"
              >
                Export all
              </a>
              <DeleteButton
                url={`/api/question-sets/${set.id}`}
                confirmText={`Delete "${set.name}" and all its answers?`}
                redirectTo="/question-sets"
                size="md"
              />
            </>
          }
        />
      </div>

      <div className="rounded-2xl border border-line px-6 py-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-ink">
            {stats.approved} of {stats.total} approved
          </p>
          <p className="text-xs text-ink-faint">
            {stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0}% ready to
            export
          </p>
        </div>
        <ProgressBar stats={stats} />
      </div>

      {(error || (drafting && !drafting.running && drafting.failed > 0)) && (
        <div className="mt-4 space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          {drafting && !drafting.running && drafting.failed > 0 && (
            <Notice tone="warn">
              {drafting.failed} question{drafting.failed === 1 ? "" : "s"} could not be drafted.
              They are still pending; try &ldquo;Draft&rdquo; again or draft them individually.
            </Notice>
          )}
        </div>
      )}

      <div className="mt-10 mb-4 flex justify-center sm:justify-start">
        <div
          className="inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-1"
          role="tablist"
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-medium whitespace-nowrap transition",
                filter === f.key
                  ? "bg-surface text-ink shadow-card"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {f.label} <span className="ml-0.5 text-ink-faint tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong py-12 text-center text-sm text-ink-muted">
          Nothing in this view.
        </p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {visible.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              onDraft={() => draftOne(q.id)}
              onReview={(answerId, patch) => review(q.id, answerId, patch)}
              disabled={draftingRunning}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------- One question ---------- */

type RowProps = {
  question: QuestionDTO;
  onDraft: () => Promise<void>;
  onReview: (
    answerId: string,
    patch: { status?: AnswerStatus; finalText?: string | null },
  ) => Promise<void>;
  disabled: boolean;
};

function StatusLabel({ status }: { status: AnswerStatus | undefined }) {
  if (status === "APPROVED") return <CheckLabel className="text-sm">Approved</CheckLabel>;
  if (status === "REJECTED")
    return <span className="text-sm font-semibold text-bad">✕ Rejected</span>;
  if (status === "DRAFT") return <Badge tone="accent">Draft</Badge>;
  return <Badge>Pending</Badge>;
}

function QuestionRow({ question, onDraft, onReview, disabled }: RowProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const answer = question.answer;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } catch {
      /* the workbench shows the error */
    } finally {
      setBusy(null);
    }
  }

  function startEditing() {
    if (!answer) return;
    setDraftText(answer.text);
    setEditing(true);
  }

  const status = answer?.status;
  const unverified = answer?.citations.filter((c) => !c.verified).length ?? 0;

  return (
    <li
      className={cn(
        "grid gap-x-4 px-5 py-6 sm:grid-cols-[2.5rem_1fr] sm:px-6",
        status === "APPROVED" && "bg-ok-soft/40",
      )}
    >
      <span className="hidden pt-0.5 text-sm font-semibold text-ink-faint tabular-nums sm:block">
        {String(question.index + 1).padStart(2, "0")}
      </span>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[15px] leading-snug font-semibold text-ink">
            <span className="mr-1.5 text-ink-faint sm:hidden">{question.index + 1}.</span>
            {question.text}
          </h3>
          <span className="shrink-0">
            <StatusLabel status={status} />
          </span>
        </div>

        {!answer ? (
          <div className="mt-3 flex items-center gap-3 text-sm text-ink-muted">
            <span>No draft yet.</span>
            <Button
              size="sm"
              onClick={() => run("draft", onDraft)}
              loading={busy === "draft"}
              disabled={disabled}
            >
              Draft this one
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
              <ConfidenceBadge confidence={answer.confidence} />
              {answer.insufficient && <Badge tone="warn">Sources insufficient</Badge>}
              {unverified > 0 && (
                <Badge tone="warn">
                  {unverified} unverified quote{unverified === 1 ? "" : "s"}
                </Badge>
              )}
              {answer.finalText !== null && <Badge tone="info">Edited</Badge>}
              <span className="ml-1">{answer.model}</span>
            </div>

            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={5}
                  aria-label="Edit answer"
                  className="w-full rounded-xl border border-line-strong bg-surface px-3.5 py-3 text-sm leading-relaxed text-ink focus:border-brand focus:ring-4 focus:ring-brand/10 focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="dark"
                    loading={busy === "save"}
                    onClick={() =>
                      run("save", async () => {
                        await onReview(answer.id, { finalText: draftText });
                        setEditing(false);
                      })
                    }
                  >
                    Save edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  {answer.finalText !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === "restore"}
                      onClick={() =>
                        run("restore", async () => {
                          await onReview(answer.id, { finalText: null });
                          setEditing(false);
                        })
                      }
                    >
                      Restore AI draft
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <AnswerText
                text={answer.text}
                className={cn(
                  "text-[15px] leading-7 whitespace-pre-wrap",
                  status === "REJECTED"
                    ? "text-ink-faint line-through decoration-bad/40"
                    : "text-ink-muted",
                )}
              />
            )}

            {answer.citations.length > 0 ? (
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-brand select-none hover:underline [&::-webkit-details-marker]:hidden">
                  <span className="transition-transform group-open:rotate-90" aria-hidden="true">
                    ›
                  </span>
                  {answer.citations.length} citation{answer.citations.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-1 pl-3">
                  <CitationList
                    citations={answer.citations.map((c) => ({ ...c, source: c.order + 1 }))}
                    compact
                  />
                </div>
              </details>
            ) : (
              <p className="text-[13px] text-ink-faint">No citations</p>
            )}

            {!editing && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {status !== "APPROVED" ? (
                  <Button
                    size="sm"
                    variant="dark"
                    loading={busy === "approve"}
                    disabled={disabled}
                    onClick={() =>
                      run("approve", () => onReview(answer.id, { status: "APPROVED" }))
                    }
                  >
                    {busy !== "approve" && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                    Approve
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={busy === "unapprove"}
                    disabled={disabled}
                    onClick={() => run("unapprove", () => onReview(answer.id, { status: "DRAFT" }))}
                  >
                    Un-approve
                  </Button>
                )}
                {status !== "REJECTED" && status !== "APPROVED" && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === "reject"}
                    disabled={disabled}
                    onClick={() => run("reject", () => onReview(answer.id, { status: "REJECTED" }))}
                  >
                    Reject
                  </Button>
                )}
                {status === "REJECTED" && (
                  <Button
                    size="sm"
                    loading={busy === "unreject"}
                    disabled={disabled}
                    onClick={() => run("unreject", () => onReview(answer.id, { status: "DRAFT" }))}
                  >
                    Restore to draft
                  </Button>
                )}
                {status !== "APPROVED" && (
                  <>
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={startEditing}>
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === "regen"}
                      disabled={disabled}
                      onClick={() => run("regen", onDraft)}
                    >
                      {busy !== "regen" && <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
                      Regenerate
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
