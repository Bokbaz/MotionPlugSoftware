import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { loadCatalog } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "assets", "previews");
const rendererUrl = pathToFileURL(path.join(root, "dist", "renderer.html")).href;
const chromeCandidates = [
  process.env.MOTIONPLUG_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => {
  try { return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0; } catch { return false; }
});
if (!executablePath) throw new Error("Google Chrome or Chromium is required to render preview assets. Set MOTIONPLUG_CHROME to its executable.");

const catalog = await loadCatalog(root);
const requestedIds = new Set((process.env.MOTIONPLUG_PREVIEW_IDS ?? "").split(",").filter(Boolean));
const presets = requestedIds.size ? catalog.presets.filter((preset) => requestedIds.has(preset.id)) : catalog.presets;
const { computeDuration } = catalog;
if (!presets.length) throw new Error("MOTIONPLUG_PREVIEW_IDS did not match any installed preset.");
await mkdir(output, { recursive: true });
const tempRoot = await mkdir(path.join(os.tmpdir(), `motionplug-previews-${process.pid}`), { recursive: true }).then(() => path.join(os.tmpdir(), `motionplug-previews-${process.pid}`));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--allow-file-access-from-files", "--disable-gpu-sandbox", "--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  await page.goto(rendererUrl, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.motionPlugRenderer), { timeout: 15_000 });
  const fps = 24;
  for (let presetIndex = 0; presetIndex < presets.length; presetIndex += 1) {
    const preset = presets[presetIndex];
    const duration = computeDuration(preset.defaults, preset.duration);
    const config = {
      presetId: preset.id,
      values: preset.defaults,
      width: 640,
      height: 360,
      duration,
      background: "dark",
      renderMode: "preview",
    };
    await page.evaluate(async (next) => window.motionPlugRenderer.configure(next), config);
    const temp = path.join(tempRoot, preset.id);
    await mkdir(temp, { recursive: true });
    const total = Math.ceil(duration * fps);
    for (let frame = 0; frame < total; frame += 1) {
      const dataUrl = await page.evaluate((time) => {
        window.motionPlugRenderer.renderAt(time);
        return window.motionPlugRenderer.dataUrl();
      }, frame / fps);
      await writeFile(path.join(temp, `frame_${String(frame).padStart(6, "0")}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
    }
    let posterTime = Math.min(duration * 0.58, duration - Number(preset.defaults.exit ?? 0.5) - 0.08);
    if (preset.family === "rapid-replacement") {
      const count = String(preset.defaults.sequenceText ?? "").split("\n").filter(Boolean).length || 1;
      const available = duration - Number(preset.defaults.exit ?? 0.5) - 0.08;
      posterTime = 0.08 + available * (Math.floor(count / 2) + 0.5) / count;
    } else if (preset.family === "light-sweep") {
      const start = Number(preset.defaults.entrance ?? 0.55) * 0.5;
      const available = duration - Number(preset.defaults.exit ?? 0.5) - start;
      posterTime = start + available * (preset.variant === "loop" ? 0.25 : 0.5);
    }
    const poster = await page.evaluate((time) => {
      window.motionPlugRenderer.renderAt(time);
      const canvas = document.querySelector("canvas");
      return canvas.toDataURL("image/jpeg", 0.9);
    }, posterTime);
    await writeFile(path.join(output, `${preset.id}.jpg`), Buffer.from(poster.split(",")[1], "base64"));
    const ffmpeg = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", String(fps),
      "-i", path.join(temp, "frame_%06d.png"),
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      path.join(output, `${preset.id}.mp4`),
    ], { stdio: "inherit" });
    if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed for ${preset.id}.`);
    await rm(temp, { recursive: true, force: true });
    console.log(`[${presetIndex + 1}/${presets.length}] Preview ${preset.id} (${total} exact-source frames)`);
  }
} finally {
  await browser.close();
  await rm(tempRoot, { recursive: true, force: true });
}
