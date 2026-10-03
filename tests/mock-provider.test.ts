import { describe, expect, it } from "vitest";
import { MOCK_DIMENSIONS, createMockProvider, mockEmbed } from "@/lib/ai/mock";
import type { PromptSource } from "@/lib/ai/provider";
import { cosineSimilarity, norm } from "@/lib/rag/similarity";

const source = (
  index: number,
  content: string,
  extra: Partial<PromptSource> = {},
): PromptSource => ({
  index,
  documentTitle: "Handbook",
  chunkIndex: index - 1,
  content,
  ...extra,
});

describe("mockEmbed", () => {
  it("is deterministic and unit-length", () => {
    const a = mockEmbed("Quiet hours start at eleven.");
    const b = mockEmbed("Quiet hours start at eleven.");
    expect(a.length).toBe(MOCK_DIMENSIONS);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(norm(a)).toBeCloseTo(1, 5);
  });

  it("scores related text higher than unrelated text, across word forms", () => {
    const question = mockEmbed("How were the sensors calibrated?");
    const related = mockEmbed("Calibration of each sensor used a checkerboard target.");
    const unrelated = mockEmbed("The cafeteria serves breakfast until ten in the morning.");
    expect(cosineSimilarity(question, related)).toBeGreaterThan(
      cosineSimilarity(question, unrelated),
    );
    expect(cosineSimilarity(question, related)).toBeGreaterThan(0.2);
  });

  it("returns a zero vector for text with no usable tokens", () => {
    expect(norm(mockEmbed("the a of"))).toBe(0);
  });
});

describe("mock generate: questions", () => {
  const provider = createMockProvider();

  it("answers extractively with citations pointing at the sources used", async () => {
    const result = await provider.generate({
      question: "When do quiet hours start?",
      sources: [
        source(1, "Pets are not allowed. Guests may stay three nights."),
        source(2, "Quiet hours start at 11 pm. Laundry is on level 2."),
      ],
    });
    expect(result.insufficient).toBe(false);
    expect(result.answer).toBe("Quiet hours start at 11 pm. [2]");
    expect(result.citations).toEqual([{ source: 2, quote: "Quiet hours start at 11 pm." }]);
    expect(result.model).toBe("mock-extractive-v2");
  });

  it("reports insufficient when nothing overlaps the question", async () => {
    const result = await provider.generate({
      question: "What is the parking fee?",
      sources: [source(1, "Quiet hours start at 11 pm.")],
    });
    expect(result).toMatchObject({ insufficient: true, citations: [], confidence: "low" });
  });

  it("treats a single coincidental word as insufficient for a longer question", async () => {
    const result = await provider.generate({
      question: "What is the parking permit fee?",
      sources: [source(1, "A late payment fee of £25 applies after 14 days.")],
    });
    expect(result.insufficient).toBe(true);
  });

  it("weights rare words: the sentence naming the thing asked about wins", async () => {
    const result = await provider.generate({
      question: "What is the range of the Livox Avia?",
      sources: [
        source(1, "The range of each sensor is listed in the table. Range matters for tracking."),
        source(2, "The Livox Avia has a detection range of 450 m."),
      ],
    });
    expect(result.answer).toBe("The Livox Avia has a detection range of 450 m. [2]");
  });

  it("matches irregular word forms ('lose' / 'lost')", async () => {
    const result = await provider.generate({
      question: "What happens if I lose my key card?",
      sources: [
        source(
          1,
          "Key cards must not be lent. A lost card must be reported; a replacement costs £15.",
        ),
      ],
    });
    expect(result.answer).toContain("A lost card must be reported");
  });

  it("adds the following sentence when the question asks for a number the best one lacks", async () => {
    const result = await provider.generate({
      question: "What is the RMSE of the LiDAR estimates?",
      sources: [
        source(
          1,
          "We computed the RMSE of the LiDAR estimates against the ground truth. The mean error was 0.0143 m.",
        ),
      ],
    });
    expect(result.answer).toContain("0.0143 m");
  });

  it("only adds a second sentence when it covers a new question term", async () => {
    const result = await provider.generate({
      question: "Are pets allowed in the residence halls?",
      sources: [
        source(
          1,
          "No pets are permitted in the residence halls. It applies to all four residence halls.",
        ),
      ],
    });
    expect(result.citations).toHaveLength(1);
    expect(result.answer).toBe("No pets are permitted in the residence halls. [1]");
  });

  it("uses a passage's section heading as evidence", async () => {
    const result = await provider.generate({
      question: "How were the sensors calibrated?",
      sources: [
        source(1, "The extrinsic parameters were estimated with GICP between point clouds.", {
          heading: "III. System › C. Sensor Calibration",
        }),
      ],
    });
    expect(result.insufficient).toBe(false);
    expect(result.answer).toContain("GICP");
  });

  it("does not quote the same sentence twice when passages overlap", async () => {
    const shared = "Quiet hours start at 11 pm on weekdays.";
    const result = await provider.generate({
      question: "When do quiet hours start on weekdays?",
      sources: [
        source(1, `Intro text here. ${shared}`),
        source(2, `${shared} More text follows here.`),
      ],
    });
    expect(result.citations).toHaveLength(1);
  });

  it("embeds a batch in order", async () => {
    const vectors = await provider.embed(["alpha beta", "gamma delta"]);
    expect(vectors).toHaveLength(2);
    expect(Array.from(vectors[0])).toEqual(Array.from(mockEmbed("alpha beta")));
  });
});

