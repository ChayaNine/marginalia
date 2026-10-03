"use client";

// Create a question set from a CSV. The file is parsed in the browser (same parser
// the server uses) so the user can pick the right column and see a preview before
// anything is uploaded.

import { FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { messageOf, postJson } from "@/lib/api-client";
import { extractQuestions, guessQuestionColumn, looksLikeHeader, parseCsv } from "@/lib/csv";
import type { QuestionSetDTO } from "@/lib/dto";
import { MAX_QUESTIONS_PER_SET } from "@/lib/limits";
import { Button, ErrorBox, cn } from "./ui";

const SAMPLE = `question
What are the quiet hours?
Are pets allowed in the building?
How do I submit a maintenance request?`;

type Mode = "file" | "paste";

const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:ring-4 focus:ring-brand/10 focus:outline-none";

export function QuestionSetForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hasHeader, setHasHeader] = useState<boolean | null>(null); // null = auto
  const [column, setColumn] = useState<number | null>(null); // null = auto
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (csv.trim() ? parseCsv(csv) : null), [csv]);
  const firstRow = parsed?.rows[0] ?? [];
  const autoHeader = looksLikeHeader(firstRow);
  const effectiveHeader = hasHeader ?? autoHeader;
  const autoColumn = effectiveHeader ? Math.max(0, guessQuestionColumn(firstRow)) : 0;
  const effectiveColumn = column ?? autoColumn;
  const columnCount = firstRow.length;

  const preview = useMemo(() => {
    if (!parsed) return null;
    return extractQuestions(parsed.rows, { column: effectiveColumn, hasHeader: effectiveHeader });
  }, [parsed, effectiveColumn, effectiveHeader]);

  function load(text: string) {
    setCsv(text);
    setHasHeader(null);
    setColumn(null);
    setError(null);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    load(await file.text());
    setFileName(file.name);
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void onFile(event.dataTransfer.files[0] ?? null);
  }

  function loadSample() {
    setMode("paste");
    setFileName(null);
    load(SAMPLE);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { questionSet } = await postJson<{ questionSet: QuestionSetDTO }>(
        "/api/question-sets",
        {
          name,
          csv,
          column: effectiveColumn,
          hasHeader: effectiveHeader,
        },
      );
      router.push(`/question-sets/${questionSet.id}`);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  const count = preview?.questions.length ?? 0;
  const tooMany = count > MAX_QUESTIONS_PER_SET;
  const canSubmit = name.trim().length > 0 && count > 0 && !tooMany && !busy;

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-3xl border border-line/70 bg-surface p-5 shadow-float sm:p-8"
    >
      <div>
        <label htmlFor="set-name" className="block text-sm font-semibold text-ink">
          Name
        </label>
        <input
          id="set-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Resident FAQ — autumn intake"
          className={cn(inputClass, "mt-2 h-11")}
          maxLength={120}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink">Questions</span>
          <div className="inline-flex rounded-full bg-muted p-1" role="tablist">
            {(
              [
                ["file", "Upload CSV"],
                ["paste", "Paste text"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-[13px] font-medium transition",
                  mode === key
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "file" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "mt-3 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors",
              dragging ? "border-brand bg-brand-soft" : "border-brand-line bg-muted/60",
            )}
          >
            <FileSpreadsheet
              aria-hidden="true"
              className="h-8 w-8 text-ink-faint"
              strokeWidth={1.3}
            />
            <p className="mt-3 text-sm text-ink-faint">
              {fileName ? (
                <span className="font-semibold text-ink">{fileName}</span>
              ) : (
                "Drag & drop a CSV, or choose one"
              )}
            </p>
            <Button
              variant="primary"
              onClick={() => fileRef.current?.click()}
              className="mt-4 rounded-xl"
            >
              {fileName ? "Choose another CSV" : "Choose CSV"}
            </Button>
            <input
              ref={fileRef}
              id="set-file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              aria-label="Choose a CSV file"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <textarea
            id="set-csv"
            aria-label="Questions, one per row"
            value={csv}
            onChange={(e) => {
              load(e.target.value);
              setFileName(null);
            }}
            rows={7}
            placeholder={"question\nWhat are the quiet hours?\n…"}
            className={cn(inputClass, "mt-3 py-3 font-mono text-[13px] leading-relaxed")}
          />
        )}

        <p className="mt-2.5 text-xs text-ink-faint">
          One question per row · comma, semicolon and tab are detected automatically · No file
          handy?{" "}
          <button
            type="button"
            onClick={loadSample}
            className="font-semibold text-brand hover:underline"
          >
            Use sample
          </button>
        </p>
      </div>

      {parsed && preview && (
        <div className="rounded-2xl bg-muted p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="text-sm text-ink-muted">
              <strong className="text-ink">{count}</strong> question{count === 1 ? "" : "s"}{" "}
              detected
              {tooMany && <span className="ml-2 text-bad">(limit {MAX_QUESTIONS_PER_SET})</span>}
            </p>
            <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                checked={effectiveHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              First row is a header
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              Column
              <select
                value={effectiveColumn}
                onChange={(e) => setColumn(Number(e.target.value))}
                className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink"
              >
                {Array.from({ length: Math.max(1, columnCount) }, (_, i) => (
                  <option key={i} value={i}>
                    {effectiveHeader && firstRow[i]?.trim()
                      ? firstRow[i].trim()
                      : `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {count > 0 && (
            <ol className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-ink-muted">
              {preview.questions.slice(0, 3).map((q, i) => (
                <li key={i} className="truncate">
                  <span className="mr-2 text-ink-faint tabular-nums">{i + 1}.</span>
                  {q}
                </li>
              ))}
              {count > 3 && <li className="text-ink-faint">… and {count - 3} more</li>}
            </ol>
          )}
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!canSubmit}
        loading={busy}
        className="w-full"
      >
        Create question set
      </Button>
    </form>
  );
}
