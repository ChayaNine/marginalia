// Renders answer text with [n] citation markers turned into small badges.
// Pure rendering — usable from server and client components alike.

import type { ReactNode } from "react";

const MARKER = /(\[\d{1,3}\])/g;

export function AnswerText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(MARKER);
  const nodes: ReactNode[] = parts.map((part, i) => {
    const m = /^\[(\d{1,3})\]$/.exec(part);
    if (m) {
      return (
        <sup key={i} className="cite-marker" aria-label={`source ${m[1]}`}>
          {m[1]}
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
  return <p className={className ?? "whitespace-pre-wrap text-[15px] leading-relaxed"}>{nodes}</p>;
}
