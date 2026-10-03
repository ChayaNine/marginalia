import { describe, expect, it } from "vitest";
import { bytesToVector, vectorToBytes } from "@/lib/rag/vectors";

describe("vector <-> bytes", () => {
  it("round-trips a Float32Array exactly", () => {
    const original = Float32Array.from([0.1, -2.5, 3.25, 1e-7, 1024]);
    const bytes = vectorToBytes(original);
    expect(bytes.byteLength).toBe(original.length * 4);
    expect(Array.from(bytesToVector(bytes))).toEqual(Array.from(original));
  });

  it("accepts plain number arrays", () => {
    expect(Array.from(bytesToVector(vectorToBytes([1, 2, 3])))).toEqual([1, 2, 3]);
  });

  it("copies rather than aliasing the input", () => {
    const original = Float32Array.from([1, 2]);
    const bytes = vectorToBytes(original);
    original[0] = 99;
    expect(bytesToVector(bytes)[0]).toBe(1);
  });

  it("handles byte views that are not 4-byte aligned (Node Buffer pool slices)", () => {
    const vector = Float32Array.from([1.5, -1.5, 8]);
    const clean = vectorToBytes(vector);
    // Build a buffer where our bytes start at offset 1, then slice a view to them.
    const padded = new Uint8Array(clean.byteLength + 1);
    padded.set(clean, 1);
    const misaligned = padded.subarray(1);
    expect(misaligned.byteOffset % 4).not.toBe(0);
    expect(Array.from(bytesToVector(misaligned))).toEqual([1.5, -1.5, 8]);
  });

  it("rejects byte lengths that cannot be Float32 data", () => {
    expect(() => bytesToVector(new Uint8Array(7))).toThrow(/multiple of 4/);
  });
});
