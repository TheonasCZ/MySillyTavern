import { describe, expect, it } from "vitest";

import {
  buildCorrections,
  DRIFT_CORRECTION_TTL,
  DRIFT_EMA_ALPHA,
  DRIFT_MAX_CORRECTIONS,
  DRIFT_SEVERITY_THRESHOLD,
  mergeCorrections,
  parseDriftOutput,
  updateDriftScore,
  type DriftFinding,
} from "./driftDetector";

const finding = (severity: number, subject = "Hráč"): DriftFinding => ({
  subject,
  contradiction: "sesílá blesky, ale kánon říká, že magii neovládá",
  severity,
});

describe("parseDriftOutput", () => {
  it("parses a plain JSON array", () => {
    const raw = '[{"subject":"Hráč","contradiction":"létá","severity":0.8}]';
    const out = parseDriftOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subject).toBe("Hráč");
    expect(out[0].severity).toBe(0.8);
  });

  it("strips code fences and surrounding prose", () => {
    const raw = 'Tady je výsledek:\n```json\n[{"subject":"Arkos","contradiction":"mluví, ač je mrtvý","severity":0.9}]\n```';
    expect(parseDriftOutput(raw)).toHaveLength(1);
  });

  it("clamps severity to 0–1 and drops malformed entries", () => {
    const raw = '[{"subject":"A","contradiction":"x","severity":7},{"subject":"","contradiction":"y","severity":0.5},{"nonsense":true}]';
    const out = parseDriftOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe(1);
  });

  it("returns [] for garbage, empty input and non-arrays", () => {
    expect(parseDriftOutput("")).toEqual([]);
    expect(parseDriftOutput("žádný rozpor")).toEqual([]);
    expect(parseDriftOutput('{"subject":"x"}')).toEqual([]);
  });
});

describe("updateDriftScore", () => {
  it("rises with the worst finding via EMA", () => {
    const next = updateDriftScore(0, [finding(0.4), finding(0.8)]);
    expect(next).toBeCloseTo(DRIFT_EMA_ALPHA * 0.8);
  });

  it("decays toward zero on clean checks", () => {
    let score = 0.8;
    score = updateDriftScore(score, []);
    expect(score).toBeCloseTo(0.4);
    score = updateDriftScore(score, []);
    expect(score).toBeCloseTo(0.2);
  });

  it("stays within 0–1", () => {
    expect(updateDriftScore(1, [finding(1)])).toBeLessThanOrEqual(1);
    expect(updateDriftScore(0, [])).toBe(0);
  });
});

describe("buildCorrections", () => {
  it("keeps only findings at/above the threshold, worst first", () => {
    const out = buildCorrections([
      finding(DRIFT_SEVERITY_THRESHOLD - 0.1, "pod"),
      finding(0.9, "vysoká"),
      finding(DRIFT_SEVERITY_THRESHOLD, "přesně"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("vysoká");
    expect(out[1]).toContain("přesně");
  });

  it("caps the number of corrections", () => {
    const many = Array.from({ length: 10 }, (_, i) => finding(0.9, `s${i}`));
    expect(buildCorrections(many)).toHaveLength(DRIFT_MAX_CORRECTIONS);
  });
});

describe("mergeCorrections", () => {
  it("refreshes TTL of duplicates instead of stacking", () => {
    const existing = [{ text: "Hráč: neumí létat", ttl: 1 }];
    const merged = mergeCorrections(existing, ["Hráč: neumí létat"]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ttl).toBe(DRIFT_CORRECTION_TTL);
  });

  it("appends new corrections and re-caps the list", () => {
    const existing = Array.from({ length: DRIFT_MAX_CORRECTIONS }, (_, i) => ({
      text: `staré ${i}`,
      ttl: 2,
    }));
    const merged = mergeCorrections(existing, ["nové"]);
    expect(merged).toHaveLength(DRIFT_MAX_CORRECTIONS);
    expect(merged[merged.length - 1].text).toBe("nové");
    expect(merged.some((c) => c.text === "staré 0")).toBe(false);
  });
});
