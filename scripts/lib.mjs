import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadCatalog(root) {
  const cacheDirectory = path.join(root, "build", ".script-cache");
  const output = path.join(cacheDirectory, `catalog-${Date.now()}.mjs`);
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: 'export { presets, computeDuration, valuesForPreset } from "./src/catalog/presets.ts"; export { planSoundCues, mixSoundtrack, decodeWav } from "./src/audio/matched-sfx.ts"; export { encodeWav } from "./src/audio/wav.ts"; export { soundSamples } from "./src/audio/sample-catalog.ts";',
      resolveDir: root,
      sourcefile: "motionplug-catalog-entry.ts",
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  const loaded = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  await rm(output, { force: true });
  return loaded;
}

export function slugPath(root, ...parts) {
  return path.join(root, ...parts);
}
