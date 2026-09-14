import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const required = [
  "CSXS/manifest.xml",
  "jsx/host.jsx",
  "index.html",
  "cs-bridge.js",
  "version.js",
  "license.js",
  "update-transaction.js",
  "updater.js",
  "main.js",
  "renderer.html",
  "renderer.js",
  "styles.css",
  "catalog.json",
  "fonts/inter-latin-ext-wght-normal.woff2",
  "licenses/Inter-OFL.txt",
  "icons/panel-dark@1x.png",
  "icons/panel-dark@2x.png",
  "icons/panel-light@1x.png",
  "icons/panel-light@2x.png",
  "icons/plugin@1x.png",
  "icons/plugin@2x.png",
  "icons/motionplug-logo.png",
  "sfx/sources.json",
];
for (const file of required) await access(path.join(dist, file));
const manifest = await readFile(path.join(dist, "CSXS", "manifest.xml"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const catalog = JSON.parse(await readFile(path.join(dist, "catalog.json"), "utf8"));
const manifestVersion = manifest.match(/ExtensionBundleVersion="([^"]+)"/)?.[1];
const extensionVersion = manifest.match(/<Extension Id="com\.motionplug\.panel" Version="([^"]+)"/)?.[1];
const versionScript = await readFile(path.join(dist, "version.js"), "utf8");
const runtimeVersion = versionScript.match(/MP_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
if (!manifest.includes('<Host Name="PPRO"') || !manifest.includes('<Type>Panel</Type>')) throw new Error("Invalid Premiere CEP manifest.");
if (manifestVersion !== packageJson.version || extensionVersion !== packageJson.version || runtimeVersion !== packageJson.version) {
  throw new Error(`Version mismatch: package=${packageJson.version}, bundle=${manifestVersion}, extension=${extensionVersion}, runtime=${runtimeVersion}.`);
}
if (catalog.length !== 30) throw new Error(`Expected 30 presets; found ${catalog.length}.`);
const families = new Map();
for (const preset of catalog) families.set(preset.family, (families.get(preset.family) ?? 0) + 1);
if (families.size !== 15 || [...families.values()].some((count) => count !== 2)) throw new Error("Each of the 15 families must have exactly two variants.");
for (const preset of catalog) {
  for (const extension of ["jpg", "mp4"]) await access(path.join(dist, "previews", `${preset.id}.${extension}`));
  await access(path.join(dist, "sfx", `${preset.id}.wav`));
  await access(path.join(dist, "sfx", "samples", `${preset.sfx.sample}.wav`));
  for (const removed of ["keyword", "backgroundColor", "transparentBackground", "aspectRatio"]) {
    if (preset.controls.includes(removed)) throw new Error(`Obsolete control ${removed} in ${preset.id}.`);
  }
}
const files = await readdir(dist, { recursive: true });
if (files.some((file) => String(file).endsWith(".mogrt"))) throw new Error("A .mogrt is present even though no genuine AE-exported template is shipped.");
const mainSize = (await stat(path.join(dist, "main.js"))).size;
const rendererSize = (await stat(path.join(dist, "renderer.js"))).size;
if (mainSize < 20_000 || rendererSize < 10_000) throw new Error("A runtime bundle appears incomplete.");
const mainBundle = await readFile(path.join(dist, "main.js"), "utf8");
const indexHtml = await readFile(path.join(dist, "index.html"), "utf8");
const bridgeBundle = await readFile(path.join(dist, "cs-bridge.js"), "utf8");
const hostScript = await readFile(path.join(dist, "jsx", "host.jsx"), "utf8");
if (!mainBundle.includes("MP_timelineContext") || !mainBundle.includes("CSBridge")) {
  throw new Error("The panel bundle does not contain the CEP host adapter.");
}
const orderedScripts = ["cs-bridge.js", "version.js", "license.js", "update-transaction.js", "updater.js", "main.js"];
let previousScriptIndex = -1;
for (const script of orderedScripts) {
  const scriptIndex = indexHtml.indexOf(script);
  if (scriptIndex < 0 || scriptIndex <= previousScriptIndex) throw new Error(`Runtime script order is invalid around ${script}.`);
  previousScriptIndex = scriptIndex;
}
if (!bridgeBundle.includes("__adobe_cep__.evalScript") || !hostScript.includes("function MP_insertGraphic") || !hostScript.includes("function MP_replaceGraphic")) {
  throw new Error("The CEP bridge or Premiere host script is incomplete.");
}
new vm.Script(bridgeBundle, { filename: "cs-bridge.js" });
new vm.Script(hostScript, { filename: "host.jsx" });
new vm.Script(versionScript, { filename: "version.js" });
new vm.Script(await readFile(path.join(dist, "license.js"), "utf8"), { filename: "license.js" });
new vm.Script(await readFile(path.join(dist, "update-transaction.js"), "utf8"), { filename: "update-transaction.js" });
new vm.Script(await readFile(path.join(dist, "updater.js"), "utf8"), { filename: "updater.js" });
const panelCss = await readFile(path.join(dist, "styles.css"), "utf8");
for (const unsupported of [/\boklch\s*\(/i, /\baccent-color\s*:/i, /\baspect-ratio\s*:/i, /\bgap\s*:/i]) {
  if (unsupported.test(panelCss)) throw new Error(`Panel CSS contains a legacy CEP-incompatible rule: ${unsupported}.`);
}
if (/document\.createElement\(["']webview["']\)/i.test(mainBundle)) throw new Error("The CEP panel still creates a UXP WebView.");
console.log(`Validated the CEP manifest/bridge, ${catalog.length} presets, ${catalog.length} previews, ${catalog.length} SFX files, and both runtime bundles.`);
