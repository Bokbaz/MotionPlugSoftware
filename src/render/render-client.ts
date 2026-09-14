import type { RenderConfig } from "../catalog/types";
import { decodeDataUrl, framePath, writeBinary } from "../premiere/filesystem";

export interface RenderProgress {
  frame: number;
  total: number;
  ratio: number;
}

export interface RenderResult {
  frameCount: number;
  warnings: string[];
}

interface RendererMessage {
  type: string;
  jobId?: string;
  frame?: number;
  total?: number;
  dataUrl?: string;
  warnings?: string[];
  message?: string;
  requestId?: string;
}

export interface RendererFrameLike extends HTMLElement {
  postMessage?(message: unknown): void;
  contentWindow?: Window | null;
}

interface ActiveJob {
  id: string;
  folder: string;
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
  warnings: Set<string>;
  progress?: (progress: RenderProgress) => void;
}

export class RenderClient {
  private active?: ActiveJob;
  private ready = false;
  private readyError?: Error;
  private readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timeout: number }>();
  private configurationWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: number }>();
  private readonly elementListener: EventListener;
  private readonly windowListener: (event: MessageEvent) => void;
  private readonly loadErrorListener: EventListener;
  private destroyed = false;

  constructor(private readonly frame: RendererFrameLike) {
    this.elementListener = (event) => {
      void this.receive((event as MessageEvent).data ?? (event as CustomEvent).detail);
    };
    this.windowListener = (event) => {
      if (event.data) void this.receive(event.data);
    };
    this.loadErrorListener = (event) => {
      const detail = event as Event & { message?: string };
      this.failReady(new Error(detail.message || "The preview renderer could not be loaded."));
    };
    this.frame.addEventListener("message", this.elementListener);
    window.addEventListener("message", this.windowListener);
    this.frame.addEventListener("loaderror", this.loadErrorListener);
    this.frame.addEventListener("loadstop", () => this.send({ type: "ping" }));
    this.frame.addEventListener("load", () => this.send({ type: "ping" }));
    window.setTimeout(() => { if (!this.ready && !this.destroyed) this.send({ type: "ping" }); }, 200);
  }

  private parse(raw: unknown): RendererMessage | undefined {
    try {
      if (typeof raw === "string") return JSON.parse(raw) as RendererMessage;
      return raw && typeof raw === "object" ? raw as RendererMessage : undefined;
    } catch {
      return undefined;
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.destroyed) return;
    const serialized = JSON.stringify(message);
    if (typeof this.frame.postMessage === "function") this.frame.postMessage(serialized);
    else this.frame.contentWindow?.postMessage(serialized, "*");
  }

  private failReady(error: Error): void {
    this.readyError = error;
    for (const waiter of this.readyWaiters) {
      window.clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.readyWaiters.clear();
  }

  private async receive(raw: unknown): Promise<void> {
    const message = this.parse(raw);
    if (!message) return;
    if (message.type === "renderer-ready") {
      this.ready = true;
      this.readyError = undefined;
      for (const waiter of this.readyWaiters) {
        window.clearTimeout(waiter.timeout);
        waiter.resolve();
      }
      this.readyWaiters.clear();
      return;
    }
    if (message.type === "renderer-error") {
      this.failReady(new Error(message.message || "The preview renderer failed to start."));
      return;
    }
    if (message.type === "configured" && message.requestId) {
      const waiter = this.configurationWaiters.get(message.requestId);
      if (waiter) {
        window.clearTimeout(waiter.timeout);
        this.configurationWaiters.delete(message.requestId);
        waiter.resolve();
      }
      return;
    }
    if (message.type === "configure-error" && message.requestId) {
      const waiter = this.configurationWaiters.get(message.requestId);
      if (waiter) {
        window.clearTimeout(waiter.timeout);
        this.configurationWaiters.delete(message.requestId);
        waiter.reject(new Error(message.message || "The renderer rejected this preset."));
      }
      return;
    }
    const job = this.active;
    if (!job || message.jobId !== job.id) return;
    if (message.type === "render-frame") {
      try {
        if (message.frame === undefined || !message.dataUrl) throw new Error("Renderer returned an incomplete frame.");
        for (const warning of message.warnings ?? []) job.warnings.add(warning);
        await writeBinary(framePath(job.folder, message.frame), decodeDataUrl(message.dataUrl));
        this.send({ type: "render-ack", jobId: job.id, frame: message.frame });
        const total = Math.max(1, Number(message.total ?? 1));
        job.progress?.({ frame: message.frame + 1, total, ratio: (message.frame + 1) / total });
      } catch (error) {
        this.send({ type: "render-cancel", jobId: job.id });
        this.active = undefined;
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (message.type === "render-complete") {
      this.active = undefined;
      job.resolve({ frameCount: Number(message.total ?? 0), warnings: [...job.warnings] });
    } else if (message.type === "render-error") {
      this.active = undefined;
      job.reject(new Error(message.message || "The animation renderer failed."));
    }
  }

  async waitUntilReady(timeoutMs = 8_000): Promise<void> {
    if (this.ready) return;
    if (this.readyError) throw this.readyError;
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, timeout: 0 };
      waiter.timeout = window.setTimeout(() => {
        this.readyWaiters.delete(waiter);
        reject(new Error("The preview renderer did not become ready."));
      }, timeoutMs);
      this.readyWaiters.add(waiter);
    });
  }

  async configure(config: RenderConfig): Promise<void> {
    await this.waitUntilReady();
    const requestId = `config-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const acknowledgement = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.configurationWaiters.delete(requestId);
        reject(new Error("The renderer did not accept the configuration."));
      }, 8_000);
      this.configurationWaiters.set(requestId, { resolve, reject, timeout });
    });
    this.send({ type: "configure", config, requestId });
    await acknowledgement;
  }

  play(): void { this.send({ type: "play" }); }
  pause(): void { this.send({ type: "pause" }); }
  replay(): void { this.send({ type: "replay" }); }
  seek(time: number): void { this.send({ type: "seek", time }); }

  async render(
    config: RenderConfig,
    fps: number,
    folder: string,
    progress?: (value: RenderProgress) => void,
  ): Promise<RenderResult> {
    if (this.active) throw new Error("Another animation is already rendering.");
    await this.configure({ ...config, renderMode: "export", background: "transparent" });
    const id = `render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<RenderResult>((resolve, reject) => {
      this.active = { id, folder, resolve, reject, warnings: new Set(), progress };
      this.send({ type: "render-start", jobId: id, fps });
    });
  }

  cancel(): void {
    if (!this.active) return;
    const job = this.active;
    this.send({ type: "render-cancel", jobId: job.id });
    this.active = undefined;
    job.reject(new Error("Render cancelled."));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
    this.frame.removeEventListener("message", this.elementListener);
    this.frame.removeEventListener("loaderror", this.loadErrorListener);
    window.removeEventListener("message", this.windowListener);
    for (const waiter of this.configurationWaiters.values()) {
      window.clearTimeout(waiter.timeout);
      waiter.reject(new Error("Renderer closed."));
    }
    this.configurationWaiters.clear();
    for (const waiter of this.readyWaiters) {
      window.clearTimeout(waiter.timeout);
      waiter.reject(new Error("Renderer closed."));
    }
    this.readyWaiters.clear();
  }
}
