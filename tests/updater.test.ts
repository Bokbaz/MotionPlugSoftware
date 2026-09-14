import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const updaterSource = fs.readFileSync(path.join(process.cwd(), "plugin", "updater.js"), "utf8");
const thirtyMinutes = 30 * 60 * 1000;

interface UpdateInfo { version: string; isNewer: boolean; sha256: string; url: string }

function harness(options: { lastCheckAge?: number; response?: Record<string, unknown> } = {}) {
  let now = 1_700_000_000_000;
  let nextTimerId = 1;
  const requests: Array<{ path: string }> = [];
  const values = new Map<string, string>();
  const timers = new Map<number, { callback: () => void; dueAt: number }>();
  if (options.lastCheckAge !== undefined) values.set("motionplug.lastUpdateCheck", String(now - options.lastCheckAge));

  const responseBody = options.response ?? {
    version: "9.9.9",
    notes: "Test release",
    url: "https://downloads.motionplug.test/MotionPlug-v9.9.9.zip",
    sha256: "a".repeat(64),
  };
  const transport = {
    request(requestOptions: { path: string }, onResponse: (response: any) => void) {
      return {
        abort() {},
        end() {
          requests.push(requestOptions);
          const handlers: Record<string, (value?: unknown) => void> = {};
          onResponse({
            statusCode: 200,
            headers: {},
            on(event: string, callback: (value?: unknown) => void) { handlers[event] = callback; return this; },
            resume() {},
          });
          handlers.data?.(JSON.stringify(responseBody));
          handlers.end?.();
        },
        on() { return this; },
        setTimeout() {},
      };
    },
  };
  const sandbox: any = {
    Buffer,
    MP_VERSION: "1.0.0",
    MP_UPDATE_MANIFEST_URL: "https://motionplug.test/api/motion-plug/latest",
    CSBridge: {
      require(name: string) {
        if (name === "url") return url;
        if (name === "http" || name === "https") return transport;
        throw new Error(`Unexpected module: ${name}`);
      },
    },
    Date: { now: () => now },
    localStorage: {
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) { values.set(key, String(value)); },
    },
    setTimeout(callback: () => void, delay: number) {
      const id = nextTimerId++;
      timers.set(id, { callback, dueAt: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(updaterSource, sandbox, { filename: "updater.js" });

  function advance(milliseconds: number): void {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) break;
      now = next[1].dueAt;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = target;
  }

  return { updater: sandbox.MotionPlugUpdater, requests, advance };
}

function check(updater: any, manual: boolean): Promise<UpdateInfo> {
  return new Promise((resolve, reject) => updater.check(manual, (error: Error | null, info: UpdateInfo) => error ? reject(error) : resolve(info)));
}

describe("public updater", () => {
  it("accepts a public checksummed release without account state", async () => {
    expect(updaterSource).not.toMatch(/global\.License|licenseKey|machineHash/);
    const setup = harness();
    const info = await check(setup.updater, true);
    expect(info.version).toBe("9.9.9");
    expect(info.isNewer).toBe(true);
    expect(info.sha256).toBe("a".repeat(64));
    expect(setup.requests).toHaveLength(1);
  });

  it("requires the release checksum", async () => {
    const setup = harness({ response: { version: "9.9.9", url: "https://downloads.motionplug.test/update.zip" } });
    await expect(check(setup.updater, true)).rejects.toThrow(/SHA-256/);
  });

  it("throttles automatic checks for exactly 30 minutes while manual checks bypass the throttle", async () => {
    const setup = harness();
    await check(setup.updater, false);
    setup.advance(thirtyMinutes - 1);
    expect(setup.updater.check(false)).toBe(false);
    expect(setup.requests).toHaveLength(1);
    await check(setup.updater, true);
    expect(setup.requests).toHaveLength(2);
    setup.advance(thirtyMinutes);
    await check(setup.updater, false);
    expect(setup.requests).toHaveLength(3);
  });
});
