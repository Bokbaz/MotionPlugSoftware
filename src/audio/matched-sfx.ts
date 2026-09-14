import type { PresetDefinition, PresetValues } from "../catalog/types";
import { plainText } from "../renderer/highlights";
import { soundSamples, type SoundSampleId } from "./sample-catalog";
import { encodeWav } from "./wav";

export interface AudioSample { channels: Float32Array[]; sampleRate: number }
export interface SoundCue { sample: SoundSampleId; at: number; gain: number; length?: number }
export type SampleBank = Partial<Record<SoundSampleId, AudioSample>>;
const sampleRate = 48_000;

// Times are seconds in the renderer's animation phases, never a fraction of the hold.
export function planSoundCues(preset: PresetDefinition, values: PresetValues, duration: number): SoundCue[] {
  const entrance = Number(values.entrance ?? 0.55);
  const exit = Number(values.exit ?? 0.5);
  const stagger = Number(values.stagger ?? 0.14);
  const cues: SoundCue[] = [];
  const add = (at: number, gain = 0.55, sample = preset.sfx.sample, length?: number) => cues.push({ sample, at, gain, length });
  const words = (limit: number) => plainText(String(values.title ?? "")).trim().split(/\s+/).filter(Boolean).slice(0, limit).length;
  switch (preset.family) {
    case "word-by-word":
      for (let i = 0; i < words(14); i++) add(0.08 + i * stagger, 0.38);
      break;
    case "rapid-replacement": {
      const count = Math.min(8, String(values.sequenceText ?? "").split("\n").filter(Boolean).length);
      const intro = Math.min(0.14, entrance * 0.22);
      const slot = Math.max(0.4, duration - exit - intro) / Math.max(1, count);
      for (let i = 0; i < count; i++) add(i === 0 ? intro : intro + (i - 1 + (preset.variant === "swaps" ? 0.7 : 0.76)) * slot, 0.55);
      break;
    }
    case "soft-focus":
      if (preset.variant === "words") for (let i = 0; i < words(10); i++) add(0.04 + i * stagger, 0.3);
      else add(0, 0.5, "wind", 0.94);
      break;
    case "feature-stack": {
      const count = Math.min(7, String(values.itemsText ?? "").split("\n").filter(Boolean).length);
      for (let i = 0; i < count; i++) add(preset.variant === "active" ? (i === 0 ? 0.28 : 0.48 + (i - 1 + 0.58) * Math.max(stagger, 0.15)) : 0.16 + i * stagger, 0.36);
      break;
    }
    case "bento-summary":
      for (let i = 0; i < 4; i++) add(0.05 + i * stagger * 1.22, 0.42);
      break;
    case "keyword-emphasis":
      if (String(values.title ?? "").includes("[")) add(entrance * 0.62, 0.55);
      break;
    case "headline-layout-transition": add(0, 0.4, "airy", entrance); add(entrance * 0.68, 0.5, "airy", 1.05); break;
    case "product-callout": add(0.02, 0.4); add(0.48, 0.42, "pop"); break;
    case "performance-comparison": add(0.2, 0.45); add(preset.variant === "bars" ? 0.36 : 0.3, 0.45); break;
    case "price-availability": add(0.05 + stagger, 0.55); add(0.05 + stagger * 2, 0.35, "select"); break;
    case "light-sweep": {
      const start = entrance * 0.5;
      const length = Math.max(0.7, duration - exit - start);
      const loops = preset.variant === "loop" || values.loop ? 2 : 1;
      for (let i = 0; i < loops; i++) add(start + (i + 0.25) * length / loops, 0.5, "wind", length / loops * 0.5);
      break;
    }
    case "specification-reveal":
      if (preset.variant === "count" && values.countEnabled) {
        for (let i = 0; i < 5; i++) add(0.05 + i * 0.18, 0.25);
        add(0.95, 0.45, "complete");
      } else add(0, 0.65, "deep");
      break;
    case "presenter-title": add(0.04, 0.38, "airy", entrance + 0.08); break;
    case "masked-line-reveal": add(0, 0.5, "airy", entrance + 0.5); break;
    default: add(0, 0.6, preset.sfx.sample, preset.sfx.sample === "airy" ? entrance : undefined);
  }
  return cues.filter((cue) => cue.at >= 0 && cue.at < duration - exit);
}

