// Text utilities: sentence splitting, tokenising, structure detection for
// non-PDF formats, and salient-sentence selection.

import { describe, expect, it } from "vitest";
import { blocksToText, formatTableRows } from "@/lib/text/doc-model";
import { pickSalient } from "@/lib/text/salience";
import { splitSentences, wordCount } from "@/lib/text/sentences";
import { csvToBlocks, htmlToBlocks, markdownToBlocks, textToBlocks } from "@/lib/text/structure";
import { stem, tokenize } from "@/lib/text/tokenize";

describe("splitSentences", () => {
  it("splits on sentence punctuation followed by a capital or digit", () => {
    expect(splitSentences("One here. Two there! Three? 4 is a number.")).toEqual([
      "One here.",
      "Two there!",
      "Three?",
      "4 is a number.",
    ]);
  });

  it("does not split after abbreviations, initials or before lower case", () => {
    const text =
      "We use sensors, e.g. the Avia. See Fig. 3 for details. J. Smith et al. agree. It is approx. 5 m away.";
    expect(splitSentences(text)).toEqual([
      "We use sensors, e.g. the Avia.",
      "See Fig. 3 for details.",
      "J. Smith et al. agree.",
      "It is approx. 5 m away.",
    ]);
  });

  it("ends a sentence after a labelled numeral like 'Table I.'", () => {
    expect(splitSentences("Details are in Table I. The rig is stationary.")).toEqual([
      "Details are in Table I.",
      "The rig is stationary.",
    ]);
  });

  it("treats newlines as boundaries and collapses inner whitespace", () => {
    expect(splitSentences("Range: 120 m\nRange:   450 m")).toEqual([
      "Range: 120 m",
      "Range: 450 m",
    ]);
  });

  it("counts words", () => {
    expect(wordCount("  one two\tthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});

describe("tokenize", () => {
  it("lower-cases, strips punctuation and drops stopwords", () => {
    expect(tokenize("What ARE the Quiet-Hours, exactly?")).toEqual([
      "quiet",
      "hour",
      "exactly",
      "quiethours",
    ]);
  });

  it("stems so related word forms meet", () => {
    expect(new Set(["calibrate", "calibrated", "calibration", "calibrations"].map(stem)).size).toBe(
      1,
    );
    expect(stem("policies")).toBe(stem("policy"));
    expect(stem("planned")).toBe("plan");
    expect(stem("speed")).toBe("speed"); // not "spe"
    expect(stem("lost")).toBe(stem("lose"));
  });

  it("keeps model numbers matchable with or without separators", () => {
    expect(tokenize("Livox Mid-360")).toEqual(["livox", "mid", "360", "mid360"]);
    expect(tokenize("Mid360")).toContain("mid360");
  });
});

describe("structure detection", () => {
  it("reads Markdown headings, lists, tables and a leading H1 title", () => {
    const doc = markdownToBlocks(
      [
        "# Handbook",
        "",
        "## 1. Pets",
        "",
        "No **pets**.",
        "",
        "- one",
        "- two",
        "",
        "| Item | Fee |",
        "|---|---|",
        "| Key | £15 |",
      ].join("\n"),
    );
    expect(doc.title).toBe("Handbook");
    expect(doc.blocks).toEqual([
      // The title is lifted out, not left as the root of every section path.
      { kind: "heading", text: "1. Pets", level: 2 },
      { kind: "paragraph", text: "No pets." },
      { kind: "paragraph", text: "- one" },
      { kind: "paragraph", text: "- two" },
      { kind: "table", text: "Item | Fee\nItem: Key; Fee: £15" },
    ]);
  });

  it("finds title-like lines in plain text", () => {
    const { blocks } = textToBlocks(
      "QUIET HOURS\n\nQuiet hours start at 11 pm.\n\nGuests\n\nGuests may stay three nights.",
    );
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["heading", "QUIET HOURS"],
      ["paragraph", "Quiet hours start at 11 pm."],
      ["heading", "Guests"],
      ["paragraph", "Guests may stay three nights."],
    ]);
  });

  it("reflows wrapped lines in plain text but keeps list lines", () => {
    const { blocks } = textToBlocks(
      "A sentence that was\nwrapped by an editor.\n\n1. first\n2. second",
    );
    expect(blocks.map((b) => b.text)).toEqual([
      "A sentence that was wrapped by an editor.",
      "1. first\n2. second",
    ]);
  });

  it("reads Word HTML: headings, paragraphs, list items and tables", () => {
    const { blocks, title } = htmlToBlocks(
      "<h1>Guide</h1><p>Intro &amp; more.</p><ul><li>First</li></ul><table><tr><td>Item</td><td>Fee</td></tr><tr><td>Key</td><td>£15</td></tr></table>",
    );
    expect(title).toBe("Guide");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "Intro & more." },
      { kind: "paragraph", text: "- First" },
      { kind: "table", text: "Item | Fee\nItem: Key; Fee: £15" },
    ]);
  });

  it("turns a CSV into one table block with labelled rows", () => {
    expect(csvToBlocks("name,range\nAvia,450 m\nMid-360,70 m").blocks).toEqual([
      { kind: "table", text: "name | range\nname: Avia; range: 450 m\nname: Mid-360; range: 70 m" },
    ]);
  });

  it("labels table cells with their column headers so a row stands alone", () => {
    expect(
      formatTableRows([
        ["Sensor", "Range"],
        ["Avia", "450 m"],
      ]),
    ).toEqual(["Sensor | Range", "Sensor: Avia; Range: 450 m"]);
    expect(
      blocksToText([
        { kind: "heading", text: "A" },
        { kind: "paragraph", text: "B" },
      ]),
    ).toBe("A\n\nB");
  });
});

describe("pickSalient", () => {
  const sentences = [
    { text: "The dataset contains LiDAR recordings of drones." },
    { text: "The dataset contains LiDAR recordings of drones, indoors." },
    { text: "Lunch was served at noon." },
    { text: "Drones were tracked with LiDAR sensors in the dataset." },
  ];

  it("prefers central sentences and avoids near-duplicates", () => {
    const picked = pickSalient(sentences, 2);
    expect(picked).toHaveLength(2);
    expect(picked).not.toContain(2); // off-topic
    expect(picked.includes(0) && picked.includes(1)).toBe(false); // not both paraphrases
  });

  it("returns indices in document order and honours bonuses", () => {
    expect(pickSalient(sentences, 3)).toEqual([...pickSalient(sentences, 3)].sort((a, b) => a - b));
    const boosted = sentences.map((s, i) => ({ ...s, bonus: i === 2 ? 50 : 1 }));
    expect(pickSalient(boosted, 1)).toEqual([2]);
    expect(pickSalient([], 3)).toEqual([]);
  });
});
