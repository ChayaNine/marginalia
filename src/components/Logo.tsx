// The wordmark: a gradient section sign (the same "§" used for passage numbers in
// citations) followed by the name.

import Link from "next/link";
import { cn } from "./ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-1.5 text-[17px] font-bold tracking-[-0.02em] text-ink",
        className,
      )}
      aria-label="Marginalia home"
    >
      <span
        aria-hidden="true"
        className="text-brand-gradient text-[22px] leading-none font-extrabold"
      >
        §
      </span>
      marginalia
    </Link>
  );
}
