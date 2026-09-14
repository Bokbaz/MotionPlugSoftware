import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const licenseSource = fs.readFileSync(path.join(process.cwd(), "plugin", "license.js"), "utf8");

interface ApiCall { path: string; method: string; body: any }

interface HarnessOptions {
  /** Queued responses, consumed in order: [status, body]. */
  responses?: Array<[number, unknown]>;
  /** Contents of ~/.motionplug, keyed by file name. */
  files?: Record<string, string>;
  transportFails?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const now = 1_700_000_000_000;
  const calls: ApiCall[] = [];
  const responses = [...(options.responses ?? [])];
  const files = new Map<string, string>(Object.entries(options.files ?? {}).map(
    ([name, value]) => [`/home/user/.motionplug/${name}`, value],
  ));
  const directories = new Set<string>(["/home/user"]);
  if (files.size) directories.add("/home/user/.motionplug");

  const fsStub = {
    existsSync: (target: string) => directories.has(target) || files.has(target),
    mkdirSync: (target: string) => { directories.add(target); },
    readFileSync: (target: string) => {
      const value = files.get(target);
      if (value === undefined) throw new Error(`ENOENT: ${target}`);
      return value;
    },
    writeFileSync: (target: string, value: string) => { files.set(target, value); },
    unlinkSync: (target: string) => { files.delete(target); },
  };

  const cryptoStub = {
    randomBytes: (size: number) => ({ toString: () => "b".repeat(size * 2) }),
    createHash: () => {
      let seen = "";
      const hash = {
        update(value: string) { seen += value; return hash; },
        digest: () => "c".repeat(64),
      };
      return hash;
    },
  };

  const transport = {
    request(requestOptions: { path: string; method: string }, onResponse: (response: any) => void) {
      let written = "";
      return {
        abort() {},
        write(chunk: Buffer | string) { written += String(chunk); },
        end() {
          calls.push({
            path: requestOptions.path,
            method: requestOptions.method,
            body: written ? JSON.parse(written) : null,
          });
          if (options.transportFails) {
            errorHandlers.forEach((handler) => handler(new Error("socket hang up")));
            return;
          }
          const [status, body] = responses.shift() ?? [200, {}];
          const handlers: Record<string, (value?: unknown) => void> = {};
          onResponse({
            statusCode: status,
            on(event: string, callback: (value?: unknown) => void) { handlers[event] = callback; return this; },
          });
          handlers.data?.(JSON.stringify(body));
          handlers.end?.();
        },
        on(event: string, handler: (error: Error) => void) {
          if (event === "error") errorHandlers.push(handler);
          return this;
        },
        setTimeout() {},
      };
    },
  };
  const errorHandlers: Array<(error: Error) => void> = [];

