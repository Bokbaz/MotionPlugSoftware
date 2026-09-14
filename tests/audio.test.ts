import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWav, mixSoundtrack, planSoundCues, type SampleBank } from "../src/audio/matched-sfx";
import { soundSamples } from "../src/audio/sample-catalog";
import { encodeWav } from "../src/audio/wav";
import { presets, valuesForPreset, computeDuration } from "../src/catalog/presets";

const bank: SampleBank = {};
for (const [id, sample] of Object.entries(soundSamples)) bank[id as keyof typeof soundSamples] = decodeWav(readFileSync(`assets/sfx/samples/${sample.file}`));

describe("recorded, animation-matched soundtracks", () => {
  it("loads real stereo recordings and produces a peak-safe PCM soundtrack for every preset", () => {
    for (const preset of presets) {
      const duration = computeDuration(preset.defaults, preset.duration);
      const cues = planSoundCues(preset, preset.defaults, duration);
      const channels = mixSoundtrack(cues, bank, duration, 100);
      expect(channels[0]!.length).toBe(Math.ceil(duration * 48000));
      let peak = 0;
      for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
      expect(peak, preset.name).toBeGreaterThan(0.005);
      expect(peak).toBeLessThanOrEqual(0.940001);
      const decoded = decodeWav(encodeWav(channels));
      expect(decoded.sampleRate).toBe(48000);
      expect(decoded.channels).toHaveLength(2);
      expect(decoded.channels[0]!.length).toBe(channels[0]!.length);
    }
  });

  it("follows word count and stagger without moving entrance sounds when hold changes", () => {
    const preset = presets.find((item) => item.family === "word-by-word")!;
    const values = valuesForPreset(preset.id, { title: "One [two three]", stagger: 0.3 });
    const cues = planSoundCues(preset, values, 5);
    expect(cues.map((cue) => cue.at)).toEqual([0.08, 0.38, 0.6799999999999999]);
    expect(planSoundCues(preset, { ...values, hold: 8 }, 10)).toEqual(cues);
    expect(planSoundCues(preset, { ...values, title: "One" }, 5)).toHaveLength(1);
  });

  it("moves replacement cues with phrase hold and keeps the first at the actual intro", () => {
    const preset = presets.find((item) => item.family === "rapid-replacement")!;
    const short = valuesForPreset(preset.id, { sequenceText: "ONE\nTWO\nTHREE", hold: 0.5 });
    const long = { ...short, hold: 1.5 };
    const a = planSoundCues(preset, short, computeDuration(short, 4));
    const b = planSoundCues(preset, long, computeDuration(long, 4));
    expect(a).toHaveLength(3);
    expect(a[0]!.at).toBe(b[0]!.at);
    expect(b[1]!.at).toBeGreaterThan(a[1]!.at);
  });

  it("respects mute, fades clip boundaries, and rejects missing samples", () => {
    const cues = [{ sample: "tap" as const, at: 0, gain: 1 }];
    expect(mixSoundtrack(cues, bank, 1, 0)[0]!.every((sample) => sample === 0)).toBe(true);
    const mixed = mixSoundtrack(cues, bank, 0.1, 100)[0]!;
    expect(mixed[0]).toBe(0);
    expect(mixed[mixed.length - 1]).toBe(0);
    expect(() => mixSoundtrack(cues, {}, 1, 100)).toThrow("Missing sound");
  });
});
