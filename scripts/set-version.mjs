import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error(`Version must be X.Y.Z (received ${version ?? "nothing"}).`);
}

async function replace(file, pattern, replacement, label) {
  const source = await readFile(file, "utf8");
  const updated = source.replace(pattern, replacement);
  if (updated === source) throw new Error(`Could not update ${label} in ${path.relative(root, file)}.`);
  await writeFile(file, updated);
}

const packageFile = path.join(root, "package.json");
const lockFile = path.join(root, "package-lock.json");
const manifestFile = path.join(root, "CSXS", "manifest.xml");
const versionFile = path.join(root, "plugin", "version.js");

const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
packageJson.version = version;
await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);

const lockJson = JSON.parse(await readFile(lockFile, "utf8"));
lockJson.version = version;
if (lockJson.packages?.[""]) lockJson.packages[""].version = version;
await writeFile(lockFile, `${JSON.stringify(lockJson, null, 2)}\n`);

await replace(manifestFile, /(ExtensionBundleVersion=")[^"]+(")/, `$1${version}$2`, "bundle version");
await replace(manifestFile, /(<Extension Id="com\.motionplug\.panel" Version=")[^"]+(")/, `$1${version}$2`, "panel version");
await replace(versionFile, /(MP_VERSION\s*=\s*')[^']+(')/, `$1${version}$2`, "runtime version");

console.log(`Motion Plug version synchronized to ${version}.`);
