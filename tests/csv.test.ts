import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  extractQuestions,
  guessQuestionColumn,
  looksLikeHeader,
  parseCsv,
  toCsv,
} from "@/lib/csv";

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n").rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing delimiters, quotes and newlines", () => {
    const text = 'id,question\n1,"What is ""quiet hours"", exactly?"\n2,"Line one\nline two"\n';
    expect(parseCsv(text).rows).toEqual([
      ["id", "question"],
      ["1", 'What is "quiet hours", exactly?'],
      ["2", "Line one\nline two"],
    ]);
  });

  it("accepts CRLF line endings and a UTF-8 BOM", () => {
    expect(parseCsv("﻿q\r\nfirst\r\nsecond").rows).toEqual([["q"], ["first"], ["second"]]);
  });

  it("drops fully blank rows", () => {
    expect(parseCsv("q\n\nfirst\n   \nsecond\n\n").rows).toEqual([["q"], ["first"], ["second"]]);
  });

  it("auto-detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(detectDelimiter('"x;y",z')).toBe(","); // delimiter inside quotes doesn't count
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("").rows).toEqual([]);
  });
});

describe("header + question column detection", () => {
  it("recognises common header names", () => {
    expect(guessQuestionColumn(["ID", "Question", "Owner"])).toBe(1);
    expect(guessQuestionColumn(["prompt"])).toBe(0);
    expect(guessQuestionColumn(["What is X?"])).toBe(-1);
    expect(looksLikeHeader(["#", "question"])).toBe(true);
    expect(looksLikeHeader(["Is it Monday?"])).toBe(false);
  });
});

describe("extractQuestions", () => {
  const rows = [
    ["id", "Question", "Notes"],
    ["1", "What are the quiet hours?", "x"],
    ["2", "   ", ""],
    ["3", "Are pets allowed?", ""],
  ];

  it("uses the header to find the question column and skips blanks", () => {
    const result = extractQuestions(rows);
    expect(result.column).toBe(1);
    expect(result.header).toEqual(["id", "Question", "Notes"]);
    expect(result.questions).toEqual(["What are the quiet hours?", "Are pets allowed?"]);
  });

  it("treats every row as data when there is no header", () => {
    const result = extractQuestions([["First?"], ["Second?"]]);
    expect(result.header).toBeNull();
    expect(result.questions).toEqual(["First?", "Second?"]);
  });

  it("accepts an explicit column by index or by header name", () => {
    expect(extractQuestions(rows, { column: 2, hasHeader: true }).questions).toEqual(["x"]);
    expect(extractQuestions(rows, { column: "question" }).questions).toHaveLength(2);
  });

  it("collapses internal whitespace in questions", () => {
    expect(extractQuestions([["question"], ["What   is\n  this?"]]).questions).toEqual([
      "What is this?",
    ]);
  });
});

describe("toCsv", () => {
  it("quotes only what needs quoting and escapes inner quotes", () => {
    const csv = toCsv([["plain", 'has "quotes"', "has, comma", "multi\nline"]]);
    expect(csv).toBe('plain,"has ""quotes""","has, comma","multi\nline"\r\n');
  });

  it("neutralises spreadsheet formula injection by default", () => {
    expect(toCsv([["=SUM(A1:A9)", "+1", "-1", "@cmd"]])).toBe("'=SUM(A1:A9),'+1,'-1,'@cmd\r\n");
    expect(toCsv([["=1"]], { protectFormulas: false })).toBe("=1\r\n");
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["#", "Question", "Answer"],
      ["1", 'Why "this"?', "Because,\nreasons."],
    ];
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows);
  });
});
