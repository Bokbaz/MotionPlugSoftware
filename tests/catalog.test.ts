import { planSoundCues } from "../src/audio/matched-sfx";
import { describe, expect, it } from "vitest";
import { computeDuration, presets, valuesForPreset } from "../src/catalog/presets";
import { controlRegistry } from "../src/catalog/controls";

describe("preset catalog", () => {
  it("ships exactly two variants for each of 15 families", () => {
    const families = new Map<string, string[]>();
    for (const preset of presets) {
      families.set(preset.family, [...(families.get(preset.family) ?? []), preset.variant]);
    }
    expect(presets).toHaveLength(30);
    expect(families.size).toBe(15);
    for (const variants of families.values()) {
      expect(variants).toHaveLength(2);
      expect(new Set(variants).size).toBe(2);
    }
  });

  it("uses stable unique versioned identifiers and valid controls", () => {
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.id).toMatch(/^motionplug\.[a-z-]+\.[a-z-]+\.v\d+$/);
      expect(preset.description.length).toBeGreaterThan(30);
      expect(preset.tags.length).toBeGreaterThanOrEqual(4);
      expect(preset.controls.length).toBeGreaterThan(8);
      for (const control of preset.controls) expect(controlRegistry[control], `${preset.id}: ${control}`).toBeDefined();
      for (const cue of planSoundCues(preset, preset.defaults, computeDuration(preset.defaults, preset.duration))) {
        expect(cue.at).toBeGreaterThanOrEqual(0);
        expect(cue.at).toBeLessThan(computeDuration(preset.defaults, preset.duration));
        expect(cue.gain).toBeGreaterThan(0);
        expect(cue.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it("merges defaults without mutating the catalog", () => {
    const id = presets[0]!.id;
    const first = valuesForPreset(id, { title: "Étude — 東京" });
    const second = valuesForPreset(id);
    expect(first.title).toBe("Étude — 東京");
    expect(second.title).not.toBe(first.title);
  });

  it("scales rapid replacement duration with each phrase hold", () => {
    const values = valuesForPreset("motionplug.replace.cuts.v1", {
      sequenceText: "ONE\nTWO\nTHREE",
      entrance: 0.5,
      hold: 0.8,
      exit: 0.4,
    });
    expect(computeDuration(values, 4)).toBeCloseTo(3.3);
  });
});
