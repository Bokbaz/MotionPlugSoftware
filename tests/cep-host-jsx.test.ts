import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type HostContext = Record<string, any>;

function loadHost(extra: HostContext = {}): HostContext {
  const context = vm.createContext({
    JSON,
    Math,
    Number,
    String,
    Error,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    ...extra,
  });
  vm.runInContext(readFileSync(new URL("../jsx/host.jsx", import.meta.url), "utf8"), context);
  return context;
}

function track(clips: Array<{ start: number; end: number; nodeId?: string }> = [], locked = false) {
  const collection: Record<string, any> = { numItems: clips.length };
  clips.forEach((clip, index) => {
    collection[index] = {
      nodeId: clip.nodeId || `clip-${index}`,
      start: { seconds: clip.start, ticks: String(clip.start * 25) },
      end: { seconds: clip.end, ticks: String(clip.end * 25) },
    };
  });
  return { clips: collection, isLocked: () => locked };
}

function tracks(items: ReturnType<typeof track>[]) {
  const collection: Record<string, any> = { numTracks: items.length };
  items.forEach((item, index) => { collection[index] = item; });
  return collection;
}

describe("CEP ExtendScript host safety", () => {
  it("parses requests and serializes responses when ExtendScript has no JSON global", () => {
    const host = loadHost({ JSON: undefined });
    const request = {
      expectedSequenceId: "sequence-7",
      title: "Line one\nCafé \u2028 line two",
      audioPath: "",
      values: [true, 12.5, null],
    };

    const parsed = host.MP_payload(encodeURIComponent(JSON.stringify(request)));
    expect(parsed.expectedSequenceId).toBe(request.expectedSequenceId);
    expect(parsed.title).toBe(request.title);
    expect(Array.from(parsed.values)).toEqual(request.values);

    const result = String(host.MP_ok({ videoTrackIndex: 2, warning: request.title }));
    expect(result.startsWith("OK|")).toBe(true);
    expect(JSON.parse(decodeURIComponent(result.slice(3)))).toEqual({
      videoTrackIndex: 2,
      warning: request.title,
    });
  });

  it("derives the active sequence frame rate and playhead from Premiere ticks", () => {
    const sequence = {
      sequenceID: "sequence-7",
      name: "Main Cut",
      timebase: 10_160_640_000,
      frameSizeHorizontal: 1920,
      frameSizeVertical: 1080,
      getPlayerPosition: () => ({ ticks: "2540160000000" }),
    };
    const host = loadHost({ app: { project: { activeSequence: sequence, path: "/project/edit.prproj", name: "Edit" } } });
    const parts = String(host.MP_timelineContext()).split("|");
    expect(parts[0]).toBe("OK");
    expect(Number(parts[1])).toBe(25);
    expect(Number(parts[4])).toBe(250);
    expect(decodeURIComponent(parts[5]!)).toBe("sequence-7");
  });

  it("rejects a fixed video track that would overwrite existing media", () => {
    const host = loadHost();
    const sequence = { videoTracks: tracks([track([{ start: 8, end: 12 }])]) };
    expect(() => host.MP_resolveVideoTrack(sequence, "specific", 0, 10, 11, "")).toThrow("already contains media");
  });

  it("auto placement chooses the first free track above overlapping media", () => {
    const host = loadHost();
    const sequence = {
      videoTracks: tracks([
        track([{ start: 8, end: 12 }]),
        track(),
        track(),
      ]),
    };
    expect(host.MP_resolveVideoTrack(sequence, "auto", 0, 10, 11, "")).toBe(1);
  });

  it("ignores the selected original but rejects a longer update that reaches its neighbor", () => {
    const host = loadHost();
    const videoTrack = track([
      { start: 10, end: 11, nodeId: "selected" },
      { start: 12, end: 14, nodeId: "neighbor" },
    ]);
    expect(host.MP_trackFree(videoTrack, 10, 11.5, "selected")).toBe(true);
    expect(host.MP_trackFree(videoTrack, 10, 12.5, "selected")).toBe(false);
  });

  it("places clips with integer frame ticks rather than decimal seconds", () => {
    const host = loadHost();
    let received = "";
    const target = { overwriteClip: (_item: unknown, ticks: string) => { received = ticks; } };
    host.MP_overwriteAtFrame({ timebase: 10_160_640_000 }, target, {}, 250);
    expect(received).toBe("2540160000000");
  });

  it("restores old SFX to its original track when a replacement on another track fails", () => {
    const host = loadHost();
    const videoTrack = { isLocked: () => false };
    const oldAudioTrack = { isLocked: () => false };
    const newAudioTrack = { isLocked: () => false };
    const sequence = {
      sequenceID: "sequence-7",
      videoTracks: { numTracks: 1, 0: videoTrack },
      audioTracks: { numTracks: 2, 0: oldAudioTrack, 1: newAudioTrack },
    };
    host.app = { project: { activeSequence: sequence } };
    const oldVideoItem = { id: "old-video" };
    const oldAudioItem = { id: "old-audio" };
    const newVideoItem = { id: "new-video" };
    const newAudioItem = { id: "new-audio" };
    const oldVideo = { projectItem: oldVideoItem, start: { seconds: 10 }, end: { seconds: 12 } };
    const oldAudio = { projectItem: oldAudioItem, start: { seconds: 10 }, end: { seconds: 12 } };
    const newVideo = { id: "new-video-clip" };
    const overwrites: Array<{ target: unknown; item: unknown }> = [];

    host.MP_expectedSequence = () => true;
    host.MP_findClip = (target: unknown) => target === videoTrack ? oldVideo : target === oldAudioTrack ? oldAudio : null;
    host.MP_nodeId = (item: unknown) => item === oldVideo ? "selected" : item === oldAudio ? "old-audio" : "";
    host.MP_trackFree = (target: unknown) => target !== oldAudioTrack;
    host.MP_resolveAudioTrack = () => 1;
    host.MP_findOrCreateBin = () => ({});
    host.MP_importMedia = (_bin: unknown, _path: string, numbered: boolean) => numbered ? newVideoItem : newAudioItem;
    host.MP_removeClip = () => true;
    host.MP_label = () => undefined;
    host.MP_overwriteAtFrame = (_sequence: unknown, target: unknown, item: unknown) => { overwrites.push({ target, item }); };
    host.MP_trimClip = (_sequence: unknown, _track: unknown, item: unknown) => {
      if (item === newVideoItem) return newVideo;
      if (item === newAudioItem) return null;
      return { restored: true };
    };

    const result = host.MP_replaceGraphic(encodeURIComponent(JSON.stringify({
      expectedSequenceId: "sequence-7",
      selectedNodeId: "selected",
      oldFirstFramePath: "/old/frame.png",
      oldAudioPath: "/old/sfx.wav",
      oldVideoTrackIndex: 0,
      oldAudioTrackIndex: 0,
      startFrame: 250,
      fps: 25,
      frames: 50,
      firstFramePath: "/new/frame.png",
      audioPath: "/new/sfx.wav",
      title: "Quiet Moment",
      instanceId: "instance-1",
      audioTrackPolicy: "auto",
      audioTrackIndex: 0,
    })));

    expect(String(result)).toContain("ERR|");
    expect(overwrites).toContainEqual({ target: oldAudioTrack, item: oldAudioItem });
    expect(overwrites).not.toContainEqual({ target: newAudioTrack, item: oldAudioItem });
  });
});
