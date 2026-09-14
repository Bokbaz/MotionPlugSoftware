import { loadCustomFont } from "../fonts/custom-fonts";
import { presets, valuesForPreset } from "../catalog/presets";
import type { RenderConfig } from "../catalog/types";
import { aspectDimensions, renderFrame } from "./core";

declare global {
  interface Window {
    motionPlugRenderer: RendererBridge;
  }
}

interface HostMessage {
  type: string;
  config?: RenderConfig;
  time?: number;
  jobId?: string;
  frame?: number;
  fps?: number;
  requestId?: string;
}

interface RendererBridge {
  configure(config: RenderConfig): Promise<void>;
  renderAt(time: number): ReturnType<typeof renderFrame>;
  play(): void;
  pause(): void;
  replay(): void;
  dataUrl(): string;
  getConfig(): RenderConfig;
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvasElement) throw new Error("Renderer canvas is missing.");
const canvas: HTMLCanvasElement = canvasElement;
const renderingContext = canvas.getContext("2d", { alpha: true });
if (!renderingContext) throw new Error("2D canvas rendering is unavailable.");
const context: CanvasRenderingContext2D = renderingContext;

const fallbackDimensions = aspectDimensions("16:9", 1280);
let config: RenderConfig = {
  presetId: presets[0]!.id,
  values: valuesForPreset(presets[0]!.id),
  width: fallbackDimensions.width,
  height: fallbackDimensions.height,
  duration: presets[0]!.duration,
  background: "dark",
  renderMode: "preview",
};
let currentTime = 0;
let playing = false;
let playStartedAt = 0;
let playStartedTime = 0;
let animationFrame = 0;
let activeRenderJob: string | undefined;
let showingPoster = false;
let rendererReady = false;
let rendererStartupError: string | undefined;
const acknowledgements = new Map<string, () => void>();

function parseMessage(value: unknown): HostMessage | undefined {
  try {
    if (typeof value === "string") return JSON.parse(value) as HostMessage;
    if (value && typeof value === "object") return value as HostMessage;
  } catch {
    return undefined;
  }
  return undefined;
}

function postHost(message: Record<string, unknown>): void {
  const serialized = JSON.stringify(message);
  if (window.parent !== window) window.parent.postMessage(serialized, "*");
}

function fontSet(): FontFaceSet | undefined {
  return (document as Document & { fonts?: FontFaceSet }).fonts;
}

