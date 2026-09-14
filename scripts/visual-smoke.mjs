import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "build", "visual-review");
const chrome = process.env.MOTIONPLUG_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--allow-file-access-from-files", "--no-sandbox"] });
const errors = [];

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("ERR_FILE_NOT_FOUND")) errors.push(message.text()); });
  await page.setViewport({ width: 390, height: 720, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(root, "dist", "index.html")).href, { waitUntil: "load" });
  await page.waitForSelector(".preset-card__select");
  await page.screenshot({ path: path.join(output, "library-390x720.png"), fullPage: true });
  await page.click(".preset-card__select");
  await page.waitForSelector(".preview-renderer");
  await page.waitForSelector(".preview-host.is-ready", { timeout: 10_000 });
  await page.waitForFunction(() => {
    const value = document.querySelector("[data-preview-time]")?.textContent ?? "";
    return !value.startsWith("0:00.0");
  }, { timeout: 10_000 });
  const assertPreview = async () => {
    const state = await page.evaluate(() => {
      const host = document.querySelector("#preview-host");
      const renderer = document.querySelector(".preview-renderer");
      const fallback = document.querySelector("[data-preview-fallback]");
      const hostRect = host?.getBoundingClientRect();
      const rendererRect = renderer?.getBoundingClientRect();
      return {
        ready: host?.classList.contains("is-ready") ?? false,
        fallbackVisible: fallback ? getComputedStyle(fallback).display !== "none" : true,
        hostWidth: hostRect?.width ?? 0,
        hostHeight: hostRect?.height ?? 0,
        rendererWidth: rendererRect?.width ?? 0,
        rendererHeight: rendererRect?.height ?? 0,
        time: document.querySelector("[data-preview-time]")?.textContent ?? "",
      };
    });
    if (!state.ready || state.fallbackVisible) throw new Error(`Renderer handshake failed: ${JSON.stringify(state)}`);
    if (Math.abs(state.hostWidth - state.rendererWidth) > 2 || Math.abs(state.hostHeight - state.rendererHeight) > 2) {
      throw new Error(`Renderer does not match its preview frame: ${JSON.stringify(state)}`);
    }
    if (!state.time || state.time.startsWith("0:00.0")) throw new Error(`Renderer did not display a meaningful poster frame: ${JSON.stringify(state)}`);
  };
  await assertPreview();
  await page.click("[data-preview-play]");
  await new Promise((resolve) => setTimeout(resolve, 700));
  await assertPreview();
  await page.screenshot({ path: path.join(output, "detail-390x720.png"), fullPage: true });
  await page.setViewport({ width: 760, height: 820, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await assertPreview();
  await page.screenshot({ path: path.join(output, "detail-760x820.png"), fullPage: true });

  const cepPage = await browser.newPage();
  cepPage.on("pageerror", (error) => errors.push(error.message));
  cepPage.on("console", (message) => { if (message.type() === "error" && !message.text().includes("ERR_FILE_NOT_FOUND")) errors.push(message.text()); });
  await cepPage.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "__adobe_cep__", {
      configurable: true,
      value: {
        evalScript(script, callback) { callback(script === "MP_timelineContext()" ? "OK|30|1080|1920|0|test-sequence||Test|Vertical" : "ERR|Browser host stub"); },
        getSystemPath() { return ""; },
      },
    });
  });
  await cepPage.setViewport({ width: 390, height: 720, deviceScaleFactor: 1 });
  await cepPage.goto(pathToFileURL(path.join(root, "dist", "index.html")).href, { waitUntil: "load" });
  await cepPage.click(".preset-card__select");
  await cepPage.waitForSelector(".preview-host.is-ready", { timeout: 10_000 });
  await cepPage.waitForFunction(() => !document.querySelector("[data-add]")?.hasAttribute("disabled"), { timeout: 10_000 });
  const cepState = await cepPage.evaluate(() => ({
    bridgeAvailable: Boolean(window.CSBridge?.available),
    rendererTag: document.querySelector(".preview-renderer")?.tagName,
    hasWebView: Boolean(document.querySelector("webview")),
    actionText: document.querySelector("[data-add]")?.textContent?.trim(),
  }));
  if (!cepState.bridgeAvailable || cepState.rendererTag !== "IFRAME" || cepState.hasWebView || cepState.actionText !== "Add to timeline") {
    throw new Error(`CEP preview shell is incorrect: ${JSON.stringify(cepState)}`);
  }
  await cepPage.screenshot({ path: path.join(output, "detail-cep-host-390x720.png"), fullPage: true });
  await cepPage.close();
  if (errors.length) throw new Error(`Browser smoke test logged errors:\n${[...new Set(errors)].join("\n")}`);
  console.log(`Visual smoke test passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
