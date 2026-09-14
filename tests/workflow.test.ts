import { beforeEach, describe, expect, it, vi } from "vitest";
import { MotionPlugWorkflow } from "../src/premiere/workflow";
import { defaultPreferences } from "../src/storage/settings";
import type { RenderClient } from "../src/render/render-client";
import type { TimelineContext, SelectedInstance } from "../src/premiere/host";
import { getTimelineContext, insertRenderedMedia, replaceSelectedMedia } from "../src/premiere/host";
import { writeText } from "../src/premiere/filesystem";

vi.mock("../src/premiere/host", () => ({
  getTimelineContext: vi.fn(), getSelectedInstance: vi.fn(),
  insertRenderedMedia: vi.fn(async (request) => ({ instance: request.instance })),
  replaceSelectedMedia: vi.fn(async (request) => ({ instance: request.next })),
}));
vi.mock("../src/premiere/filesystem", () => ({
  resolveMediaDestination: vi.fn(async () => ({ framesFolder: "/test/frames", firstFramePath: "/test/frames/frame_000000.png", audioPath: "/test/sfx.wav", metadataPath: "/test/metadata.json" })),
  prepareDestination: vi.fn(), writeBinary: vi.fn(), writeText: vi.fn(), removeCreatedVersion: vi.fn(),
}));

const context: TimelineContext = { width: 1080, height: 1920, fps: 23.976, sequenceId: "sequence", sequenceName: "Test", projectPath: "/test.prproj", projectName: "Test", playheadFrame: 0, playheadSeconds: 0 };
beforeEach(() => vi.clearAllMocks());

describe("automatic timeline dimensions", () => {
  it.each([[1080, 1920], [1080, 1080], [2048, 858], [3840, 2160]])("renders Add at the actual %i × %i sequence size despite legacy frame preferences", async (width, height) => {
    vi.mocked(getTimelineContext).mockResolvedValue({ ...context, width, height });
    const render = vi.fn().mockResolvedValue({ warnings: [] });
    const workflow = new MotionPlugWorkflow({ render } as unknown as RenderClient);
    const result = await workflow.add({ presetId: "motionplug.hero.centered.v1", values: { aspectRatio: "16:9", transparentBackground: false, sfxEnabled: false }, preferences: defaultPreferences });
    expect(render.mock.calls[0]![0]).toMatchObject({ width, height, background: "transparent", renderMode: "export", values: { transparentBackground: true } });
    expect(result.instance).toMatchObject({ width, height, fps: 23.976 });
    expect(insertRenderedMedia).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalled();
  });

  it("uses the selected clip's current sequence dimensions when updating older renders", async () => {
    const render = vi.fn().mockResolvedValue({ warnings: [] });
    const workflow = new MotionPlugWorkflow({ render } as unknown as RenderClient);
    const selected = { context, instance: { instanceId: "old", renderVersion: 1, createdAt: "2026-09-01", width: 1920, height: 1080 }, nodeId: "node" } as SelectedInstance;
    await workflow.update({ presetId: "motionplug.hero.centered.v1", values: { sfxEnabled: false }, preferences: defaultPreferences }, selected);
    expect(render.mock.calls[0]![0]).toMatchObject({ width: 1080, height: 1920 });
    expect(replaceSelectedMedia).toHaveBeenCalledOnce();
  });
});