async function waitForFonts(timeoutMs = 750): Promise<void> {
  const fonts = fontSet();
  if (!fonts?.ready) return;
  await Promise.race([
    fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

function sizeCanvas(): void {
  if (canvas.width !== config.width) canvas.width = config.width;
  if (canvas.height !== config.height) canvas.height = config.height;
}

function renderAt(time: number): ReturnType<typeof renderFrame> {
  currentTime = Math.max(0, Math.min(config.duration, time));
  sizeCanvas();
  const diagnostics = renderFrame(context, config, currentTime);
  const family = String(config.values.fontFamily ?? "Inter Variable");
  const fonts = fontSet();
  if (fonts?.check && !fonts.check(`16px "${family.replace(/["\\]/g, "")}"`)) {
    diagnostics.warnings.push(`Font “${family}” is unavailable; a fallback is being used.`);
  }
  postHost({
    type: "render-state",
    time: currentTime,
    duration: config.duration,
    playing,
    warnings: diagnostics.warnings,
  });
  return diagnostics;
}

function tick(now: number): void {
  if (!playing) return;
  currentTime = playStartedTime + (now - playStartedAt) / 1000;
  if (currentTime >= config.duration) {
    currentTime = config.duration;
    playing = false;
  }
  renderAt(currentTime);
  if (playing) animationFrame = requestAnimationFrame(tick);
  else postHost({ type: "playback-ended", time: currentTime });
}

function stopPlayback(): void {
  playing = false;
  cancelAnimationFrame(animationFrame);
}

function play(): void {
  if (playing) return;
  if (showingPoster || currentTime >= config.duration - 0.01) currentTime = 0;
  showingPoster = false;
  playing = true;
  playStartedAt = performance.now();
  playStartedTime = currentTime;
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(tick);
}

function pause(): void {
  stopPlayback();
  renderAt(currentTime);
}

function replay(): void {
  stopPlayback();
  showingPoster = false;
  currentTime = 0;
  renderAt(0);
  play();
}

async function configure(next: RenderConfig, requestId?: string): Promise<void> {
  try {
    stopPlayback();
    config = {
      ...next,
      width: Math.max(16, Math.round(next.width)),
      height: Math.max(16, Math.round(next.height)),
      duration: Math.max(0.1, next.duration),
    };
    await loadCustomFont(config.values);
    await waitForFonts();
    sizeCanvas();
    const entrance = Math.max(0, Number(config.values.entrance ?? 0.55));
    const exit = Math.max(0, Number(config.values.exit ?? 0.5));
    const lastReadableMoment = Math.max(0, config.duration - exit - 0.08);
    currentTime = config.renderMode === "preview"
      ? Math.min(lastReadableMoment, Math.max(entrance + 0.18, config.duration * 0.34))
      : 0;
    renderAt(currentTime);
    showingPoster = config.renderMode === "preview";
    postHost({ type: "configured", presetId: config.presetId, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postHost({ type: "configure-error", message, requestId });
    throw error;
  }
}

function acknowledge(jobId: string, frame: number): void {
  const key = `${jobId}:${frame}`;
  acknowledgements.get(key)?.();
  acknowledgements.delete(key);
}

async function waitForAck(jobId: string, frame: number): Promise<void> {
  const key = `${jobId}:${frame}`;
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      acknowledgements.delete(key);
      reject(new Error(`Host did not acknowledge frame ${frame}.`));
    }, 30_000);
    acknowledgements.set(key, () => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

async function exportFrames(jobId: string, fps: number): Promise<void> {
  activeRenderJob = jobId;
  stopPlayback();
  showingPoster = false;
  const original = config;
  config = { ...config, renderMode: "export", background: "transparent" };
  sizeCanvas();
  const total = Math.max(1, Math.ceil(config.duration * fps));
  try {
    for (let frame = 0; frame < total; frame += 1) {
      if (activeRenderJob !== jobId) throw new Error("Render cancelled.");
      const time = frame / fps;
      const diagnostics = renderAt(time);
      const dataUrl = canvas.toDataURL("image/png");
      postHost({
        type: "render-frame",
        jobId,
        frame,
        total,
        time,
        dataUrl,
        warnings: diagnostics.warnings,
      });
      await waitForAck(jobId, frame);
    }
    postHost({ type: "render-complete", jobId, total });
  } catch (error) {
    postHost({
      type: "render-error",
      jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeRenderJob = undefined;
    config = original;
    renderAt(0);
  }
}

function handleMessage(raw: unknown): void {
  const message = parseMessage(raw);
  if (!message) return;
  switch (message.type) {
    case "configure":
      if (message.config) void configure(message.config, message.requestId).catch(() => undefined);
      break;
    case "ping":
      if (rendererStartupError) postHost({ type: "renderer-error", message: rendererStartupError });
      else if (rendererReady) postHost({ type: "renderer-ready" });
      break;
    case "play":
      play();
      break;
    case "pause":
      pause();
      break;
    case "replay":
      replay();
      break;
    case "seek":
      stopPlayback();
      showingPoster = false;
      renderAt(Number(message.time ?? 0));
      break;
    case "render-start":
      if (message.jobId) void exportFrames(message.jobId, Math.max(1, Number(message.fps ?? 30)));
      break;
    case "render-cancel":
      activeRenderJob = undefined;
      break;
    case "render-ack":
      if (message.jobId && message.frame !== undefined) acknowledge(message.jobId, message.frame);
      break;
  }
}

window.addEventListener("message", (event) => handleMessage(event.data));
document.addEventListener("message", ((event: Event) => {
  handleMessage((event as CustomEvent).detail ?? (event as MessageEvent).data);
}) as EventListener);

window.motionPlugRenderer = {
  configure,
  renderAt,
  play,
  pause,
  replay,
  dataUrl: () => canvas.toDataURL("image/png"),
  getConfig: () => ({ ...config, values: { ...config.values } }),
};

void (async () => {
  try {
    await loadCustomFont(config.values);
    await waitForFonts();
    sizeCanvas();
    renderAt(0);
    rendererReady = true;
    postHost({ type: "renderer-ready" });
  } catch (error) {
    rendererStartupError = error instanceof Error ? error.message : String(error);
    postHost({ type: "renderer-error", message: rendererStartupError });
  }
})();
