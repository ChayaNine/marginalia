// Floating top navigation. A server component, so it can read the active AI
// provider directly; only the links (which need the current path) run on the client.

import { ArrowRight } from "lucide-react";
import { getProvider, providerLabel } from "@/lib/ai";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { LinkButton, cn } from "./ui";

export function Nav() {
  const provider = getProvider();
  const demo = provider.name === "mock";

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto max-w-6xl rounded-2xl border border-line/70 bg-white/85 shadow-soft backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo />
            <NavLinks className="hidden md:flex" />
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <span
              className="hidden items-center gap-2 text-sm font-medium text-ink-muted lg:inline-flex"
              title={`Embeddings: ${provider.embeddingModel} · Chat: ${provider.chatModel}`}
            >
              <span
                aria-hidden="true"
                className={cn("h-2 w-2 rounded-full", demo ? "bg-amber-500" : "bg-emerald-500")}
              />
              {providerLabel()}
            </span>
            <LinkButton href="/ask" variant="dark" size="sm" className="hidden sm:inline-flex">
              Ask a question
            </LinkButton>
            <LinkButton href="/#upload" variant="primary" size="sm">
              Upload <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </LinkButton>
          </div>
        </div>
        <div className="border-t border-line/70 px-2 py-2 md:hidden">
          <NavLinks className="overflow-x-auto" />
        </div>
      </div>
    </header>
  );
}
