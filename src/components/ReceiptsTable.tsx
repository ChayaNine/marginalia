// "Why answers come with receipts" — what grounding buys you, compared with a
// model answering from its own memory. Each row describes a feature that exists
// in this codebase; nothing here is aspirational.

const rows = [
  {
    title: "Points to the exact passage",
    body: "Every sentence carries a [n] marker linked to the section of the document it came from.",
    them: "No source",
  },
  {
    title: "Quotes checked against the source",
    body: "Each cited quote is matched against the passage. Anything that doesn't match is flagged for review.",
    them: "Nothing to check",
  },
  {
    title: "Says “not found” instead of guessing",
    body: "If nothing relevant is retrieved, the model is never called and you are told so.",
    them: "Often guesses",
  },
  {
    title: "A person approves every answer",
    body: "Approve, edit, reject or regenerate. Edits never overwrite the original AI draft.",
    them: "Not built in",
  },
  {
    title: "Answers only from your documents",
    body: "The model sees the passages you uploaded, nothing from the open web or its training data.",
    them: "Training data",
  },
  {
    title: "Export what you approved",
    body: "Download approved answers with their sources as a CSV, ready to send.",
    them: "Copy and paste",
  },
];

export function ReceiptsTable() {
  return (
    <section>
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium text-ink-muted">Compared</p>
        <h2 className="mt-3 text-3xl leading-tight font-extrabold tracking-[-0.03em] text-ink sm:text-[2.6rem]">
          Why answers come
          <br />
          with receipts
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
          A model answering from memory gives you text. Marginalia gives you text you can check.
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1fr_6.5rem_7.5rem] items-center border-b border-line px-5 py-4 text-[13px] sm:grid-cols-[1fr_10rem_10rem] sm:px-6">
          <span />
          <span className="flex items-center justify-center gap-1 font-semibold text-ink">
            <span aria-hidden="true" className="text-brand-gradient text-base font-extrabold">
              §
            </span>
            Marginalia
          </span>
          <span className="text-center text-ink-muted">From memory</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li
              key={r.title}
              className="grid grid-cols-[1fr_6.5rem_7.5rem] items-center gap-2 bg-muted/30 px-5 py-5 sm:grid-cols-[1fr_10rem_10rem] sm:px-6"
            >
              <div className="pr-2">
                <p className="text-[15px] font-semibold text-ink">{r.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{r.body}</p>
              </div>
              <span className="text-center text-sm font-semibold text-ok">✓ Yes</span>
              <span className="text-center text-[13px] text-ink-faint">{r.them}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
