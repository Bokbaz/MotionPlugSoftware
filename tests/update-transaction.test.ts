import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

interface UpdateTransactionApi {
  install(source: string, live: string, version: string, options: { fs: typeof fs; path: typeof path }): { version: string; copied: number; failed: number };
  validate(fileSystem: typeof fs, pathModule: typeof path, root: string, version?: string): string;
}

const source = fs.readFileSync(path.join(process.cwd(), "plugin", "update-transaction.js"), "utf8");
const sandbox = { module: { exports: {} as UpdateTransactionApi } };
vm.runInNewContext(source, sandbox, { filename: "update-transaction.js" });
const transaction = sandbox.module.exports;
const temporaryRoots: string[] = [];

function write(root: string, file: string, contents = "runtime"): void {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function writePanel(root: string, version: string, marker: string): void {
  write(root, "CSXS/manifest.xml", `<ExtensionManifest ExtensionBundleId="com.motionplug" ExtensionBundleVersion="${version}"><ExtensionList><Extension Id="com.motionplug.panel" Version="${version}"/></ExtensionList></ExtensionManifest>`);
  write(root, "index.html", '<link rel="stylesheet" href="styles.css"><script src="cs-bridge.js"></script><script src="version.js"></script><script src="update-transaction.js"></script><script src="updater.js"></script><script src="main.js"></script>');
  write(root, "renderer.html", '<script src="renderer.js"></script>');
  write(root, "styles.css", '@font-face { src: url("fonts/inter.woff2"); }');
  write(root, "fonts/inter.woff2");
  write(root, "version.js", `window.MP_VERSION = '${version}';`);
  for (const file of ["cs-bridge.js", "update-transaction.js", "updater.js", "main.js", "renderer.js", "jsx/host.jsx"]) write(root, file, marker);
  write(root, "catalog.json", JSON.stringify([{ id: "motionplug.test.v1", sfx: { sample: "soft" } }]));
  write(root, "previews/motionplug.test.v1.jpg");
  write(root, "previews/motionplug.test.v1.mp4");
  write(root, "sfx/motionplug.test.v1.wav");
  write(root, "sfx/samples/soft.wav");
}

function fixture(): { root: string; live: string; downloaded: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "motionplug-update-test-"));
  temporaryRoots.push(root);
  return { root, live: path.join(root, "MotionPlug"), downloaded: path.join(root, "downloaded") };
}

afterEach(() => {
  while (temporaryRoots.length) fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("safe update transaction", () => {
  it("installs a complete release with one directory swap", () => {
    const setup = fixture();
    writePanel(setup.live, "0.3.0", "old");
    writePanel(setup.downloaded, "0.4.0", "new");
    write(setup.live, "stale-file.js", "remove me");

    const result = transaction.install(setup.downloaded, setup.live, "0.4.0", { fs, path });

    expect(result.version).toBe("0.4.0");
    expect(fs.readFileSync(path.join(setup.live, "main.js"), "utf8")).toBe("new");
    expect(fs.existsSync(path.join(setup.live, "stale-file.js"))).toBe(false);
    expect(transaction.validate(fs, path, setup.live)).toBe("0.4.0");
  });

  it("keeps the Windows uninstaller across an in-panel update", () => {
    const setup = fixture();
    writePanel(setup.live, "0.3.0", "old");
    writePanel(setup.downloaded, "0.4.0", "new");
    write(setup.live, "Uninstall Motion Plug.exe", "uninstaller");

    transaction.install(setup.downloaded, setup.live, "0.4.0", { fs, path });

    expect(fs.readFileSync(path.join(setup.live, "Uninstall Motion Plug.exe"), "utf8")).toBe("uninstaller");
  });

  it("rejects an incomplete download before touching the live install", () => {
    const setup = fixture();
    writePanel(setup.live, "0.3.0", "old");
    writePanel(setup.downloaded, "0.4.0", "new");
    fs.unlinkSync(path.join(setup.downloaded, "renderer.js"));

    expect(() => transaction.install(setup.downloaded, setup.live, "0.4.0", { fs, path })).toThrow(/incomplete/);
    expect(fs.readFileSync(path.join(setup.live, "main.js"), "utf8")).toBe("old");
  });

  it("rejects another extension and developer checkouts", () => {
    const setup = fixture();
    writePanel(setup.live, "0.3.0", "old");
    writePanel(setup.downloaded, "0.4.0", "new");
    fs.mkdirSync(path.join(setup.live, ".git"));
    expect(() => transaction.install(setup.downloaded, setup.live, "0.4.0", { fs, path })).toThrow(/developer checkout/);
    fs.rmSync(path.join(setup.live, ".git"), { recursive: true });
    write(setup.downloaded, "CSXS/manifest.xml", '<ExtensionManifest ExtensionBundleId="com.someoneelse" ExtensionBundleVersion="0.4.0"></ExtensionManifest>');
    expect(() => transaction.install(setup.downloaded, setup.live, "0.4.0", { fs, path })).toThrow(/not Motion Plug/);
  });

  it("restores the original tree when the staged rename fails", () => {
    const setup = fixture();
    writePanel(setup.live, "0.3.0", "old");
    writePanel(setup.downloaded, "0.4.0", "new");
    let renameCalls = 0;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property !== "renameSync") return target[property as keyof typeof fs];
        return (from: fs.PathLike, to: fs.PathLike) => {
          renameCalls += 1;
          if (renameCalls === 2) throw new Error("simulated staged swap failure");
          return fs.renameSync(from, to);
        };
      },
    }) as typeof fs;

    expect(() => transaction.install(setup.downloaded, setup.live, "0.4.0", { fs: failingFs, path })).toThrow(/simulated staged swap failure/);
    expect(fs.readFileSync(path.join(setup.live, "main.js"), "utf8")).toBe("old");
    expect(transaction.validate(fs, path, setup.live)).toBe("0.3.0");
  });
});
