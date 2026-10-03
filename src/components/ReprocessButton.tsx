"use client";

// Re-runs the current pipeline over a document's stored original file.

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, messageOf } from "@/lib/api-client";
import { Button, type ButtonProps } from "./ui";

export function ReprocessButton({
  documentId,
  label = "Re-process",
  variant = "secondary",
  size = "sm",
}: {
  documentId: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/documents/${documentId}/reprocess`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size={size} onClick={run} loading={busy}>
        {!busy && <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
        {busy ? "Re-processing…" : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-bad">{error}</span>}
    </span>
  );
}