describe("mock generate: overviews", () => {
  const provider = createMockProvider();
  const paper = [
    source(
      1,
      "Authors and affiliations.\n\nAbstract\n\nThis paper presents a new dataset for drone tracking with three LiDAR sensors. We release all recordings and calibration files.",
      {
        heading: "Abstract",
      },
    ),
    source(
      2,
      "Tracking small drones with LiDAR is hard because point clouds are sparse at long range. Prior datasets used a single sensor type.",
      {
        heading: "I. Introduction",
      },
    ),
    source(
      3,
      "Sensor: Avia; Range: 450 m; Rate: 10 Hz\nSensor: Mid-360; Range: 70 m; Rate: 10 Hz",
      { heading: "II. Hardware" },
    ),
    source(
      4,
      "In conclusion, dense solid-state LiDARs tracked the drones in 100% of the sequences, while sparse sensors often lost them.",
      {
        heading: "V. Conclusion",
      },
    ),
  ];

  it("leads with the first sentence of the abstract, then cited key points", async () => {
    const result = await provider.generate({
      question: "explain the crucial details",
      sources: paper,
      mode: "overview",
    });
    const lines = result.answer.split("\n").filter(Boolean);
    expect(lines[0]).toBe(
      "This paper presents a new dataset for drone tracking with three LiDAR sensors. [1]",
    );
    expect(lines[1]).toBe("Key points:");
    expect(lines.slice(2).every((l) => /^• .+ \[\d\]$/.test(l))).toBe(true);
    expect(result.answer).toContain("100% of the sequences");
    // Never table rows or author lines.
    expect(result.answer).not.toMatch(/Range: 450 m|Authors and affiliations/);
    expect(result.citations.length).toBe(lines.length - 1);
    expect(result.insufficient).toBe(false);
  });

  it("gives each document its own section when there are several", async () => {
    const other = {
      ...source(
        5,
        "The handbook explains how the residence halls are run day to day for every resident.",
      ),
      documentTitle: "Handbook B",
      chunkIndex: 0,
    };
    const result = await provider.generate({
      question: "summarise",
      sources: [...paper, other],
      mode: "overview",
    });
    expect(result.answer).toMatch(/^Handbook\n/);
    expect(result.answer).toContain("\n\nHandbook B\n");
  });
});
