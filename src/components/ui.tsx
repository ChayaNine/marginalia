// Small, dependency-free UI primitives. Kept in one file on purpose: there are
// few enough of them that a folder-per-component would be ceremony.
//
// Visual rules, so new screens stay consistent:
//   - one gradient (`primary`) per view, for the action that matters most;
//   - `dark` pills for the second most important action;
//   - everything else is quiet: white with a hairline border, or plain text.

import { CircleAlert, Info, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, so a caller's override wins
 * regardless of stylesheet order: cn("rounded-full inline-flex", "rounded-xl hidden")
 * → "rounded-xl hidden".
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

/* ---------- Badge ---------- */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

const badgeTone: Record<Tone, string> = {
  neutral: "bg-muted text-ink-muted ring-line",
  accent: "bg-brand-soft text-brand ring-brand/15",
  ok: "bg-ok-soft text-ok ring-ok/15",
  warn: "bg-warn-soft text-warn ring-warn/20",
  bad: "bg-bad-soft text-bad ring-bad/15",
  info: "bg-info-soft text-info ring-info/15",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        badgeTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "dark" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const buttonVariant: Record<Variant, string> = {
  primary:
    "bg-brand-gradient text-white shadow-brand hover:brightness-110 active:brightness-95 disabled:shadow-none",
  dark: "bg-ink text-white hover:bg-ink/85 disabled:opacity-40",
  secondary:
    "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-muted disabled:opacity-50",
  ghost: "bg-transparent text-ink-muted hover:bg-muted hover:text-ink disabled:opacity-50",
  danger: "bg-transparent text-bad hover:bg-bad-soft disabled:opacity-50",
};

const buttonSize: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  // A primary button that is unavailable (not merely busy) turns neutral grey, so
  // it reads as "not yet" rather than as a faded version of the main action.
  const unavailable = variant === "primary" && disabled && !loading;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={cn(
        buttonBase,
        buttonSize[size],
        unavailable ? "bg-line text-ink-faint" : buttonVariant[variant],
        className,
      )}
    >
      {loading && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className,
  newTab = false,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  /** Open in a new tab as a plain link (files served by the API, not app pages). */
  newTab?: boolean;
}) {
  if (newTab) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonBase, buttonSize[size], buttonVariant[variant], className)}
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className={cn(buttonBase, buttonSize[size], buttonVariant[variant], className)}
    >
      {children}
    </Link>
  );
}

/* ---------- Layout ---------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface", className)}>{children}</div>
  );
}

/** Large centred page title, in the style of a landing page. */
export function PageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-3xl pt-10 pb-10 text-center sm:pt-16">
      {eyebrow && <p className="mb-3 text-sm font-medium text-ink-muted">{eyebrow}</p>}
      <h1 className="text-[2.6rem] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink sm:text-6xl">
        {title}
      </h1>
      {description && (
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted sm:text-base">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

/** Left-aligned title for detail pages. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-sm font-medium text-ink-muted">{eyebrow}</p>}
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-4xl">{title}</h1>
        {description && <div className="mt-3 text-sm text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-xl font-bold tracking-[-0.02em] text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
    >
      <span aria-hidden="true">←</span> {children}
    </Link>
  );
}

/* ---------- Feedback ---------- */

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-muted/50 px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-ink-faint">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad ring-1 ring-inset ring-bad/15",
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    neutral: "bg-muted text-ink-muted ring-line",
    accent: "bg-brand-soft text-brand ring-brand/15",
    ok: "bg-ok-soft text-ok ring-ok/15",
    warn: "bg-warn-soft text-warn ring-warn/20",
    bad: "bg-bad-soft text-bad ring-bad/15",
    info: "bg-info-soft text-info ring-info/15",
  };
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={cn("animate-spin", className ?? "h-4 w-4")} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-ink ring-1 ring-inset ring-line">
      {children}
    </code>
  );
}

/** "✓ Ready" style status: a coloured check and a word, like a comparison table. */
export function CheckLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold text-ok", className)}>
      <span aria-hidden="true">✓</span>
      {children}
    </span>
  );
}
