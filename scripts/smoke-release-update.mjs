import { createHash } from "node:crypto";
import fs from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const archive = path.join(root, "release", `MotionPlug-v${packageJson.version}.zip`);
const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "motionplug-updater-smoke-"));
const live = path.join(temporaryRoot, "MotionPlug");
await cp(path.join(root, "dist"), live, { recursive: true });
await writeFile(path.join(live, "stale-from-old-version.txt"), "this file must disappear");
await writeFile(path.join(live, "Uninstall Motion Plug.exe"), "preserve this installer-owned file");

let server;
try {
  server = http.createServer((request, response) => {
    if (request.url === "/latest.json") {
      const port = server.address().port;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        version: packageJson.version,
        notes: "Updater integration smoke test",
        url: `http://127.0.0.1:${port}/MotionPlug-v${packageJson.version}.zip`,
        sha256: checksum,
      }));
      return;
    }
    if (request.url === `/MotionPlug-v${packageJson.version}.zip`) {
      response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": fs.statSync(archive).size });
      fs.createReadStream(archive).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const storage = new Map();
  const sandbox = {
    Buffer,
    console,
    Date,
    setTimeout,
    clearTimeout,
    MP_VERSION: "0.0.0",
    MP_UPDATE_MANIFEST_URL: `http://127.0.0.1:${port}/latest.json`,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    CSBridge: {
      extensionPath() { return live; },
      require(name) { return require(name); },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(await readFile(path.join(root, "plugin", "update-transaction.js"), "utf8"), sandbox, { filename: "update-transaction.js" });
  vm.runInNewContext(await readFile(path.join(root, "plugin", "updater.js"), "utf8"), sandbox, { filename: "updater.js" });

  const info = await new Promise((resolve, reject) => {
    sandbox.MotionPlugUpdater.check(true, (error, result) => error ? reject(error) : resolve(result));
  });
  await new Promise((resolve, reject) => {
    sandbox.MotionPlugUpdater.install(info, () => undefined, (error, result) => error ? reject(error) : resolve(result));
  });

  if (fs.existsSync(path.join(live, "stale-from-old-version.txt"))) throw new Error("The update retained a stale runtime file.");
  if (!fs.existsSync(path.join(live, "Uninstall Motion Plug.exe"))) throw new Error("The update removed the Windows uninstaller.");
  if (!sandbox.MotionPlugUpdater.restartPending()) throw new Error("The update did not record its restart-pending state.");
  const installedVersion = sandbox.MotionPlugUpdateTransaction.validate(fs, path, live, packageJson.version);
  if (installedVersion !== packageJson.version) throw new Error("The installed smoke-test version is incorrect.");
  console.log(`Updater smoke test passed for Motion Plug ${installedVersion}.`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}
