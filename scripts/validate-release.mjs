import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "release");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const target = process.argv[2] ?? "";
const zipName = `MotionPlug-v${version}.zip`;
const zipFile = path.join(artifacts, zipName);

async function exists(file) {
  try { await access(file); return true; }
  catch { return false; }
}

async function requireNonEmpty(file, label) {
  const details = await stat(file);
  if (!details.isFile() || details.size === 0) throw new Error(`${label} is missing or empty: ${path.relative(root, file)}`);
}

if (await exists(zipFile)) {
  await requireNonEmpty(zipFile, "Updater archive");
  const entries = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean);
  if (!entries.length || entries.some((entry) => entry !== "MotionPlug/" && !entry.startsWith("MotionPlug/"))) {
    throw new Error("Every updater archive entry must live below the MotionPlug root folder.");
  }
  const forbidden = entries.filter((entry) => /(?:^|\/)(?:node_modules|src|scripts|installer|tests|\.git)(?:\/|$)|(?:^|\/)(?:\._[^/]+|\.DS_Store|\.gitkeep)$|(?:^|\/)package(?:-lock)?\.json$/i.test(entry));
  if (forbidden.length) throw new Error(`Development files leaked into the updater archive: ${forbidden.slice(0, 5).join(", ")}`);
  for (const required of [
    "MotionPlug/CSXS/manifest.xml",
    "MotionPlug/index.html",
    "MotionPlug/version.js",
    "MotionPlug/update-transaction.js",
    "MotionPlug/updater.js",
    "MotionPlug/main.js",
    "MotionPlug/renderer.js",
    "MotionPlug/catalog.json",
  ]) {
    if (!entries.includes(required)) throw new Error(`Updater archive is incomplete: ${required}`);
  }
  const archivedManifest = execFileSync("unzip", ["-p", zipFile, "MotionPlug/CSXS/manifest.xml"], { encoding: "utf8" });
  if (!archivedManifest.includes(`ExtensionBundleVersion="${version}"`)) throw new Error("The updater archive has the wrong manifest version.");

  const digest = createHash("sha256").update(await readFile(zipFile)).digest("hex");
  const latest = JSON.parse(await readFile(path.join(artifacts, "latest.json"), "utf8"));
  if (latest.version !== version || latest.sha256 !== digest) {
    throw new Error("latest.json does not describe the updater archive exactly.");
  }
  // The live feed serves the payload from a release endpoint that signs storage
  // at download time, so the URL addresses the release rather than naming the
  // archive file. A static file host that names the archive stays valid too.
  const manifestUrl = String(latest.url ?? "");
  if (!manifestUrl.endsWith(`/${zipName}`) && !/\/api\/motion-plug\/download$/.test(manifestUrl)) {
    throw new Error("latest.json must point at the updater archive or the release download endpoint.");
  }
  if (!/^https:\/\//.test(manifestUrl)) throw new Error("The public update archive URL must use HTTPS.");
  const checksumText = await readFile(`${zipFile}.sha256`, "utf8");
  if (checksumText.trim() !== `${digest}  ${zipName}`) throw new Error("The updater checksum file is inconsistent.");
}

if (target === "mac-universal") {
  const pkgFile = path.join(artifacts, `MotionPlug-v${version}-mac-universal.pkg`);
  await requireNonEmpty(pkgFile, "macOS installer");
  const payloadFiles = execFileSync("pkgutil", ["--payload-files", pkgFile], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (/(?:^|\/)\.DS_Store$/m.test(payloadFiles) || /(?:^|\/)\.gitkeep$/m.test(payloadFiles)) {
    throw new Error("macOS placeholder files leaked into the PKG payload.");
  }
}
if (target === "win-x64") {
  await requireNonEmpty(path.join(artifacts, `MotionPlug-Setup-${version}.exe`), "Windows installer");
}

console.log(`Validated Motion Plug ${version} release artifacts for ${target || "the current target"}.`);