  const sandbox: any = {
    Buffer,
    MP_VERSION: "1.0.0",
    MP_API_BASE: "https://www.captionplug.test",
    Date: class extends Date { static override now() { return now; } },
    CSBridge: {
      require(name: string) {
        if (name === "url") return url;
        if (name === "http" || name === "https") return transport;
        if (name === "fs") return fsStub;
        if (name === "path") return path.posix;
        if (name === "crypto") return cryptoStub;
        if (name === "os") return { homedir: () => "/home/user", hostname: () => "studio.local", platform: () => "darwin" };
        throw new Error(`Unexpected module: ${name}`);
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(licenseSource, sandbox, { filename: "license.js" });

  return { license: sandbox.MotionPlugLicense, calls, files };
}

function signIn(license: any, email = "editor@studio.com", password = "hunter22"): Promise<Error | null> {
  return new Promise((resolve) => license.signIn(email, password, resolve));
}

const activation = {
  ok: true,
  email: "editor@studio.com",
  product: "motion_plug",
  licenseKey: "MP-ABCDE-FGHJK-MNPQR-STVWX-YZ012",
  signature: "d".repeat(64),
  activationsUsed: 1,
  activationLimit: 3,
};

describe("account sign-in", () => {
  it("activates this machine against the Motion Plug product and caches the result", async () => {
    const setup = harness({ responses: [[200, activation]] });
    expect(await signIn(setup.license)).toBeNull();

    expect(setup.calls).toHaveLength(1);
    expect(setup.calls[0]!.path).toBe("/api/plugin/signin");
    expect(setup.calls[0]!.body.product).toBe("motion_plug");
    expect(setup.calls[0]!.body.email).toBe("editor@studio.com");
    expect(setup.license.ok()).toBe(true);
    expect(setup.license.email()).toBe("editor@studio.com");

    const stored = JSON.parse(setup.files.get("/home/user/.motionplug/license.json")!);
    expect(stored.licenseKey).toBe(activation.licenseKey);
    expect(stored.signature).toBe(activation.signature);
    // The password is a credential the panel is trusted with once, never kept.
    expect(JSON.stringify(stored)).not.toContain("hunter22");
  });

  it("surfaces the no-license code so the panel can point at the purchase page", async () => {
    const setup = harness({
      responses: [[403, { error: "You're signed in, but there's no Motion Plug license on this account yet.", code: "no-license" }]],
    });
    const error = await signIn(setup.license) as any;
    expect(error.code).toBe("no-license");
    expect(setup.license.ok()).toBe(false);
  });

  it("reports a revoked (refunded) license without activating", async () => {
    const setup = harness({
      responses: [[403, { error: "This Motion Plug license has been revoked (refunded purchase).", code: "revoked" }]],
    });
    const error = await signIn(setup.license) as any;
    expect(error.code).toBe("revoked");
    expect(error.message).toMatch(/revoked/i);
    expect(setup.license.ok()).toBe(false);
  });

  it("rejects a malformed address before contacting the server", async () => {
    const setup = harness();
    const error = await signIn(setup.license, "not-an-email");
    expect(error?.message).toMatch(/email address/i);
    expect(setup.calls).toHaveLength(0);
  });
});

describe("cached activation", () => {
  const device = JSON.stringify({ version: 1, machineHash: "c".repeat(64) });
  const state = JSON.stringify({
    email: "editor@studio.com",
    licenseKey: activation.licenseKey,
    machineHash: "c".repeat(64),
    signature: activation.signature,
    lastValidatedAt: 0,
  });

  it("restores a signed-in machine from disk", () => {
    const setup = harness({ files: { "device.json": device, "license.json": state } });
    expect(setup.license.init()).toBe(true);
    expect(setup.license.email()).toBe("editor@studio.com");
  });

  it("ignores a license file copied from another machine", () => {
    const foreign = JSON.stringify({ ...JSON.parse(state), machineHash: "f".repeat(64) });
    const setup = harness({ files: { "device.json": device, "license.json": foreign } });
    expect(setup.license.init()).toBe(false);
  });
});

describe("revalidation", () => {
  const files = {
    "device.json": JSON.stringify({ version: 1, machineHash: "c".repeat(64) }),
    "license.json": JSON.stringify({
      email: "editor@studio.com",
      licenseKey: activation.licenseKey,
      machineHash: "c".repeat(64),
      signature: activation.signature,
      lastValidatedAt: 0,
    }),
  };

  it("signs this machine out when a refund revokes the license", () => {
    const setup = harness({ files, responses: [[403, { valid: false, reason: "revoked-or-unknown" }]] });
    setup.license.init();
    const messages: string[] = [];
    setup.license.revalidate((message: string) => messages.push(message));

    expect(setup.calls[0]!.path).toBe("/api/license/validate");
    expect(setup.calls[0]!.body.product).toBe("motion_plug");
    expect(setup.license.ok()).toBe(false);
    expect(setup.files.has("/home/user/.motionplug/license.json")).toBe(false);
    expect(messages[0]).toMatch(/revoked|freed/i);
  });

  it("keeps a paying user working when the server is unreachable", () => {
    const setup = harness({ files, transportFails: true });
    setup.license.init();
    setup.license.revalidate(() => { throw new Error("must not sign out while offline"); });
    expect(setup.license.ok()).toBe(true);
  });

  it("keeps a paying user working through a server error", () => {
    const setup = harness({ files, responses: [[503, { error: "Licensing isn't configured yet." }]] });
    setup.license.init();
    setup.license.revalidate(() => { throw new Error("must not sign out on a 5xx"); });
    expect(setup.license.ok()).toBe(true);
  });

  it("stays quiet until a day has passed since the last check", () => {
    const fresh = {
      ...files,
      "license.json": JSON.stringify({
        ...JSON.parse(files["license.json"]),
        lastValidatedAt: 1_700_000_000_000 - 60_000,
      }),
    };
    const setup = harness({ files: fresh });
    setup.license.init();
    setup.license.revalidate();
    expect(setup.calls).toHaveLength(0);
  });
});
