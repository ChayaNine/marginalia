// Where a passage lives: page labels and links. Browser-safe.

/** "p. 4", "pp. 4–5", or "" when the format has no pages. */
export function formatPages(pageStart?: number | null, pageEnd?: number | null): string {
  if (!pageStart) return "";
  return pageEnd && pageEnd !== pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`;
}

/** The original file, opened at a page (browsers' PDF viewers honour #page=N). */
export function fileHref(documentId: string, page?: number | null): string {
  return `/api/documents/${documentId}/file${page ? `#page=${page}` : ""}`;
}

/** A passage on its document's page. */
export function passageHref(documentId: string, chunkIndex: number): string {
  return `/documents/${documentId}#s${chunkIndex + 1}`;
}

/** "III. System Overview › C. Sensor Calibration" → "C. Sensor Calibration". */
export function lastHeading(heading: string | null | undefined): string | null {
  if (!heading) return null;
  const parts = heading.split(" › ");
  return parts[parts.length - 1] || null;
}

/** Sentence-case for SHOUTED headings from PDFs: "I. INTRODUCTION" → "I. Introduction". */
export function displayHeading(heading: string): string {
  const letters = heading.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) return heading;
  return heading.replace(/\b([A-Z])([A-Z]+)\b/g, (word, first: string, rest: string) =>
    /^[IVXLC]+$/.test(word) || word.length <= 3 ? word : first + rest.toLowerCase(),
  );
}
