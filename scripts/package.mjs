import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageDirectory = path.join(root, "build");
const destination = path.join(packageDirectory, `Motion-Plug-CEP-${packageJson.version}.zip`);
await mkdir(packageDirectory, { recursive: true });
await rm(destination, { force: true });

for (const command of [["npm", ["run", "build"]], ["npm", ["run", "validate"]]]) {
  const result = spawnSync(command[0], command[1], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const zipped = spawnSync("zip", ["-q", "-r", destination, ".", "-x", "*.DS_Store"], { cwd: path.join(root, "dist"), stdio: "inherit" });
if (zipped.status !== 0) throw new Error("Could not create the CEP extension archive.");
console.log(`Created CEP extension archive ${destination}`);
