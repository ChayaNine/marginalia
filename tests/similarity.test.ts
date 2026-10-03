import { describe, expect, it } from "vitest";
import { cosineSimilarity, dot, norm, normalize, topK } from "@/lib/rag/similarity";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("cosineSimilarity", () => {
  it("is 1 for identical directions, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity(v(1, 2, 3), v(2, 4, 6))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(v(1, 0), v(0, 1))).toBeCloseTo(0, 6);
    expect(cosineSimilarity(v(1, 1), v(-1, -1))).toBeCloseTo(-1, 6);
  });

  it("returns 0 (not NaN) when either vector is all zeros", () => {
    expect(cosineSimilarity(v(0, 0), v(1, 2))).toBe(0);
    expect(cosineSimilarity(v(0, 0), v(0, 0))).toBe(0);
  });

  it("never leaves [-1, 1] even with floating point noise", () => {
    const a = v(0.1, 0.2, 0.3, 0.4);
    expect(cosineSimilarity(a, a)).toBeLessThanOrEqual(1);
  });

  it("throws a helpful error on dimension mismatch", () => {
    expect(() => cosineSimilarity(v(1, 2), v(1, 2, 3))).toThrow(/dimension mismatch.*2 vs 3/i);
  });
});

describe("dot / norm / normalize", () => {
  it("computes dot product and Euclidean norm", () => {
    expect(dot(v(1, 2, 3), v(4, 5, 6))).toBe(32);
    expect(norm(v(3, 4))).toBe(5);
  });

  it("normalize yields a unit vector and leaves zero vectors alone", () => {
    const n = normalize(v(3, 4));
    expect(norm(n)).toBeCloseTo(1, 6);
    expect(Array.from(normalize(v(0, 0)))).toEqual([0, 0]);
  });

  it("normalize does not mutate its input", () => {
    const input = v(3, 4);
    normalize(input);
    expect(Array.from(input)).toEqual([3, 4]);
  });
});

describe("topK", () => {
  const items = ["a", "bb", "ccc", "dd", "e"];

  it("returns the k highest scores, best first", () => {
    const result = topK(items, (s) => s.length, 2);
    expect(result).toEqual([
      { item: "ccc", score: 3 },
      { item: "bb", score: 2 },
    ]);
  });

  it("keeps original order among ties (stable)", () => {
    const result = topK(items, (s) => s.length, 5).map((r) => r.item);
    expect(result).toEqual(["ccc", "bb", "dd", "a", "e"]);
  });

  it("handles k larger than the input and k <= 0", () => {
    expect(topK(items, () => 1, 100)).toHaveLength(5);
    expect(topK(items, () => 1, 0)).toEqual([]);
  });
});
