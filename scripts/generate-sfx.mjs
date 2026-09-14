import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./lib.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "assets", "sfx");
const { presets, computeDuration, planSoundCues, mixSoundtrack, decodeWav, encodeWav, soundSamples } = await loadCatalog(root);
await mkdir(output, { recursive: true });
const bank = {};
for (const [id, sample] of Object.entries(soundSamples)) bank[id] = decodeWav(await readFile(path.join(output, "samples", sample.file)));
for (const preset of presets) {
  const duration = computeDuration(preset.defaults, preset.duration);
  const cues = planSoundCues(preset, preset.defaults, duration);
  await writeFile(path.join(output, `${preset.id}.wav`), encodeWav(mixSoundtrack(cues, bank, duration, Number(preset.defaults.sfxVolume))));
  console.log(`SFX ${preset.name}: ${preset.sfx.label}, ${cues.length} timed cues`);
}
