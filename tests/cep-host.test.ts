import { afterEach, describe, expect, it, vi } from "vitest";
import type { MotionPlugInstance, UserPreferences } from "../src/catalog/types";

const preferences: UserPreferences = {
  previewBackground: "dark",
  aspectRatio: "16:9",
  sfxEnabled: true,
  sfxVolume: 68,
  videoTrackPolicy: "auto",
  videoTrackIndex: 0,
  audioTrackPolicy: "specific",
  audioTrackIndex: 2,
};

const instance: MotionPlugInstance = {
  schemaVersion: 1,
  instanceId: "instance-1",
  presetId: "motionplug.hero.centered.v1",
  presetVersion: 1,
  values: { headline: "Hello" },
  duration: 2,
  fps: 25,
  width: 1920,
  height: 1080,
  videoTrackIndex: 0,
  renderVersion: 1,
  videoPath: "/project/frames/frame_000000.png",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("CEP Premiere host adapter", () => {
  it("parses the active sequence context returned by ExtendScript", async () => {
    const evalScript = vi.fn().mockResolvedValue(
      `OK|25|1920|1080|250|${encodeURIComponent("sequence-7")}|${encodeURIComponent("/project/edit.prproj")}|${encodeURIComponent("Edit")}|${encodeURIComponent("Main Cut")}`,
    );
    vi.stubGlobal("window", { CSBridge: { available: true, evalScript, require: vi.fn(), extensionPath: () => "" } });
    const { getTimelineContext, hostIsAvailable } = await import("../src/premiere/host");

    expect(hostIsAvailable()).toBe(true);
    await expect(getTimelineContext()).resolves.toMatchObject({
      fps: 25,
      width: 1920,
      height: 1080,
      playheadFrame: 250,
      playheadSeconds: 10,
      sequenceId: "sequence-7",
      projectPath: "/project/edit.prproj",
      projectName: "Edit",
      sequenceName: "Main Cut",
    });
  });

  it("sends safe frame and track placement data and applies the host result", async () => {
    const evalScript = vi.fn().mockResolvedValue(
      `OK|${encodeURIComponent(JSON.stringify({ videoTrackIndex: 3, audioTrackIndex: 2 }))}`,
    );
    vi.stubGlobal("window", { CSBridge: { available: true, evalScript, require: vi.fn(), extensionPath: () => "" } });
    const { insertRenderedMedia } = await import("../src/premiere/host");

    const result = await insertRenderedMedia({
      context: {
        sequenceId: "sequence-7",
        sequenceName: "Main Cut",
        width: 1920,
        height: 1080,
        fps: 25,
        playheadFrame: 250,
        playheadSeconds: 10,
        projectPath: "/project/edit.prproj",
        projectName: "Edit",
      },
      instance,
      firstFramePath: "/project/frames/frame_000000.png",
      audioPath: "/project/motion-plug-sfx.wav",
      preferences,
    }, "Quiet Moment");

    const script = String(evalScript.mock.calls[0]?.[0]);
    const encodedArgument = JSON.parse(script.slice(script.indexOf("(") + 1, -1));
    const payload = JSON.parse(decodeURIComponent(encodedArgument));
    expect(payload).toMatchObject({
      expectedSequenceId: "sequence-7",
      startFrame: 250,
      frames: 50,
      videoTrackPolicy: "auto",
      audioTrackPolicy: "specific",
      audioTrackIndex: 2,
    });
    expect(result.instance.videoTrackIndex).toBe(3);
    expect(result.instance.audioTrackIndex).toBe(2);
  });

  it("turns a sequence switch into an actionable error", async () => {
    const evalScript = vi.fn().mockResolvedValue("ERR|SEQUENCE_CHANGED");
    vi.stubGlobal("window", { CSBridge: { available: true, evalScript, require: vi.fn(), extensionPath: () => "" } });
    const { getTimelineContext } = await import("../src/premiere/host");
    await expect(getTimelineContext()).rejects.toThrow("active sequence changed");
  });
});
