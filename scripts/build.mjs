import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadCatalog } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const external = ["fs", "path", "os"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const iconResult = spawnSync(process.execPath, [path.join(root, "scripts", "generate-icons.mjs")], { stdio: "inherit" });
if (iconResult.status !== 0) throw new Error("Icon generation failed.");

await Promise.all([
  build({
    entryPoints: [path.join(root, "src", "panel", "main.ts")],
    outfile: path.join(dist, "main.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome61",
    external,
    sourcemap: false,
    minify: false,
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(root, "src", "renderer", "frame.ts")],
    outfile: path.join(dist, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome61",
    sourcemap: false,
    minify: false,
    logLevel: "info",
  }),
]);

await Promise.all([
  cp(path.join(root, "plugin", "index.html"), path.join(dist, "index.html")),
  cp(path.join(root, "plugin", "cs-bridge.js"), path.join(dist, "cs-bridge.js")),
  cp(path.join(root, "plugin", "version.js"), path.join(dist, "version.js")),
  cp(path.join(root, "plugin", "update-transaction.js"), path.join(dist, "update-transaction.js")),
  cp(path.join(root, "plugin", "updater.js"), path.join(dist, "updater.js")),
  cp(path.join(root, "plugin", "renderer.html"), path.join(dist, "renderer.html")),
  cp(path.join(root, "plugin", "styles.css"), path.join(dist, "styles.css")),
  cp(path.join(root, "CSXS"), path.join(dist, "CSXS"), { recursive: true }),
  cp(path.join(root, "jsx"), path.join(dist, "jsx"), { recursive: true }),
  cp(path.join(root, "assets", "icons"), path.join(dist, "icons"), { recursive: true }),
  cp(path.join(root, "assets", "licenses"), path.join(dist, "licenses"), { recursive: true }),
  cp(path.join(root, "assets", "previews"), path.join(dist, "previews"), { recursive: true }),
  cp(path.join(root, "assets", "sfx"), path.join(dist, "sfx"), { recursive: true }),
]);

await mkdir(path.join(dist, "fonts"), { recursive: true });
await cp(
  path.join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-ext-wght-normal.woff2"),
  path.join(dist, "fonts", "inter-latin-ext-wght-normal.woff2"),
);
const canonicalLicense = await readFile(path.join(root, "node_modules", "@fontsource-variable", "inter", "LICENSE"), "utf8");
await writeFile(path.join(dist, "licenses", "Inter-OFL.txt"), canonicalLicense);

const { presets } = await loadCatalog(root);
await writeFile(path.join(dist, "catalog.json"), JSON.stringify(presets, null, 2));
console.log(`Built Motion Plug CEP extension in ${path.relative(root, dist)} (${presets.length} presets).`);
