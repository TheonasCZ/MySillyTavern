import { describe, expect, it } from "vitest";

import { cosineSimilarity, decodeVector, encodeVector } from "./vector";

describe("vector encode/decode", () => {
  it("round-trips a vector through base64", () => {
    const vec = Float32Array.from([0.25, -1.5, 3.75, 0, 123.456]);
    const decoded = decodeVector(encodeVector(vec));
    expect(Array.from(decoded)).toEqual(Array.from(vec));
  });

  it("round-trips a large vector (chunked btoa path)", () => {
    const vec = new Float32Array(768).map((_, i) => Math.sin(i));
    const decoded = decodeVector(encodeVector(vec));
    expect(decoded.length).toBe(768);
    expect(decoded[767]).toBeCloseTo(Math.sin(767), 5);
  });

  it("accepts a plain number array", () => {
    expect(Array.from(decodeVector(encodeVector([1, 2, 3])))).toEqual([1, 2, 3]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    const a = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(
      0,
      6,
    );
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([-1, -2]))).toBeCloseTo(
      -1,
      6,
    );
  });

  it("returns 0 on dimension mismatch or zero vector", () => {
    expect(cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3]))).toBe(0);
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 2]))).toBe(0);
  });
});
