// Light Markdown → plain text.
//
// Markdown files are a common input (READMEs, wikis, notes). Their syntax adds
// nothing for retrieval or for a reader of a cited passage — "## 3. Quiet hours"
// should read as "3. Quiet hours" — so we strip the common markers before
// chunking. This is deliberately conservative: it removes decoration, it never
// tries to interpret structure. Browser-safe, no dependencies.

export function stripMarkdown(markdown: string): string {
  return (
    markdown
      // fenced code blocks: keep the code, drop the fences
      .replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, "$1")
      // images: keep alt text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // links: keep the text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // headings
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      // trailing heading hashes ("Title ##")
      .replace(/[ \t]+#+[ \t]*$/gm, "")
      // blockquotes
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      // horizontal rules
      .replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, "")
      // bold / italic / inline code
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2")
      .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, "$1$2")
      .replace(/`([^`\n]+)`/g, "$1")
      // bullet markers → a plain dash, so list items still read as items
      .replace(/^[ \t]*[-*+][ \t]+/gm, "- ")
      // HTML tags
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
  );
}
