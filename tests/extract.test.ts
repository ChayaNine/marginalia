import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExtractionError, UnsupportedFileError } from "@/lib/errors";
import { extractDocument, extractTextFromFile } from "@/lib/extract";
import { detectFileKind, titleFromFilename } from "@/lib/file-kinds";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(__dirname, "fixtures", name)));

describe("detectFileKind", () => {
  it("prefers the extension, falls back to MIME type", () => {
    expect(detectFileKind("notes.PDF", "")).toBe("pdf");
    expect(detectFileKind("notes.md", "text/plain")).toBe("markdown");
    expect(detectFileKind("blob", "application/pdf")).toBe("pdf");
    expect(detectFileKind("data.csv", "application/vnd.ms-excel")).toBe("csv");
  });

  it("rejects unsupported types with a helpful message", () => {
    expect(() => detectFileKind("photo.png", "image/png")).toThrow(UnsupportedFileError);
    expect(() => detectFileKind("archive.zip", "")).toThrow(/Supported: \.pdf, \.docx/);
  });
});

describe("titleFromFilename", () => {
  it("cleans separators and drops the extension", () => {
    expect(titleFromFilename("Q3_housing-handbook (final).pdf")).toBe(
      "Q3 housing handbook (final)",
    );
    expect(titleFromFilename(".pdf")).toBe("Untitled document");
  });
});

describe("extractTextFromFile", () => {
  it("reads UTF-8 text and strips a BOM", async () => {
    const bytes = new TextEncoder().encode("﻿Hello there, this is a plain text file.");
    expect(await extractTextFromFile(bytes, "text")).toBe(
      "Hello there, this is a plain text file.",
    );
  });

  it("extracts the text layer from a PDF across pages", async () => {
    const text = await extractTextFromFile(fixture("sample.pdf"), "pdf");
    expect(text).toContain("Quiet hours run from 11 pm to 7 am on weekdays.");
    expect(text).toContain("refunded within 30 days");
  });

  it("explains that a PDF without a text layer needs OCR", async () => {
    await expect(extractTextFromFile(fixture("scanned.pdf"), "pdf")).rejects.toThrow(
      /No text layer.*OCR/,
    );
  });

  it("finds the title, headings and pages of a PDF", async () => {
    const doc = await extractDocument(fixture("sample.pdf"), "pdf");
    expect(doc.pageCount).toBe(2);
    expect(doc.blocks.every((b) => b.page === 1 || b.page === 2)).toBe(true);
    expect(doc.blocks.find((b) => b.text.includes("refunded within 30 days"))?.page).toBe(2);
  });

  it("uses a lone leading Markdown H1 as the title", async () => {
    const doc = await extractDocument(
      new TextEncoder().encode("# My Handbook\n\n## Pets\n\nSome body text here."),
      "markdown",
    );
    expect(doc.title).toBe("My Handbook");
    expect(doc.blocks[0]).toMatchObject({ kind: "heading", text: "Pets" });
    // Several H1s are sections, not a title.
    const sections = await extractDocument(
      new TextEncoder().encode("# One\n\nBody text one.\n\n# Two\n\nBody text two."),
      "markdown",
    );
    expect(sections.title).toBeUndefined();
    expect(sections.blocks[0]).toMatchObject({ kind: "heading", text: "One", level: 1 });
  });

  it("extracts paragraphs from a .docx", async () => {
    const text = await extractTextFromFile(fixture("sample.docx"), "docx");
    expect(text).toContain("Aurora Campus Housing Handbook");
    expect(text).toContain("Guests may stay for up to three consecutive nights.");
  });

  it("wraps parser failures in ExtractionError", async () => {
    const garbage = new TextEncoder().encode("this is not a docx");
    await expect(extractTextFromFile(garbage, "docx")).rejects.toBeInstanceOf(ExtractionError);
  });

  it("rejects files with too little text", async () => {
    await expect(extractTextFromFile(new TextEncoder().encode("hi"), "text")).rejects.toThrow(
      /no readable text/i,
    );
  });
});

describe("markdown stripping", () => {
  it("removes headings, emphasis, links and list markers but keeps the words", async () => {
    const md = [
      "# Title",
      "",
      "## 3. Quiet hours",
      "",
      "Quiet hours run from **11 pm** to _7 am_. See [the portal](https://example.com) or `help`.",
      "",
      "* first item",
      "- second item",
      "> quoted line",
      "",
      "---",
      "",
      "Final <em>paragraph</em>.",
    ].join("\n");
    const text = await extractTextFromFile(new TextEncoder().encode(md), "markdown");
    expect(text).toBe(
      [
        "Title",
        "",
        "3. Quiet hours",
        "",
        "Quiet hours run from 11 pm to 7 am. See the portal or help.",
        "",
        "- first item",
        "",
        "- second item",
        "",
        "quoted line",
        "",
        "Final paragraph.",
      ].join("\n"),
    );
  });

  it("does not touch plain .txt files", async () => {
    const text = await extractTextFromFile(
      new TextEncoder().encode("# not a heading, just text here"),
      "text",
    );
    expect(text).toBe("# not a heading, just text here");
  });
});
