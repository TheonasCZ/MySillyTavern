import { describe, expect, it } from "vitest";

import { buildRenderSegments, computeVisibleWindow } from "./virtualWindow";

describe("computeVisibleWindow", () => {
  it("returns the whole range for an empty array", () => {
    expect(computeVisibleWindow([], 0, 600, 10)).toEqual({ start: 0, end: 0 });
  });

  it("centers the window on the viewport when all heights are known and uniform", () => {
    // 100 items of height 100 => item i spans [i*100, i*100+100).
    const heights = Array.from({ length: 100 }, () => 100);
    // Viewport [500, 1100) intersects items 5..10 inclusive.
    const w = computeVisibleWindow(heights, 500, 600, 0);
    expect(w).toEqual({ start: 5, end: 11 });
  });

  it("pads the window by the overscan count on both sides", () => {
    const heights = Array.from({ length: 100 }, () => 100);
    const w = computeVisibleWindow(heights, 500, 600, 3);
    expect(w).toEqual({ start: 2, end: 14 });
  });

  it("clamps to the array bounds at the edges", () => {
    const heights = Array.from({ length: 20 }, () => 100);
    expect(computeVisibleWindow(heights, 0, 600, 10)).toEqual({ start: 0, end: 16 });
    expect(computeVisibleWindow(heights, 1900, 600, 10)).toEqual({ start: 9, end: 20 });
  });

  it("falls back to the estimated height for unmeasured items", () => {
    // First 5 items unmeasured (estimated 140 each = 700px), then 10 known
    // at 50px each. Viewport starting at 750 should land just past the
    // unmeasured run, inside the known items.
    const heights: (number | undefined)[] = [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ...Array.from({ length: 10 }, () => 50),
    ];
    const w = computeVisibleWindow(heights, 750, 100, 0, 140);
    // offset after 5 unmeasured @140 = 700; item 5 spans [700,750) so
    // viewport [750, 850) starts at item 6.
    expect(w.start).toBe(6);
  });

  it("handles a scrollTop beyond the last item without throwing", () => {
    const heights = [100, 100, 100];
    const w = computeVisibleWindow(heights, 10000, 600, 5);
    expect(w).toEqual({ start: 0, end: 3 });
  });
});

describe("buildRenderSegments", () => {
  it("produces a single items segment when everything is inside the window", () => {
    const heights = [10, 20, 30];
    const segments = buildRenderSegments(heights, { start: 0, end: 3 });
    expect(segments).toEqual([{ kind: "items", start: 0, end: 3 }]);
  });

  it("produces top spacer / window / bottom spacer for a fully-measured array", () => {
    const heights = Array.from({ length: 20 }, () => 10);
    const segments = buildRenderSegments(heights, { start: 8, end: 12 });
    expect(segments).toEqual([
      { kind: "spacer", start: 0, end: 8, height: 80 },
      { kind: "items", start: 8, end: 12 },
      { kind: "spacer", start: 12, end: 20, height: 80 },
    ]);
  });

  it("never folds an unmeasured item into a spacer, even outside the window", () => {
    const heights: (number | undefined)[] = [10, 10, undefined, 10, 10, 10, 10, 10];
    // Window is at the end (e.g. scrolled to bottom); index 2 is
    // unmeasured and outside the window, so it must still get its own
    // "items" segment rather than being silently estimated away.
    const segments = buildRenderSegments(heights, { start: 6, end: 8 });
    expect(segments).toEqual([
      { kind: "spacer", start: 0, end: 2, height: 20 },
      { kind: "items", start: 2, end: 3 },
      { kind: "spacer", start: 3, end: 6, height: 30 },
      { kind: "items", start: 6, end: 8 },
    ]);
  });

  it("sums only measured heights, in order, for a spacer segment", () => {
    const heights = [5, 15, 25, 35];
    const segments = buildRenderSegments(heights, { start: 4, end: 4 });
    expect(segments).toEqual([{ kind: "spacer", start: 0, end: 4, height: 80 }]);
  });

  it("handles an empty array", () => {
    expect(buildRenderSegments([], { start: 0, end: 0 })).toEqual([]);
  });

  it("handles a window past the end of the array", () => {
    const heights = [10, 10];
    const segments = buildRenderSegments(heights, { start: 5, end: 9 });
    expect(segments).toEqual([{ kind: "spacer", start: 0, end: 2, height: 20 }]);
  });
});
