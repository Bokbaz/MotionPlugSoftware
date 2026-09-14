import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "build", "feature-review");
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.MOTIONPLUG_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const OriginalAudio = window.Audio;
    window.Audio = function (...args) { const audio = new OriginalAudio(...args); window.testAudio = audio; return audio; };
  });
  const click = async (selector) => {
    await page.$eval(selector, (element) => element.scrollIntoView({ block: "center" }));
    await page.click(selector);
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 390, height: 820 });
  await page.goto(pathToFileURL(path.join(root, "dist", "index.html")).href);
  await page.waitForSelector(".preset-family");
  assert.equal(await page.$$eval(".preset-family", (items) => items.length), 15);
  await page.select("[data-category]", "Effects");
  assert.equal(await page.$$eval(".preset-card", (items) => items.length), 4);
  await page.select("[data-category]", "all");
  await click(".preset-card__select");
  await page.waitForSelector(".preview-host.is-ready");
  const frame = () => page.frames().find((frame) => frame.url().endsWith("renderer.html"));
  await page.$eval('[data-control="title"]', (input) => { input.value = "Keep [this] this"; input.dispatchEvent(new Event("input")); });
  await click('[data-variant="motionplug.hero.editorial.v1"]');
  await page.waitForSelector(".preview-host.is-ready");
  assert.equal(await frame().evaluate(() => window.motionPlugRenderer.getConfig().values.positionX), 10);
  assert.equal(await frame().evaluate(() => window.motionPlugRenderer.getConfig().values.title), "Keep [this] this");
  await click('[data-variant="motionplug.hero.centered.v1"]');
  await page.waitForSelector(".preview-host.is-ready");
  await click('[data-section="type"] .control-section__heading');
  await click('[data-color-picker="accentColor"]');
  await page.waitForSelector(".color-editor canvas");
  const plane = await page.$(".color-editor canvas");
  const rect = await plane.boundingBox();
  await page.mouse.click(rect.x + rect.width * 0.8, rect.y + rect.height * 0.25);
  const picked = await page.$eval('[data-control="accentColor"]', (input) => input.value);
  assert.notEqual(picked, "#8CA8FF");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.$eval('[data-control="accentColor"]', (input) => input.value), picked);
  await page.screenshot({ path: path.join(output, "interactive-color-picker.png"), fullPage: true });
  await click(".color-editor button");
  await page.$eval('[data-color-picker="accentColor"]', (input) => { input.value = "#ff3300"; input.dispatchEvent(new Event("input")); });
  await page.waitForFunction(() => document.querySelector('[data-control="accentColor"]').value === "#ff3300");
  await frame().waitForFunction(() => window.motionPlugRenderer.getConfig().values.title === "Keep [this] this");
  await page.screenshot({ path: path.join(output, "color-and-type.png"), fullPage: true });
  const font = await page.$("[data-font-file]");
  await font.uploadFile(process.env.MOTIONPLUG_TEST_TTF ?? "/System/Library/Fonts/Supplemental/Arial.ttf");
  await page.waitForFunction(() => document.querySelector('[data-control="fontFamily"]').value.startsWith("MotionPlugCustom-"));
  await page.waitForSelector(".preview-host.is-ready");
  const ttfFamily = await frame().evaluate(() => window.motionPlugRenderer.getConfig().values.fontFamily);
  assert.ok(ttfFamily.startsWith("MotionPlugCustom-"));
  assert.ok(await frame().evaluate(() => document.fonts.check(`16px "${window.motionPlugRenderer.getConfig().values.fontFamily}"`)));
  await click("[data-save-variation]");
  await page.waitForSelector("[data-confirm-variation]", { timeout: 3000 });
  await click("[data-confirm-variation]");
  await page.reload();
  await click('[data-scope="variations"]');
  await click("[data-variation]");
  await page.waitForSelector(".preview-host.is-ready");
  assert.equal(await frame().evaluate(() => window.motionPlugRenderer.getConfig().values.fontFamily), ttfFamily);
  const otf = await page.$("[data-font-file]");
  await otf.uploadFile(process.env.MOTIONPLUG_TEST_OTF ?? "/System/Library/Fonts/Supplemental/STIXGeneralBol.otf");
  await page.waitForFunction((old) => document.querySelector('[data-control="fontFamily"]').value !== old, {}, ttfFamily);
  await page.waitForSelector(".preview-host.is-ready");
  await click("[data-audition]");
  await page.waitForFunction(() => document.querySelector('[data-preview-play]').getAttribute("aria-label") === "Pause preview");
  const sync = await page.evaluate(() => ({ audio: window.testAudio.currentTime, visual: Number(document.querySelector("[data-preview-scrub]").value), paused: window.testAudio.paused }));
  assert.equal(sync.paused, false);
  assert.ok(Math.abs(sync.audio - sync.visual) < 0.2, JSON.stringify(sync));
  await click("[data-preview-play]");
  assert.equal(await page.evaluate(() => window.testAudio.paused), true);
  assert.equal(await page.$eval('#toast-region', (region) => region.textContent.includes("Could not")), false);
  // Pixel-level check: old opaque settings cannot paint a background; brackets are not rendered.
  const pixels = await frame().evaluate(async () => {
    const renderer = window.motionPlugRenderer;
    const config = renderer.getConfig();
    await renderer.configure({ ...config, renderMode: "export", background: "transparent", width: 960, height: 540, values: { ...config.values, title: "Keep [this] this", textColor: "#f7f7f2", accentColor: "#ff3300", transparentBackground: false, backgroundColor: "#00ff00" } });
    renderer.renderAt(1.8);
    const canvas = document.querySelector("canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, opaque = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3] > 0) opaque++; if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 60 && data[i + 3] > 150) red++; }
    return { cornerAlpha: data[3], red, opaque, total: canvas.width * canvas.height };
  });
  assert.equal(pixels.cornerAlpha, 0);
  assert.ok(pixels.red > 50, JSON.stringify(pixels));
  assert.ok(pixels.opaque < pixels.total * 0.3);
  await page.screenshot({ path: path.join(output, "custom-font.png"), fullPage: true });
  const host = await browser.newPage();
  await host.evaluateOnNewDocument(() => {
    window.testSize = [2048, 858];
    window.__adobe_cep__ = {
      evalScript(script, callback) {
        callback(script === "MP_timelineContext()" && window.testSize
          ? `OK|25|${window.testSize[0]}|${window.testSize[1]}|0|sequence-${window.testSize[0]}||Test|Timeline`
          : "ERR|No active sequence");
      },
      getSystemPath() { return ""; },
    };
  });
  await host.setViewport({ width: 390, height: 820 });
  await host.goto(pathToFileURL(path.join(root, "dist", "index.html")).href);
  await host.click(".preset-card__select");
  await host.waitForSelector(".preview-host.is-ready");
  await host.waitForFunction(() => document.querySelector("[data-timeline-size]").textContent.includes("2048 × 858"));
  await host.evaluate(() => { window.testSize = [1080, 1920]; window.dispatchEvent(new Event("focus")); });
  await host.waitForFunction(() => document.querySelector("[data-timeline-size]").textContent.includes("1080 × 1920"));
  const hostFrame = host.frames().find((frame) => frame.url().endsWith("renderer.html"));
  const dimensions = await hostFrame.evaluate(() => ({ width: window.motionPlugRenderer.getConfig().width, height: window.motionPlugRenderer.getConfig().height }));
  assert.deepEqual(dimensions, { width: 540, height: 960 });
  await host.evaluate(() => { window.testSize = null; window.dispatchEvent(new Event("focus")); });
  await host.waitForFunction(() => document.querySelector("[data-add]").disabled && document.querySelector("[data-timeline-size]").textContent.includes("Open an active sequence"));
  await host.close();
  assert.deepEqual(errors, []);
  console.log("Feature smoke passed: category navigation, live color, TTF/OTF import, persistence, bracket colors, transparent export, and synchronized SFX.");
} finally { await browser.close(); }
