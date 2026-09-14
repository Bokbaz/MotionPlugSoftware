import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "assets", "icons");
await mkdir(output, { recursive: true });
for (const [name, size] of [["panel-dark", 23], ["panel-light", 23], ["plugin", 48]]) {
  for (const scale of [1, 2]) {
    const destination = path.join(output, `${name}@${scale}x.png`);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(output, "motionplug-logo.png"), "-vf", `scale=${size * scale}:${size * scale}:flags=lanczos`, "-frames:v", "1", destination], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Could not size the supplied Motion Plug logo.");
    if (scale === 1) await copyFile(destination, path.join(output, `${name}.png`));
  }
}
