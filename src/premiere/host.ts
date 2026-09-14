import type { MotionPlugInstance, UserPreferences } from "../catalog/types";

interface CSBridgeApi {
  available: boolean;
  evalScript(script: string): Promise<string>;
  require(id: string): any;
  extensionPath(): string;
  openURL(address: string): void;
}

declare global {
  interface Window {
    CSBridge?: CSBridgeApi;
  }
}

export interface TimelineContext {
  sequenceId: string;
  sequenceName: string;
  width: number;
  height: number;
  fps: number;
  playheadFrame: number;
  playheadSeconds: number;
  projectPath: string;
  projectName: string;
}

export interface InsertRequest {
  context: TimelineContext;
  instance: MotionPlugInstance;
  firstFramePath: string;
  audioPath?: string;
  preferences: UserPreferences;
}

export interface InsertResult {
  instance: MotionPlugInstance;
  warning?: string;
}

interface SelectedHostGraphic {
  nodeId: string;
  videoPath: string;
  videoTrackIndex: number;
  startFrame: number;
  startSeconds: number;
  endFrame: number;
}

export interface SelectedInstance {
  context: TimelineContext;
  instance: MotionPlugInstance;
  nodeId: string;
  videoPath: string;
  videoTrackIndex: number;
  startFrame: number;
  startSeconds: number;
}

export interface ReplaceRequest {
  selected: SelectedInstance;
  next: MotionPlugInstance;
  firstFramePath: string;
  audioPath?: string;
  preferences: UserPreferences;
  title: string;
}

function bridge(): CSBridgeApi {
  const value = window.CSBridge;
  if (!value?.available) {
    throw new Error("Open Motion Plug from Window > Extensions inside Adobe Premiere Pro.");
  }
  return value;
}

export function hostIsAvailable(): boolean {
  return Boolean(window.CSBridge?.available);
}

export function isCepHost(): boolean {
  return hostIsAvailable();
}

function decode(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hostError(message: string): Error {
  const detail = message.startsWith("ERR|") ? message.slice(4) : message;
  if (detail === "SEQUENCE_CHANGED") {
    return new Error("The active sequence changed while Motion Plug was working. No timeline edit was made.");
  }
  return new Error(detail || "Premiere did not complete the requested edit.");
}

async function evalHost(script: string): Promise<string> {
  const result = String(await bridge().evalScript(script));
  if (result === "EvalScript error." || result.startsWith("ERR|")) throw hostError(result);
  return result;
}

async function callHost<T>(functionName: string, payload: unknown): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  const result = await evalHost(`${functionName}(${JSON.stringify(encoded)})`);
  if (!result.startsWith("OK|")) throw hostError(result);
  const serialized = decode(result.slice(3));
  try {
    return JSON.parse(serialized) as T;
  } catch {
    throw new Error("Premiere returned an unreadable response. No further timeline action was attempted.");
  }
}

function modules(): { fs: any; path: any } {
  const cep = bridge();
  return { fs: cep.require("fs"), path: cep.require("path") };
}

function readInstance(videoPath: string): MotionPlugInstance {
  const { fs, path } = modules();
  const metadataPath = path.join(path.dirname(path.dirname(videoPath)), "motion-plug.json");
  if (!fs.existsSync(metadataPath)) {
    throw new Error("The selected clip's Motion Plug edit data is missing. Its rendered media is still usable in Premiere.");
  }
  try {
    const document = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as { instance?: MotionPlugInstance };
    if (!document.instance || document.instance.schemaVersion !== 1 || !document.instance.presetId) {
      throw new Error("invalid metadata");
    }
    return document.instance;
  } catch {
    throw new Error("The selected clip's Motion Plug edit data is damaged. Its rendered media was not changed.");
  }
}

