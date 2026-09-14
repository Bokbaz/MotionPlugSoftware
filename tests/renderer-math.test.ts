import { describe, expect, it } from "vitest";
import {
  aspectDimensions,
  clamp,
  easeInOutCubic,
  easeInQuart,
  easeOutBack,
  easeOutQuart,
  easeOutQuint,
  settledScale,
} from "../src/renderer/core";

describe("renderer timing and layout primitives", () => {
  it("returns exact landscape, portrait, and square frames", () => {
    expect(aspectDimensions("16:9", 1920)).toEqual({ width: 1920, height: 1080 });
    expect(aspectDimensions("9:16", 1920)).toEqual({ width: 1080, height: 1920 });
    expect(aspectDimensions("1:1", 1080)).toEqual({ width: 1080, height: 1080 });
  });

  it("keeps easing endpoints stable and monotonic", () => {
    for (const easing of [easeOutQuint, easeOutQuart, easeInQuart, easeInOutCubic]) {
      expect(easing(-1)).toBe(0);
      expect(easing(2)).toBe(1);
      let previous = 0;
      for (let step = 0; step <= 100; step += 1) {
        const current = easing(step / 100);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
    expect(clamp(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("keeps physical settles restrained and returns exactly to rest", () => {
    expect(easeOutBack(0)).toBe(0);
    expect(easeOutBack(1)).toBe(1);
    expect(settledScale(0, 0.9, 0.012)).toBeCloseTo(0.9);
    expect(settledScale(1, 0.9, 0.012)).toBe(1);

    const samples = Array.from({ length: 101 }, (_, index) => settledScale(index / 100, 0.9, 0.012));
    const peak = Math.max(...samples);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(1.0121);
    expect(samples[samples.length - 1]).toBe(1);
  });
});
