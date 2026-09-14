import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadCatalog } from "./lib.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-sfx.mjs <source-folder>");
const output = path.join(root, "assets", "sfx", "samples");
await mkdir(output, { recursive: true });
const files = await readdir(source, { recursive: true });
const { decodeWav, encodeWav } = await loadCatalog(root);
const selections = [
  ["airy", "ES_Classic, Airy -", 0.36, 2.3, "atempo=2.5", 0.92],
  ["deep", "ES_Short, Deep, Dry -", 0.25, 0.9, "anull", 0.9],
  ["wind", "ES_Organic, Wind", 0.05, 1.2, "anull", 1.2],
  ["tap", "ES_Button, Double Click", 0, 0.25, "anull", 0.25],
  ["select", "ES_Select, Smartphone", 0, 0.29, "anull", 0.29],
  ["complete", "ES_Completions, Melodic", 0, 0.42, "anull", 0.42],
  ["menu", "ES_Short, Computer", 0, 0.59, "anull", 0.59],
  ["pop", "ES_Software, Interface, Pop Up, Notification -", 0, 0.57, "anull", 0.57],
];
const samples = [];
for (const [id, prefix, start, duration, tempo, final] of selections) {
  const file = files.find((file) => path.basename(file).startsWith(prefix) && file.endsWith(".mp3"));
  if (!file) throw new Error(`Missing source recording: ${prefix}`);
  const destination = path.join(output, `${id}.wav`);
  const filters = `${tempo},afade=t=in:d=0.004,afade=t=out:st=${Math.max(0, final - 0.07)}:d=0.07`;
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-t", String(duration), "-i", path.join(source, file), "-af", filters, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", destination], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not prepare ${id}.`);
  const decoded = decodeWav(await readFile(destination));
  let peak = 0;
  for (const channel of decoded.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  const gain = peak ? 0.8 / peak : 1;
  for (const channel of decoded.channels) for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  await writeFile(destination, encodeWav(decoded.channels, decoded.sampleRate));
  samples.push({ id, source: file, startSeconds: start, sourceDuration: duration, processing: filters, peakNormalization: 0.8, output: `${id}.wav` });
}
await writeFile(path.join(root, "assets", "sfx", "sources.json"), JSON.stringify({ origin: path.basename(source), samples }, null, 2) + "\n");
console.log(`Prepared ${samples.length} recorded samples. Run npm run build:assets to refresh preset soundtracks.`);