export function decodeWav(bytes: Uint8Array): AudioSample {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("Invalid bundled sound file.");
  let channels = 0, rate = 0, bits = 0, format = 0, dataOffset = 0, dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) throw new Error("Truncated bundled sound file.");
    if (text(offset, 4) === "fmt ") {
      format = view.getUint16(offset + 8, true); channels = view.getUint16(offset + 10, true);
      rate = view.getUint32(offset + 12, true); bits = view.getUint16(offset + 22, true);
    } else if (text(offset, 4) === "data") { dataOffset = offset + 8; dataLength = size; }
    offset += 8 + size + size % 2;
  }
  if (format !== 1 || bits !== 16 || channels < 1 || channels > 2 || !rate || !dataOffset) throw new Error("Bundled sounds must be mono/stereo 16-bit PCM.");
  const length = Math.floor(dataLength / (channels * 2));
  const result = Array.from({ length: channels }, () => new Float32Array(length));
  for (let i = 0; i < length; i++) for (let channel = 0; channel < channels; channel++) {
    result[channel]![i] = view.getInt16(dataOffset + (i * channels + channel) * 2, true) / 32768;
  }
  return { channels: result, sampleRate: rate };
}

export function mixSoundtrack(cues: SoundCue[], bank: SampleBank, duration: number, volume: number): Float32Array[] {
  const frames = Math.max(1, Math.ceil(duration * sampleRate));
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const level = Math.max(0, Math.min(1, volume / 100));
  for (const cue of cues) {
    const sample = bank[cue.sample];
    if (!sample) throw new Error(`Missing sound: ${soundSamples[cue.sample].label}. Reinstall Motion Plug's sound assets.`);
    const naturalLength = sample.channels[0]!.length / sample.sampleRate;
    const rate = cue.length ? Math.min(2, Math.max(0.65, naturalLength / cue.length)) : 1;
    const length = naturalLength / rate;
    const start = Math.round(cue.at * sampleRate);
    const count = Math.min(frames - start, Math.ceil(length * sampleRate));
    for (let i = 0; i < count; i++) {
      const position = i * sample.sampleRate / sampleRate * rate;
      const index = Math.floor(position);
      const fraction = position - index;
      const fade = Math.min(1, i / 144, (count - i - 1) / 720);
      for (let channel = 0; channel < 2; channel++) {
        const input = sample.channels[channel % sample.channels.length]!;
        const value = (input[index] ?? 0) * (1 - fraction) + (input[index + 1] ?? 0) * fraction;
        output[channel]![start + i] = (output[channel]![start + i] ?? 0) + value * cue.gain * fade;
      }
    }
  }
  let peak = 0;
  for (const channel of output) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  const gain = (peak > 0.94 ? 0.94 / peak : 1) * level;
  for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
  return output;
}

const cache = new Map<SoundSampleId, Promise<AudioSample>>();
function loadSample(id: SoundSampleId): Promise<AudioSample> {
  if (!cache.has(id)) cache.set(id, new Promise<AudioSample>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", `sfx/samples/${soundSamples[id].file}`);
    request.responseType = "arraybuffer";
    request.onload = () => {
      try {
        if (!request.response || (request.status !== 0 && request.status !== 200)) throw new Error("Missing sound asset");
        resolve(decodeWav(new Uint8Array(request.response as ArrayBuffer)));
      } catch (error) { cache.delete(id); reject(error); }
    };
    request.onerror = request.ontimeout = () => { cache.delete(id); reject(new Error(`Could not load ${soundSamples[id].label}. Reinstall Motion Plug's sound assets.`)); };
    request.timeout = 15000;
    request.send();
  }));
  return cache.get(id)!;
}

export async function createSoundtrack(preset: PresetDefinition, values: PresetValues, duration: number, volume: number): Promise<Uint8Array> {
  const cues = planSoundCues(preset, values, duration);
  const bank: SampleBank = {};
  await Promise.all([...new Set(cues.map((cue) => cue.sample))].map(async (id) => { bank[id] = await loadSample(id); }));
  return encodeWav(mixSoundtrack(cues, bank, duration, volume), sampleRate);
}