export async function getTimelineContext(): Promise<TimelineContext> {
  const result = await evalHost("MP_timelineContext()");
  const parts = result.split("|");
  if (parts[0] !== "OK" || parts.length < 9) throw hostError(result);
  const fps = Number(parts[1]);
  const playheadFrame = Number(parts[4]);
  const context: TimelineContext = {
    fps,
    width: Number(parts[2]),
    height: Number(parts[3]),
    playheadFrame,
    playheadSeconds: playheadFrame / fps,
    sequenceId: decode(parts[5]),
    projectPath: decode(parts[6]),
    projectName: decode(parts[7]) || "Untitled Project",
    sequenceName: decode(parts.slice(8).join("|")) || "Untitled Sequence",
  };
  if (!Number.isFinite(context.fps) || context.fps <= 0 || !Number.isFinite(context.width) || !Number.isFinite(context.height) || context.width < 16 || context.height < 16) {
    throw new Error("The active sequence has invalid dimensions or frame-rate settings.");
  }
  return context;
}

function placementPayload(request: InsertRequest, title: string): Record<string, unknown> {
  const { context, instance, preferences } = request;
  return {
    expectedSequenceId: context.sequenceId,
    startFrame: context.playheadFrame,
    fps: context.fps,
    frames: Math.max(1, Math.ceil(instance.duration * context.fps)),
    firstFramePath: request.firstFramePath,
    audioPath: request.audioPath || "",
    title,
    instanceId: instance.instanceId,
    videoTrackPolicy: preferences.videoTrackPolicy,
    videoTrackIndex: preferences.videoTrackIndex,
    audioTrackPolicy: preferences.audioTrackPolicy,
    audioTrackIndex: preferences.audioTrackIndex,
  };
}

export async function insertRenderedMedia(request: InsertRequest, title: string): Promise<InsertResult> {
  const result = await callHost<{ videoTrackIndex: number; audioTrackIndex?: number; warning?: string }>(
    "MP_insertGraphic",
    placementPayload(request, title),
  );
  return {
    instance: {
      ...request.instance,
      videoTrackIndex: result.videoTrackIndex,
      audioTrackIndex: result.audioTrackIndex,
    },
    warning: result.warning,
  };
}

export async function getSelectedInstance(): Promise<SelectedInstance> {
  const context = await getTimelineContext();
  const selected = await callHost<SelectedHostGraphic>("MP_selectedGraphic", {
    expectedSequenceId: context.sequenceId,
  });
  const instance = readInstance(selected.videoPath);
  return {
    context,
    instance,
    nodeId: selected.nodeId,
    videoPath: selected.videoPath,
    videoTrackIndex: selected.videoTrackIndex,
    startFrame: selected.startFrame,
    startSeconds: selected.startSeconds,
  };
}

export async function replaceSelectedMedia(request: ReplaceRequest): Promise<InsertResult> {
  const { selected, next, preferences } = request;
  const result = await callHost<{ videoTrackIndex: number; audioTrackIndex?: number; warning?: string }>(
    "MP_replaceGraphic",
    {
      expectedSequenceId: selected.context.sequenceId,
      selectedNodeId: selected.nodeId,
      oldFirstFramePath: selected.videoPath,
      oldAudioPath: selected.instance.audioPath || "",
      oldVideoTrackIndex: selected.videoTrackIndex,
      oldAudioTrackIndex: selected.instance.audioTrackIndex,
      startFrame: selected.startFrame,
      fps: selected.context.fps,
      frames: Math.max(1, Math.ceil(next.duration * selected.context.fps)),
      firstFramePath: request.firstFramePath,
      audioPath: request.audioPath || "",
      title: request.title,
      instanceId: next.instanceId,
      audioTrackPolicy: preferences.audioTrackPolicy,
      audioTrackIndex: preferences.audioTrackIndex,
    },
  );
  return {
    instance: {
      ...next,
      videoTrackIndex: result.videoTrackIndex,
      audioTrackIndex: result.audioTrackIndex,
    },
    warning: result.warning,
  };
}
