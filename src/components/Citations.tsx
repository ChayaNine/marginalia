"use client";

// Citation list with verification status and an expandable view of the source
// passage. Works for both ad-hoc answers (which carry their retrieved sources) and
// persisted answers (which carry citation rows).

import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CitationDTO } from "@/lib/dto";
import { displayHeading, fileHref, formatPages, lastHeading, passageHref } from "@/lib/locate";
import type { Confidence } from "@/lib/status";
import { Badge, type Tone, cn } from "./ui";

export type CitationView = Pick<
  CitationDTO,
  | "chunkId"
  | "chunkIndex"
  | "documentId"
  | "documentTitle"
  | "heading"
  | "pageStart"
  | "pageEnd"
  | "quote"
  | "verified"
> & {
  /** 1-based source number, matching [n] markers in the answer. */
  source?: number;
  /** Full passage text, when available (ad-hoc answers). */
  passage?: string;
  /** Relevance of the passage to the question (0–1), when available. */
  score?: number;
};

/** "Title · C. Sensor Calibration · §15 · p. 4 ↗" */
export function SourceLocation({
  documentId,
  documentTitle,
  chunkIndex,
  heading,
  pageStart,
  pageEnd,
}: Pick<
  CitationView,
  "documentId" | "documentTitle" | "chunkIndex" | "heading" | "pageStart" | "pageEnd"
>) {
  const section = lastHeading(heading);
  return (
    <>
      <Link
        href={`/documents/${documentId}`}
        title={documentTitle}
        className="inline-block max-w-[16rem] truncate align-bottom font-semibold text-ink transition-colors hover:text-brand sm:max-w-[22rem]"
      >
        {documentTitle}
      </Link>
      {section && <span className="text-ink-muted">{displayHeading(section)}</span>}
      <Link
        href={passageHref(documentId, chunkIndex)}
        className="text-ink-faint hover:text-brand"
        title="Show this passage in the document"
      >
        §{chunkIndex + 1}
      </Link>
      {pageStart && (
        <a
          href={fileHref(documentId, pageStart)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
          title="Open the original at this page"
        >
          {formatPages(pageStart, pageEnd)}
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </a>
      )}
    </>
  );
}

const confidenceTone: Record<Confidence, Tone> = { high: "ok", medium: "info", low: "warn" };

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge tone={confidenceTone[confidence]} title="The model's own confidence in the answer">
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </Badge>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span
      className="text-xs font-semibold text-ok"
      title="This quote was found verbatim in the source passage"
    >
      ✓ Verified
    </span>
  ) : (
    <span
      className="text-xs font-semibold text-warn"
      title="This quote was NOT found verbatim in the source passage — check it by hand"
    >
      ! Not found in source
    </span>
  );
}

export function CitationList({
  citations,
  compact = false,
}: {
  citations: CitationView[];
  compact?: boolean;
}) {
  if (citations.length === 0) {
    return <p className="text-sm text-ink-faint">No citations.</p>;
  }
  return (
    <ol className={cn("divide-y divide-line", !compact && "rounded-xl border border-line")}>
      {citations.map((c, i) => (
        <CitationItem key={`${c.chunkId}-${i}`} citation={c} compact={compact} />
      ))}
    </ol>
  );
}

function CitationItem({ citation, compact }: { citation: CitationView; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const passageRef = useRef<HTMLDivElement>(null);

  // When the passage opens, scroll its box (not the page) to the highlighted quote,
  // which may sit below the visible part of a long passage.
  useEffect(() => {
    if (!open) return;
    const box = passageRef.current;
    const mark = box?.querySelector("mark");
    if (box && mark) box.scrollTop = Math.max(0, mark.offsetTop - 24);
  }, [open]);
  const number = citation.source;

  return (
    <li className={cn("text-sm", compact ? "py-2.5" : "px-4 py-3.5")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {number !== undefined && <span className="cite-marker !ml-0">{number}</span>}
        <SourceLocation {...citation} />
        <VerifiedBadge verified={citation.verified} />
        {citation.passage && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            {open ? "Hide passage" : "Show passage"}
            <ChevronDown
              aria-hidden="true"
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
        )}
      </div>
      <blockquote
        className={cn(
          "mt-2 border-l-2 border-brand-line pl-3 text-ink-muted",
          compact ? "line-clamp-2 text-[13px]" : "text-[14px] leading-relaxed",
        )}
      >
        “{citation.quote}”
      </blockquote>
      {open && citation.passage && (
        <div
          ref={passageRef}
          className="quiet-scroll relative mt-3 max-h-72 overflow-auto rounded-xl bg-muted p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-ink"
        >
          {highlight(citation.passage, citation.quote)}
        </div>
      )}
    </li>
  );
}

/** Wraps the first occurrence of `quote` inside `passage` in a <mark>. */
function highlight(passage: string, quote: string) {
  const idx = passage.toLowerCase().indexOf(quote.toLowerCase());
  if (idx === -1) return passage;
  return (
    <>
      {passage.slice(0, idx)}
      <mark className="rounded bg-yellow-100 px-0.5 text-ink">
        {passage.slice(idx, idx + quote.length)}
      </mark>
      {passage.slice(idx + quote.length)}
    </>
  );
}
