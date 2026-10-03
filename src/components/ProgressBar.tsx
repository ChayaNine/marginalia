// Stacked progress bar for a question set: approved / drafted / rejected / pending.

import type { QuestionSetStats } from "@/lib/stats";
import { cn } from "./ui";

const segments = [
  { key: "approved", label: "approved", color: "bg-ok" },
  { key: "drafted", label: "drafted", color: "bg-brand" },
  { key: "rejected", label: "rejected", color: "bg-bad" },
  { key: "pending", label: "pending", color: "bg-line-strong" },
] as const;

export function ProgressBar({
  stats,
  className,
  showLegend = true,
}: {
  stats: QuestionSetStats;
  className?: string;
  showLegend?: boolean;
}) {
  const total = Math.max(1, stats.total);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className={cn("space-y-2.5", className)}>
      <div
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${stats.approved} approved, ${stats.drafted} drafted, ${stats.rejected} rejected, ${stats.pending} pending`}
      >
        {segments
          .slice(0, 3)
          .map(
            (s) =>
              stats[s.key] > 0 && (
                <div
                  key={s.key}
                  className={cn("rounded-full", s.color)}
                  style={{ width: pct(stats[s.key]) }}
                />
              ),
          )}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {segments.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <i
                aria-hidden="true"
                className={cn("inline-block h-1.5 w-1.5 rounded-full", s.color)}
              />
              {stats[s.key]} {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
