// M11 §2 — pure windowing math for MessageList's history virtualization.
// Kept dependency-free and DOM-free on purpose: MessageList.tsx owns the
// scroll listener + height measurement (callback refs, same pattern as its
// existing pin/anchor logic); this module only turns
// (scrollTop, per-item heights) into "which indices to render fully" and
// then into render segments (contiguous full-render runs vs. spacer runs).

/** Default height used for scroll-math purposes when an item has never
 * been measured. Only affects *where* the window lands — never affects a
 * spacer's rendered height, since spacers only ever sum *measured*
 * heights (see `buildRenderSegments`). */
export const DEFAULT_ESTIMATED_HEIGHT = 140;

export interface WindowRange {
  /** Inclusive. */
  start: number;
  /** Exclusive. */
  end: number;
}

/** Finds the index range [start, end) that should be fully rendered: the
 * items intersecting the viewport, padded by `overscan` items on each
 * side. `heights[i] === undefined` (never measured) falls back to
 * `estimatedHeight` for this scroll-math pass only. */
export function computeVisibleWindow(
  heights: ReadonlyArray<number | undefined>,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
  estimatedHeight: number = DEFAULT_ESTIMATED_HEIGHT,
): WindowRange {
  const count = heights.length;
  if (count === 0) return { start: 0, end: 0 };

  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;

  let offset = 0;
  let firstVisible = -1;
  let lastVisible = count - 1;
  for (let i = 0; i < count; i++) {
    const h = heights[i] ?? estimatedHeight;
    const top = offset;
    const bottom = offset + h;
    if (firstVisible === -1 && bottom > viewTop) {
      firstVisible = i;
    }
    if (top >= viewBottom) {
      lastVisible = i - 1;
      offset = bottom;
      break;
    }
    offset = bottom;
  }
  if (firstVisible === -1) firstVisible = count - 1;
  if (lastVisible < firstVisible) lastVisible = firstVisible;

  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, lastVisible + overscan + 1);
  return { start, end };
}

export interface Segment {
  kind: "spacer" | "items";
  /** Inclusive start index into the source array. */
  start: number;
  /** Exclusive end index into the source array. */
  end: number;
  /** Only set for "spacer" segments: sum of the *measured* heights of the
   * items it replaces. Items with an unknown height are never folded into
   * a spacer (see below), so this sum is always exact, never estimated. */
  height?: number;
}

/** Turns a flat per-item height array + a "always render fully" window
 * into an ordered list of render segments.
 *
 * An item is force-rendered (kept out of any spacer) when either:
 *   - it falls inside `window` (the visible range ± overscan), or
 *   - its height has never been measured (`heights[i] === undefined`) —
 *     rendering it is the only way to measure it, so it can't be
 *     folded into a spacer whose height must stay exact.
 *
 * Everything else collapses into "spacer" runs sized by the sum of their
 * measured heights. In the common case (window is contiguous and
 * everything outside it has already been measured at least once) this
 * yields exactly one leading spacer and one trailing spacer, matching the
 * "top placeholder / bottom placeholder" shape — but the algorithm
 * generalizes to N segments so a freshly-appended, not-yet-measured batch
 * (e.g. right after "load older") never gets silently mis-sized.
 */
export function buildRenderSegments(
  heights: ReadonlyArray<number | undefined>,
  window: WindowRange,
): Segment[] {
  const count = heights.length;
  const segments: Segment[] = [];
  let i = 0;
  while (i < count) {
    const forceFull = i >= window.start && i < window.end;
    const unmeasured = heights[i] === undefined;
    if (forceFull || unmeasured) {
      const start = i;
      while (i < count && ((i >= window.start && i < window.end) || heights[i] === undefined)) {
        i++;
      }
      segments.push({ kind: "items", start, end: i });
    } else {
      const start = i;
      let height = 0;
      while (
        i < count &&
        !(i >= window.start && i < window.end) &&
        heights[i] !== undefined
      ) {
        height += heights[i] as number;
        i++;
      }
      segments.push({ kind: "spacer", start, end: i, height });
    }
  }
  return segments;
}
