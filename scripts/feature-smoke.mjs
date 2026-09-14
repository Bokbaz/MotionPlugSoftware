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

  /* Account gate. A real panel has Node, so the sign-in overlay appears on a
   * machine that has never signed in, gates the timeline actions, and clears
   * once the server returns an activation. cep_node.require is shimmed with
   * just enough of Node for the license module, and https is answered from a
   * queue so no request leaves the machine. */
  const account = await browser.newPage();
  const accountErrors = [];
  account.on("pageerror", (error) => accountErrors.push(error.message));
  await account.evaluateOnNewDocument(() => {
    window.__adobe_cep__ = {
      evalScript(script, callback) {
        callback(script === "MP_timelineContext()" ? "OK|25|1920|1080|0|sequence-1||Test|Timeline" : "ERR|No active sequence");
      },
      getSystemPath() { return ""; },
    };
    // Buffer is a Node global inside a CEP panel; the license module builds
    // its request body with it.
    window.Buffer = { from: (value) => ({ length: value.length, toString: () => value }) };
    const files = new Map();
    const modules = {
      fs: {
        existsSync: (target) => files.has(target) || target === "/home/user" || target === "/home/user/.motionplug",
        mkdirSync() {},
        readFileSync(target) { if (!files.has(target)) throw new Error("ENOENT"); return files.get(target); },
        writeFileSync(target, value) { files.set(target, value); },
        unlinkSync(target) { files.delete(target); },
      },
      path: {
        join: (...parts) => parts.join("/"),
        dirname: (value) => value.split("/").slice(0, -1).join("/") || "/",
      },
      os: { homedir: () => "/home/user", hostname: () => "studio.local", platform: () => "darwin" },
      crypto: {
        randomBytes: () => ({ toString: () => "a".repeat(64) }),
        createHash: () => { const hash = { update: () => hash, digest: () => "e".repeat(64) }; return hash; },
      },
      url: { parse: (value) => ({ protocol: "https:", hostname: "example.test", port: null, path: new URL(value).pathname }) },
      https: {
        request(options, onResponse) {
          return {
            write() {}, abort() {}, setTimeout() {}, on() { return this; },
            end() {
              window.signInRequests = (window.signInRequests ?? 0) + 1;
              const handlers = {};
              onResponse({ statusCode: 200, on(event, callback) { handlers[event] = callback; return this; } });
              handlers.data(JSON.stringify({
                ok: true, email: "editor@studio.com", product: "motion_plug",
                licenseKey: "MP-ABCDE-FGHJK-MNPQR-STVWX-YZ012",
                signature: "d".repeat(64), activationsUsed: 1, activationLimit: 3,
              }));
              handlers.end();
            },
          };
        },
      },
    };
    window.cep_node = { require: (name) => { if (!modules[name]) throw new Error(`no module ${name}`); return modules[name]; } };
  });
  await account.setViewport({ width: 390, height: 820 });
  await account.goto(pathToFileURL(path.join(root, "dist", "index.html")).href);
  await account.waitForSelector("#account-gate");
  await account.screenshot({ path: path.join(output, "account-gate.png"), fullPage: true });

  // Dismissed, the panel still browses and previews - only output is gated.
  await account.click("[data-gate-dismiss]");
  await account.waitForFunction(() => !document.querySelector("#account-gate"));
  await account.click(".preset-card__select");
  await account.waitForSelector(".preview-host.is-ready");
  await account.waitForFunction(() => document.querySelector(".action-bar__status span").textContent.includes("Sign in"));
  await account.click("[data-add]");
  await account.waitForSelector("#account-gate");

  await account.type("#account-email", "editor@studio.com");
  await account.type("#account-password", "correct horse");
  await account.click("[data-gate-submit]");
  await account.waitForFunction(
    () => !document.querySelector("#account-gate") ||
      !document.querySelector("[data-gate-error]").classList.contains("is-hidden"),
  );
  const gateError = await account.$eval("[data-gate-error]", (element) => element.textContent).catch(() => "");
  assert.equal(gateError, "", `Sign-in failed in the panel: ${gateError}`);
  assert.equal(await account.evaluate(() => window.signInRequests), 1);
  assert.equal(
    await account.evaluate(() => JSON.parse(window.CSBridge.require("fs").readFileSync("/home/user/.motionplug/license.json")).email),
    "editor@studio.com",
  );
  await account.waitForFunction(() => !document.querySelector(".action-bar__status span").textContent.includes("Sign in"));
  await account.click("[data-back]");
  await account.waitForSelector(".account-strip.is-signed-in");
  assert.match(
    await account.$eval("[data-account-text]", (element) => element.textContent),
    /editor@studio\.com/,
  );
  await account.screenshot({ path: path.join(output, "account-signed-in.png"), fullPage: true });
  assert.deepEqual(accountErrors, []);
  await account.close();

  assert.deepEqual(errors, []);
  console.log("Feature smoke passed: category navigation, live color, TTF/OTF import, persistence, bracket colors, transparent export, synchronized SFX, and the account sign-in gate.");
} finally { await browser.close(); }
