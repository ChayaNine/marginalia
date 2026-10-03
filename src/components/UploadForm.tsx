"use client";

// File upload with drag-and-drop. Talks to POST /api/documents and refreshes the
// server-rendered document list on success.

import { FileText, FileUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { ApiError, api, messageOf } from "@/lib/api-client";
import { SUPPORTED_EXTENSIONS } from "@/lib/file-kinds";
import { formatBytes } from "@/lib/format";
import { Button, ErrorBox, Notice, cn } from "./ui";

type UploadResponse = {
  document: {
    id: string;
    title: string;
    chunkCount: number;
    charCount: number;
    pageCount: number | null;
    reprocessed: boolean;
  };
};

type Outcome = { tone: "ok" | "neutral"; text: string; documentId: string };

export function UploadForm({ maxUploadMb }: { maxUploadMb: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Outcome | null>(null);

  function choose(candidate: File | null) {
    setError(null);
    setSuccess(null);
    setFile(candidate);
    if (!candidate && inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0] ?? null);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { document } = await api<UploadResponse>("/api/documents", {
        method: "POST",
        body: form,
      });
      const size = document.pageCount
        ? `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`
        : `${document.charCount.toLocaleString()} characters`;
      setSuccess({
        tone: "ok",
        documentId: document.id,
        text: `${document.reprocessed ? "Re-processed" : "Ready"}: “${document.title}” — ${document.chunkCount} passage${document.chunkCount === 1 ? "" : "s"} from ${size}.`,
      });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      const existing =
        e instanceof ApiError && e.code === "conflict"
          ? (e.details as { documentId?: string } | undefined)?.documentId
          : undefined;
      if (existing) {
        setSuccess({ tone: "neutral", documentId: existing, text: messageOf(e) });
        setFile(null);
      } else {
        setError(messageOf(e));
      }
      router.refresh(); // a FAILED document row may now exist; show it
    } finally {
      setBusy(false);
    }
  }

  const kinds = SUPPORTED_EXTENSIONS.map((e) => e.slice(1).toUpperCase()).join(", ");

  return (
    <div>
      <div className="rounded-3xl border border-line/70 bg-surface p-4 shadow-float sm:p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-60 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-brand bg-brand-soft" : "border-brand-line bg-muted/60",
          )}
        >
          {file ? (
            <>
              <div className="flex max-w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left ring-1 ring-line">
                <FileText
                  aria-hidden="true"
                  className="h-8 w-8 shrink-0 text-brand"
                  strokeWidth={1.5}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
                  <p className="text-xs text-ink-muted">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  disabled={busy}
                  className="ml-2 rounded-full p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
                  aria-label="Clear selected file"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={upload}
                loading={busy}
                className="mt-6 rounded-xl"
              >
                {busy ? "Extracting, chunking, embedding…" : "Upload & index"}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-4 text-ink-faint" aria-hidden="true">
                <FileText className="h-9 w-9" strokeWidth={1.3} />
                <span className="h-9 w-px bg-line-strong" />
                <FileUp className="h-9 w-9" strokeWidth={1.3} />
              </div>
              <p className="mt-4 text-sm text-ink-faint">
                Drag &amp; drop a document
                <br />
                or choose one from your computer
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => inputRef.current?.click()}
                className="mt-5 min-w-44 rounded-xl"
              >
                Choose file
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED_EXTENSIONS.join(",")}
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            aria-label="Choose a file to upload"
          />
        </div>
        <p className="mt-3 text-center text-xs text-ink-faint">
          {kinds} · up to {maxUploadMb} MB · PDFs need a text layer (no OCR yet)
        </p>
      </div>

      {(error || success) && (
        <div className="mt-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          {success && (
            <Notice tone={success.tone}>
              {success.text}{" "}
              <span className="inline-flex flex-wrap gap-x-3 font-semibold">
                <Link
                  href={`/documents/${success.documentId}`}
                  className="underline underline-offset-2"
                >
                  See its overview
                </Link>
                <Link
                  href={`/ask?doc=${success.documentId}`}
                  className="underline underline-offset-2"
                >
                  Ask about it
                </Link>
              </span>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
