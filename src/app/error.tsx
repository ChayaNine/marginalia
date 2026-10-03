"use client";

// Route-level error boundary. Next.js renders this instead of a blank page when a
// server component throws; `reset()` re-renders the segment.

import { useEffect } from "react";
import { Button, ErrorBox, LinkButton, PageHero } from "@/components/ui";
import { SCHEMA_OUT_OF_DATE_MESSAGE, isSchemaOutOfDate } from "@/lib/errors";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageHero eyebrow="Error" title="Something went wrong">
      <div className="mx-auto mt-8 max-w-lg text-left">
        <ErrorBox>
          {isSchemaOutOfDate(error)
            ? SCHEMA_OUT_OF_DATE_MESSAGE
            : error.message || "An unexpected error occurred."}
          {error.digest && (
            <span className="ml-2 font-mono text-xs opacity-70">ref {error.digest}</span>
          )}
        </ErrorBox>
      </div>
      <div className="mt-8 flex justify-center gap-3">
        <Button variant="primary" size="lg" onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/" variant="secondary" size="lg">
          Back to documents
        </LinkButton>
      </div>
    </PageHero>
  );
}
