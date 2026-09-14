import { describe, expect, it } from "vitest";
import { candidateIndexes, isRangeFree, overlaps, planDestination } from "../src/premiere/planner";

describe("timeline destination planner", () => {
  const wanted = { start: 10, end: 14 };

  it("treats adjacent edits as safe and real intersections as occupied", () => {
    expect(overlaps(wanted, { start: 4, end: 10 })).toBe(false);
    expect(overlaps(wanted, { start: 14, end: 20 })).toBe(false);
    expect(overlaps(wanted, { start: 13.99, end: 20 })).toBe(true);
  });

  it("chooses the highest free existing video track", () => {
    const plan = planDestination([
      { index: 0, ranges: [{ start: 0, end: 20 }] },
      { index: 1, ranges: [{ start: 0, end: 8 }] },
      { index: 2, ranges: [{ start: 20, end: 30 }] },
    ], wanted, { mode: "auto", index: 0 });
    expect(plan).toEqual({ index: 2, createsTrack: false, lockStateKnown: false });
  });

  it("creates a track when every existing destination is blocked", () => {
    const plan = planDestination([
      { index: 0, ranges: [{ start: 9, end: 16 }] },
      { index: 1, ranges: [], locked: true },
    ], wanted, { mode: "auto", index: 0 });
    expect(plan.index).toBe(2);
    expect(plan.createsTrack).toBe(true);
  });

  it("never overwrites a specifically selected occupied track", () => {
    expect(() => planDestination([
      { index: 0, ranges: [{ start: 11, end: 12 }] },
    ], wanted, { mode: "specific", index: 0 })).toThrow(/occupied/);
  });

  it("can ignore the clip being atomically replaced", () => {
    const track = { index: 0, ranges: [{ start: 10, end: 13, id: "old" }, { start: 18, end: 20, id: "other" }] };
    expect(isRangeFree(track, wanted, ["old"])).toBe(true);
  });

  it("retries a fresh track only for automatic policy", () => {
    const auto = candidateIndexes({ index: 1, createsTrack: false, lockStateKnown: false }, 3, { mode: "auto", index: 0 });
    const fixed = candidateIndexes({ index: 1, createsTrack: false, lockStateKnown: false }, 3, { mode: "specific", index: 1 });
    expect(auto).toEqual([1, 3]);
    expect(fixed).toEqual([1]);
  });
});
