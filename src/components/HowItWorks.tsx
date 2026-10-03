// "How it works in 3 simple steps" — a small explainer for first-time visitors.
// The illustrations are plain HTML and CSS (no images), so they stay crisp,
// tiny and on-brand.

import { ArrowRight, CloudUpload, FileText, MousePointer2 } from "lucide-react";
import type { ReactNode } from "react";
import { LinkButton } from "./ui";

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-brand-soft via-white to-info-soft ring-1 ring-line">
      {children}
    </div>
  );
}

function Pointer({ className }: { className: string }) {
  return (
    <MousePointer2
      aria-hidden="true"
      className={`absolute h-5 w-5 fill-ink text-white drop-shadow ${className}`}
      strokeWidth={1.5}
    />
  );
}

function UploadIllustration() {
  return (
    <Stage>
      <div className="flex items-center gap-3">
        <div className="flex h-24 w-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-line bg-white/80 text-center">
          <CloudUpload aria-hidden="true" className="h-6 w-6 text-brand" strokeWidth={1.75} />
          <span className="mt-1 text-[11px] leading-tight font-medium text-brand">
            Drag &amp; drop
            <br />
            your files
          </span>
        </div>
        <div className="relative flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-soft ring-1 ring-line">
          <FileText aria-hidden="true" className="h-5 w-5 text-ink-muted" strokeWidth={1.5} />
          <span className="rounded-full bg-brand-gradient px-2.5 py-0.5 text-[11px] font-semibold text-white">
            handbook.pdf
          </span>
          <Pointer className="-right-2 -bottom-3" />
        </div>
      </div>
    </Stage>
  );
}

function AskIllustration() {
  return (
    <Stage>
      <div className="w-60 space-y-2">
        <div className="flex items-center justify-between rounded-full bg-white py-1 pr-1 pl-3.5 shadow-soft ring-1 ring-line">
          <span className="text-xs text-ink">When are quiet hours?</span>
          <span className="rounded-full bg-brand-gradient px-3 py-1 text-[11px] font-semibold text-white">
            Ask
          </span>
        </div>
        <div className="rounded-xl bg-white px-3.5 py-2.5 text-left shadow-soft ring-1 ring-line">
          <p className="text-[11px] leading-snug text-ink">
            Quiet hours run from 11 pm to 7 am on weekdays.
            <span className="cite-marker">3</span>
          </p>
          <p className="mt-1.5 text-[10px] font-semibold text-ok">✓ quote verified · §3</p>
        </div>
      </div>
    </Stage>
  );
}

function ReviewIllustration() {
  return (
    <Stage>
      <div className="w-60 rounded-xl bg-white px-3.5 py-3 text-left shadow-soft ring-1 ring-line">
        <p className="text-[11px] font-semibold text-ink">Are pets allowed?</p>
        <p className="mt-1 text-[10px] leading-snug text-ink-muted">
          No pets, except one small aquarium.<span className="cite-marker">2</span>
        </p>
        <div className="relative mt-2.5 flex items-center gap-1.5">
          <span className="rounded-full bg-ink px-2.5 py-1 text-[10px] font-semibold text-white">
            Approve
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-medium text-ink-muted ring-1 ring-line">
            Edit
          </span>
          <span className="ml-auto rounded-full bg-ok-soft px-2 py-1 text-[10px] font-semibold text-ok">
            Export CSV
          </span>
          <Pointer className="top-3 left-10" />
        </div>
      </div>
    </Stage>
  );
}

const steps = [
  {
    title: "1. Upload your documents",
    body: "Drop in PDFs, Word files, Markdown or text. Each one is split into passages and indexed.",
    art: <UploadIllustration />,
  },
  {
    title: "2. Ask or import questions",
    body: "Ask one question, or import a CSV and draft cited answers for every row at once.",
    art: <AskIllustration />,
  },
  {
    title: "3. Review and export",
    body: "Approve, edit or reject each draft, then download the approved answers with their sources.",
    art: <ReviewIllustration />,
  },
];

export function HowItWorks() {
  return (
    <section className="rounded-[2rem] border border-line bg-muted/50 px-6 py-14 sm:px-12">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-[2.1rem]">
          From documents to approved answers
        </h2>
        <p className="mt-2 text-sm text-ink-muted">in 3 simple steps</p>
        <LinkButton href="/ask" variant="primary" size="lg" className="mt-8">
          Ask a question <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </LinkButton>
      </div>
      <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((s) => (
          <li key={s.title} className="text-center">
            {s.art}
            <h3 className="mt-6 text-lg font-bold tracking-[-0.01em] text-ink">{s.title}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-ink-muted">
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
