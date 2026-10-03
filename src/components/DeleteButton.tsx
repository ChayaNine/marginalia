"use client";

// Generic "delete with confirmation" button used for documents and question sets.

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, messageOf } from "@/lib/api-client";
import { Button, Spinner, type ButtonProps } from "./ui";

type Props = {
  url: string;
  confirmText: string;
  /** Where to go afterwards; omit to stay and refresh the current page. */
  redirectTo?: string;
  label?: string;
  size?: ButtonProps["size"];
  /** A quiet trash icon (for table rows) instead of a labelled button. */
  iconOnly?: boolean;
};

export function DeleteButton({
  url,
  confirmText,
  redirectTo,
  label = "Delete",
  size = "sm",
  iconOnly = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api<void>(url, { method: "DELETE" });
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      {iconOnly ? (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          aria-label={label}
          title={label}
          className="rounded-full p-2 text-ink-faint transition-colors hover:bg-bad-soft hover:text-bad disabled:opacity-50"
        >
          {busy ? <Spinner /> : <Trash2 aria-hidden="true" className="h-4 w-4" />}
        </button>
      ) : (
        <Button variant="danger" size={size} onClick={remove} loading={busy}>
          {!busy && <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
          {label}
        </Button>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
