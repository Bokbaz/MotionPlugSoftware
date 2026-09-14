import { highlightedRuns, plainText, splitHighlightedText } from "./highlights";
import { presetById, valuesForPreset } from "../catalog/presets";
import type {
  Alignment,
  PresetDefinition,
  PresetValues,
  RenderConfig,
} from "../catalog/types";

export interface RenderDiagnostics {
  warnings: string[];
  overflow: boolean;
}

interface Scene {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scale: number;
  time: number;
  duration: number;
  values: PresetValues;
  preset: PresetDefinition;
  diagnostics: RenderDiagnostics;
}

const TAU = Math.PI * 2;

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));
export const mix = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
export const easeOutQuint = (value: number): number => 1 - (1 - clamp(value)) ** 5;
export const easeOutQuart = (value: number): number => 1 - (1 - clamp(value)) ** 4;
export const easeInQuart = (value: number): number => clamp(value) ** 4;
export const easeInOutCubic = (value: number): number => {
  const x = clamp(value);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};
export const easeOutBack = (value: number, amount = 0.28): number => {
  const x = clamp(value) - 1;
  return 1 + (amount + 1) * x ** 3 + amount * x ** 2;
};
export const settledScale = (value: number, from = 0.94, overshoot = 0.01): number => {
  const x = clamp(value);
  const arrival = 0.72;
  if (x <= arrival) return mix(from, 1 + overshoot, easeOutQuint(x / arrival));
  return mix(1 + overshoot, 1, easeInOutCubic((x - arrival) / (1 - arrival)));
};

function num(values: PresetValues, key: string, fallback = 0): number {
  const value = Number(values[key]);
  return Number.isFinite(value) ? value : fallback;
}

function str(values: PresetValues, key: string, fallback = ""): string {
  const value = values[key];
  return typeof value === "string" ? value : String(value ?? fallback);
}

function bool(values: PresetValues, key: string, fallback = false): boolean {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
}

function color(values: PresetValues, key: string, fallback: string): string {
  const value = str(values, key, fallback);
  return /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}

function phase(scene: Scene, delay = 0, duration?: number): number {
  const length = duration ?? num(scene.values, "entrance", 0.55);
  return clamp((scene.time - delay) / Math.max(0.001, length));
}

function exitPhase(scene: Scene): number {
  const length = Math.max(0.08, num(scene.values, "exit", 0.5));
  return easeInQuart((scene.time - (scene.duration - length)) / length);
}

function overallAlpha(scene: Scene): number {
  const entrance = num(scene.values, "entrance", 0.55);
  const entering = easeOutQuint(scene.time / Math.max(entrance * 0.68, 0.08));
  return entering * (1 - exitPhase(scene));
}

function motionBlur(scene: Scene, progress: number, maximum = 7): string {
  const x = clamp(progress);
  const velocityWindow = Math.sin(Math.PI * x) * (1 - x * 0.28);
  return `blur(${px(scene, maximum) * Math.max(0, velocityWindow)}px)`;
}

function px(scene: Scene, value: number): number {
  return value * scene.scale;
}

function applyExitMotion(scene: Scene): void {
  const progress = exitPhase(scene);
  if (progress <= 0) return;
  const intensity = num(scene.values, "intensity", 50) / 100;
  let x = 0;
  let y = -mix(12, 28, intensity);
  let scale = 1 + mix(0.004, 0.012, intensity) * progress;

  switch (scene.preset.family) {
    case "word-by-word":
      if (scene.preset.variant === "track") { x = 34; y = 0; }
      break;
    case "rapid-replacement":
      y = scene.preset.variant === "swaps" ? -42 : 0;
      scale = scene.preset.variant === "cuts" ? 1 + 0.018 * progress : scale;
      break;
    case "masked-line-reveal":
      if (scene.preset.variant === "side") { x = 30; y = 0; }
      break;
    case "headline-layout-transition":
      x = -22;
      y = -8;
      break;
    case "product-callout":
      x = scene.preset.variant === "orbit" ? 18 : -14;
      y = 0;
      break;
    case "presenter-title":
      x = scene.preset.variant === "right" ? -30 : 30;
      y = 0;
      break;
    case "light-sweep":
      x = 0;
      y = 0;
      scale = 1;
      break;
    case "soft-focus":
      y = 0;
      scale = 1 + 0.014 * progress;
      break;
  }

  if (scale !== 1) {
    scene.ctx.translate(scene.width / 2, scene.height / 2);
    scene.ctx.scale(scale, scale);
    scene.ctx.translate(-scene.width / 2, -scene.height / 2);
  }
  scene.ctx.translate(px(scene, x) * progress, px(scene, y) * progress);
}

function anchor(scene: Scene): { x: number; y: number } {
  return {
    x: (num(scene.values, "positionX", 50) / 100) * scene.width,
    y: (num(scene.values, "positionY", 50) / 100) * scene.height,
  };
}

function alignment(values: PresetValues): Alignment {
  const value = str(values, "alignment", "center");
  return value === "left" || value === "right" ? value : "center";
}

function setType(
  scene: Scene,
  size = num(scene.values, "fontSize", 112),
  weight = num(scene.values, "fontWeight", 720),
): void {
  const family = str(scene.values, "fontFamily", "Inter Variable");
  scene.ctx.font = `${Math.round(weight)} ${Math.max(8, px(scene, size))}px "${family}", Inter, Arial, sans-serif`;
  scene.ctx.textBaseline = "alphabetic";
  scene.ctx.textAlign = alignment(scene.values);
}

function measuredWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  text = plainText(text);
  if (!text) return 0;
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * tracking;
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  if (Math.abs(tracking) < 0.01 || text.length < 2) {
    ctx.fillText(text, x, y);
    return;
  }
  const align = ctx.textAlign;
  const width = measuredWidth(ctx, text, tracking);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  const previous = ctx.textAlign;
  ctx.textAlign = "left";
  for (const glyph of [...text]) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + tracking;
  }
  ctx.textAlign = previous;
}

function drawText(
  scene: Scene,
  text: string,
  x: number,
  y: number,
  options: { size?: number; weight?: number; fill?: string; tracking?: number } = {},
): void {
  setType(scene, options.size, options.weight);
  scene.ctx.fillStyle = options.fill ?? color(scene.values, "textColor", "#F7F7F2");
  const tracking = px(scene, options.tracking ?? num(scene.values, "tracking", -2));
  const runs = highlightedRuns(text);
  if (!runs.some((run) => run.highlighted)) {
    drawTrackedText(scene.ctx, text, x, y, tracking);
    return;
  }
  const ctx = scene.ctx;
  const baseFill = ctx.fillStyle;
  const align = ctx.textAlign;
  const width = measuredWidth(ctx, text, tracking);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  ctx.textAlign = "left";
  for (const run of runs) {
    ctx.fillStyle = run.highlighted ? color(scene.values, "accentColor", "#8CA8FF") : baseFill;
    drawTrackedText(ctx, run.text, cursor, y, tracking);
    cursor += measuredWidth(ctx, run.text, tracking) + tracking;
  }
  ctx.fillStyle = baseFill;
  ctx.textAlign = align;
}

function maxLineWidth(scene: Scene, lines: string[], size: number): number {
  setType(scene, size);
  return Math.max(
    0,
    ...lines.map((line) =>
      measuredWidth(scene.ctx, line, px(scene, num(scene.values, "tracking", -2))),
    ),
  );
}

function fitSize(scene: Scene, lines: string[], requested: number, width: number, min = 28): number {
  let result = requested;
  while (result > min && maxLineWidth(scene, lines, result) > width) result -= 2;
  if (result <= min && maxLineWidth(scene, lines, result) > width) {
    scene.diagnostics.overflow = true;
    if (!scene.diagnostics.warnings.includes("Text exceeds the safe frame.")) {
      scene.diagnostics.warnings.push("Text exceeds the safe frame.");
    }
  }
  return result;
}

function drawLines(
  scene: Scene,
  text: string,
  x: number,
  y: number,
  options: {
    size?: number;
    weight?: number;
    fill?: string;
    progress?: number;
    lineDelay?: number;
    reveal?: "up" | "side" | "fade";
  } = {},
): void {
  const ctx = scene.ctx;
  const lines = splitHighlightedText(text, /\n/g).slice(0, 8);
  const requested = options.size ?? num(scene.values, "fontSize", 112);
  const safe = (num(scene.values, "safeMargin", 8) / 100) * scene.width;
  const size = fitSize(scene, lines, requested, scene.width - safe * 2);
  const lineHeight = px(scene, size * num(scene.values, "lineHeight", 0.92));
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  const progress = options.progress ?? 1;
  const stagger = options.lineDelay ?? num(scene.values, "stagger", 0.14);
  lines.forEach((line, index) => {
    const local = easeOutQuint(clamp((progress - index * stagger) / Math.max(0.1, 1 - index * stagger)));
    const distance = px(scene, 28 + num(scene.values, "intensity", 54) * 0.5);
    ctx.save();
    ctx.globalAlpha *= local;
    if (options.reveal === "up") {
      ctx.beginPath();
      ctx.rect(0, top + index * lineHeight - lineHeight, scene.width, lineHeight * 1.3);
      ctx.clip();
      ctx.translate(0, (1 - local) * distance);
    } else if (options.reveal === "side") {
      const lineWidth = maxLineWidth(scene, [line], size);
      const left = alignment(scene.values) === "right" ? x - lineWidth : alignment(scene.values) === "center" ? x - lineWidth / 2 : x;
      ctx.beginPath();
      ctx.rect(left, top + index * lineHeight - lineHeight, lineWidth * local, lineHeight * 1.4);
      ctx.clip();
      ctx.translate((1 - local) * distance * (alignment(scene.values) === "right" ? -1 : 1), 0);
    } else {
      ctx.translate(0, (1 - local) * distance * 0.35);
    }
    drawText(scene, line, x, top + index * lineHeight, {
      size,
      weight: options.weight,
      fill: options.fill,
    });
    ctx.restore();
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function rgba(hex: string, alpha: number): string {
  const safe = /^#[\da-f]{6}$/i.test(hex) ? hex : "#F7F7F2";
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`;
}

function paintBackground(scene: Scene, config: RenderConfig): void {
  const ctx = scene.ctx;
  ctx.clearRect(0, 0, scene.width, scene.height);
  if (config.renderMode === "export" || config.background === "transparent") return;
  if (config.background === "checker") {
    const cell = Math.max(8, scene.width / 24);
    for (let y = 0; y < scene.height; y += cell) {
      for (let x = 0; x < scene.width; x += cell) {
        ctx.fillStyle = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? "#25262b" : "#34353b";
        ctx.fillRect(x, y, cell, cell);
      }
    }
  } else {
    ctx.fillStyle = config.background === "light" ? "#e8e8e5" : "#111218";
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
}

function hero(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const raw = phase(scene);
  const p = easeOutQuint(raw);
  const alpha = overallAlpha(scene);
  const intensity = num(values, "intensity", 50) / 100;
  ctx.globalAlpha = alpha;
  if (preset.variant === "centered") {
    ctx.save();
    ctx.translate(point.x, point.y);
    const titleScale = settledScale(raw, 0.95 - intensity * 0.035, 0.006 + intensity * 0.006);
    ctx.translate(0, (1 - p) * px(scene, 24 + intensity * 24));
    ctx.rotate((1 - p) * -0.008 * intensity);
    ctx.scale(titleScale, titleScale);
    ctx.translate(-point.x, -point.y);
    ctx.filter = motionBlur(scene, raw, 8);
    drawLines(scene, str(values, "title", "DESIGNED\nTO MOVE"), point.x, point.y, {
      progress: raw,
      lineDelay: 0.1,
      reveal: "fade",
    });
    ctx.restore();
    const accentP = easeOutQuart(phase(scene, 0.2, 0.42));
    ctx.save();
    ctx.globalAlpha *= accentP;
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    roundRect(ctx, point.x - px(scene, 25) * accentP, point.y + px(scene, 116), px(scene, 50) * accentP, px(scene, 3), px(scene, 2));
    ctx.fill();
    ctx.restore();
    const subtitleP = easeOutQuint(phase(scene, 0.32, 0.5));
    ctx.save();
    ctx.globalAlpha *= subtitleP;
    ctx.translate(0, (1 - subtitleP) * px(scene, 16));
    ctx.filter = motionBlur(scene, phase(scene, 0.32, 0.5), 4);
    drawText(scene, str(values, "subtitle"), point.x, point.y + px(scene, 172), {
      size: 30,
      weight: 480,
      fill: rgba(color(values, "textColor", "#F7F7F2"), 0.66),
      tracking: 2.5,
    });
    ctx.restore();
  } else {
    const safeX = point.x;
    ctx.save();
    const startX = safeX - px(scene, 46 + 42 * intensity) * (1 - p);
    ctx.translate(safeX, point.y);
    ctx.rotate((1 - p) * -0.012 * intensity);
    ctx.translate(-safeX, -point.y);
    ctx.filter = motionBlur(scene, raw, 8);
    drawLines(scene, str(values, "title"), startX, point.y, { progress: raw, lineDelay: 0.09, reveal: "side" });
    ctx.restore();
    const lineP = easeOutQuart(phase(scene, 0.24, 0.62));
    ctx.strokeStyle = color(values, "accentColor", "#8CA8FF");
    ctx.lineWidth = px(scene, 3);
    ctx.beginPath();
    ctx.moveTo(safeX, point.y + px(scene, 177));
    ctx.lineTo(safeX + px(scene, 440) * lineP, point.y + px(scene, 177));
    ctx.stroke();
    const subtitleP = easeOutQuint(phase(scene, 0.38, 0.48));
    ctx.save();
    ctx.globalAlpha *= subtitleP;
    ctx.translate((1 - subtitleP) * px(scene, 18), 0);
    drawText(scene, str(values, "subtitle"), safeX, point.y + px(scene, 224), {
      size: 27,
      weight: 480,
      fill: rgba(color(values, "textColor", "#F7F7F2"), 0.68),
      tracking: 1.8,
    });
    ctx.restore();
  }
}

function specification(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const raw = phase(scene);
  const p = easeOutQuint(raw);
  const intensity = num(values, "intensity", 50) / 100;
  const countP = easeOutQuart(phase(scene, 0.05, 0.9));
  const shownValue = num(values, "countEnabled", 0) || preset.variant === "count"
    ? Math.round(num(values, "value", 48) * countP)
    : num(values, "value", 48);
  const unit = str(values, "unit", "MP");
  ctx.globalAlpha = overallAlpha(scene);
  if (preset.variant === "lockup") {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.translate(0, (1 - p) * px(scene, 34 + 28 * intensity));
    ctx.rotate((1 - p) * -0.012 * intensity);
    const scale = settledScale(raw, 0.88, 0.012);
    ctx.scale(scale, scale);
    ctx.translate(-point.x, -point.y);
    ctx.filter = motionBlur(scene, raw, 9);
    drawText(scene, String(shownValue), point.x - px(scene, 34), point.y + px(scene, 62), { size: num(values, "fontSize", 204), weight: 790 });
    ctx.restore();
    const q = easeOutQuint(phase(scene, 0.2, 0.44));
    ctx.save();
    ctx.globalAlpha *= q;
    ctx.translate((1 - q) * px(scene, 20), 0);
    drawText(scene, unit, point.x + px(scene, 265), point.y + px(scene, 52), {
      size: 53,
      weight: 700,
      fill: color(values, "accentColor", "#8CA8FF"),
      tracking: 0,
    });
    ctx.restore();
    const captionP = easeOutQuint(phase(scene, 0.34, 0.46));
    ctx.save();
    ctx.globalAlpha *= captionP;
    ctx.translate(0, (1 - captionP) * px(scene, 14));
    drawText(scene, str(values, "subtitle"), point.x, point.y + px(scene, 152), { size: 28, weight: 480, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.62), tracking: 1.2 });
    ctx.restore();
  } else {
    const left = point.x;
    ctx.save();
    ctx.translate((1 - p) * px(scene, -54 - 34 * intensity), 0);
    ctx.translate(left, point.y);
    ctx.scale(mix(0.97, 1, easeOutBack(raw, 0.34)), 1);
    ctx.translate(-left, -point.y);
    ctx.filter = motionBlur(scene, raw, 8);
    drawText(scene, String(shownValue), left, point.y + px(scene, 56), { size: num(values, "fontSize", 188), weight: 800 });
    ctx.restore();
    const q = easeOutQuart(phase(scene, 0.24, 0.5));
    ctx.save();
    ctx.globalAlpha *= q;
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    ctx.fillRect(left + px(scene, 420), point.y - px(scene, 9) - px(scene, 105) * q, px(scene, 3), px(scene, 210) * q);
    ctx.restore();
    const unitP = easeOutQuint(phase(scene, 0.36, 0.42));
    ctx.save();
    ctx.globalAlpha *= unitP;
    ctx.translate((1 - unitP) * px(scene, 24), 0);
    drawText(scene, unit, left + px(scene, 470), point.y - px(scene, 14), { size: 58, weight: 720, fill: color(values, "accentColor", "#8CA8FF"), tracking: 0 });
    ctx.restore();
    const captionP = easeOutQuint(phase(scene, 0.48, 0.42));
    ctx.save();
    ctx.globalAlpha *= captionP;
    ctx.translate((1 - captionP) * px(scene, 18), 0);
    drawText(scene, str(values, "subtitle"), left + px(scene, 470), point.y + px(scene, 52), { size: 29, weight: 480, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.65), tracking: 0 });
    ctx.restore();
  }
}

function wordByWord(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const words = splitHighlightedText(str(values, "title", "Every detail earns its place").trim(), /\s+/gu).slice(0, 14);
  const point = anchor(scene);
  const size = fitSize(scene, [words.join(" ")], num(values, "fontSize", 108), scene.width * 0.84, 34);
  setType(scene, size);
  const gap = px(scene, size * 0.26);
  const widths = words.map((word) => measuredWidth(ctx, word, px(scene, num(values, "tracking", -2))));
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (words.length - 1);
  const stagger = num(values, "stagger", 0.18);
  let x = preset.variant === "track" ? (num(values, "safeMargin", 8) / 100) * scene.width : point.x - total / 2;
  const starts: number[] = [];
  ctx.globalAlpha = overallAlpha(scene);
  const previousAlignment = values.alignment;
  values.alignment = "left";
  words.forEach((word, index) => {
    starts.push(x);
    const raw = phase(scene, 0.08 + index * stagger, 0.48);
    const p = easeOutQuint(raw);
    const settle = easeOutBack(raw, 0.34);
    const centerX = x + (widths[index] ?? 0) / 2;
    ctx.save();
    ctx.globalAlpha *= easeOutQuart(clamp(raw * 1.4));
    ctx.translate(centerX, point.y);
    if (preset.variant === "rise") {
      ctx.translate(0, (1 - p) * px(scene, 38 + num(values, "intensity", 50) * 0.34));
      ctx.rotate((1 - p) * (index % 2 ? 0.008 : -0.008));
    } else {
      ctx.translate((1 - p) * px(scene, -34 - num(values, "intensity", 50) * 0.18), (1 - p) * px(scene, 8));
    }
    ctx.scale(mix(0.985, 1, settle), mix(0.985, 1, settle));
    ctx.translate(-centerX, -point.y);
    ctx.filter = motionBlur(scene, raw, preset.variant === "rise" ? 7 : 5);
    drawText(scene, word, x, point.y, {
      size,
    });
    ctx.restore();
    x += (widths[index] ?? 0) + gap;
  });
  values.alignment = previousAlignment ?? "center";

  if (preset.variant === "track" && words.length > 0) {
    const markerAlpha = easeOutQuint(phase(scene, 0.12, 0.32));
    const markerTime = Math.max(0, (scene.time - 0.08) / Math.max(stagger, 0.08));
    const markerIndex = Math.min(words.length - 1, Math.floor(markerTime));
    const nextIndex = Math.min(words.length - 1, markerIndex + 1);
    const travel = easeInOutCubic(markerTime - Math.floor(markerTime));
    const markerX = mix(starts[markerIndex] ?? starts[0] ?? 0, starts[nextIndex] ?? starts[markerIndex] ?? 0, travel);
    const markerWidth = mix(widths[markerIndex] ?? 0, widths[nextIndex] ?? widths[markerIndex] ?? 0, travel);
    const railY = point.y + px(scene, 42);
    ctx.save();
    ctx.globalAlpha *= markerAlpha;
    ctx.fillStyle = rgba(color(values, "textColor", "#F7F7F2"), 0.11);
    roundRect(ctx, starts[0] ?? 0, railY, total, px(scene, 3), px(scene, 2));
    ctx.fill();
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    ctx.shadowColor = rgba(color(values, "accentColor", "#8CA8FF"), 0.28);
    ctx.shadowBlur = px(scene, 12);
    roundRect(ctx, markerX, railY - px(scene, 1), markerWidth, px(scene, 5), px(scene, 3));
    ctx.fill();
    ctx.restore();
  }
}

function rapidReplacement(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const items = splitHighlightedText(str(values, "sequenceText", "FOCUSED\nFLUID\nFAMILIAR\nYOURS"), /\n/g).filter(Boolean).slice(0, 8);
  if (items.length === 0) return;
  const intro = Math.min(0.14, num(values, "entrance", 0.55) * 0.22);
  const available = Math.max(0.4, scene.duration - num(values, "exit", 0.5) - intro);
  const slot = available / items.length;
  const raw = clamp((scene.time - intro) / Math.max(slot, 0.01), 0, items.length - 0.0001);
  const index = Math.min(items.length - 1, Math.floor(raw));
  const local = raw - index;
  const point = anchor(scene);
  const overlapStart = preset.variant === "swaps" ? 0.7 : 0.76;
  const firstIn = index === 0 ? easeOutQuint(clamp(local / 0.22)) : 1;
  const nextRaw = index < items.length - 1
    ? clamp((local - overlapStart) / (1 - overlapStart))
    : 0;
  const transitionP = easeInOutCubic(nextRaw);
  const outP = index < items.length - 1
    ? (preset.variant === "swaps" ? transitionP : easeInQuart(nextRaw))
    : 0;
  const nextP = preset.variant === "swaps" ? transitionP : easeOutQuint(nextRaw);
  const baseAlpha = overallAlpha(scene);

  const drawItem = (text: string, entrance: number, exit: number, incoming: boolean, transition: number): void => {
    ctx.save();
    ctx.globalAlpha = baseAlpha * entrance * (1 - exit);
    if (preset.variant === "swaps") {
      ctx.beginPath();
      ctx.rect(0, point.y - px(scene, 170), scene.width, px(scene, 340));
      ctx.clip();
      const travel = px(scene, 164);
      const y = (1 - entrance) * px(scene, 112) + (incoming ? (1 - transition) * travel : -transition * travel);
      ctx.translate(point.x, point.y);
      ctx.translate(0, y);
      ctx.rotate((incoming ? -1 : 1) * Math.sin(Math.PI * transition) * 0.008);
      ctx.scale(mix(0.985, 1, entrance), mix(0.985, 1, entrance));
      ctx.translate(-point.x, -point.y);
      ctx.filter = `blur(${Math.max(0, 1 - entrance) * px(scene, 5) + Math.sin(Math.PI * transition) * px(scene, 4)}px)`;
    } else {
      ctx.translate(point.x, point.y);
      ctx.translate((1 - entrance) * px(scene, 34) - exit * px(scene, 28), 0);
      const scale = mix(0.965, 1, easeOutBack(entrance, 0.22)) + exit * 0.018;
      ctx.scale(scale, scale);
      ctx.translate(-point.x, -point.y);
      ctx.filter = `blur(${px(scene, 4) * Math.max(1 - entrance, exit)}px)`;
    }
    drawLines(scene, text, point.x, point.y, { progress: 1 });
    ctx.restore();
  };

  drawItem(items[index] ?? "", firstIn, outP, false, transitionP);
  if (index < items.length - 1 && nextRaw > 0) {
    drawItem(items[index + 1] ?? "", nextP, 0, true, transitionP);
  }

  if (preset.variant === "cuts") {
    const pulse = easeOutQuart(clamp(local / 0.12)) * (1 - easeInQuart(clamp((local - 0.16) / 0.2)));
    ctx.save();
    ctx.globalAlpha = baseAlpha * pulse * 0.8;
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    const width = px(scene, 92) * easeOutQuart(clamp(local / 0.12));
    roundRect(ctx, point.x - width / 2, point.y + px(scene, 76), width, px(scene, 4), px(scene, 2));
    ctx.fill();
    ctx.restore();
  }
}

function maskedReveal(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const entranceRaw = phase(scene, 0, num(values, "entrance", 0.55) + 0.5);
  ctx.globalAlpha = overallAlpha(scene);
  ctx.save();
  ctx.filter = motionBlur(scene, entranceRaw, preset.variant === "side" ? 7 : 5);
  drawLines(scene, str(values, "title"), point.x, point.y, {
    progress: entranceRaw,
    reveal: preset.variant === "side" ? "side" : "up",
    lineDelay: num(values, "stagger", 0.14),
  });
  ctx.restore();
  if (preset.variant === "side") {
    const p = easeOutQuint(phase(scene, 0.42, 0.5));
    ctx.save();
    ctx.globalAlpha *= p;
    ctx.translate((1 - p) * px(scene, alignment(values) === "right" ? -18 : 18), 0);
    drawText(scene, str(values, "subtitle"), point.x, point.y + px(scene, 206), { size: 27, weight: 460, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.6), tracking: 1 });
    ctx.restore();
  }
}

function keywordEmphasis(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const text = str(values, "title", "Clarity makes ideas memorable");
  const words = splitHighlightedText(text.trim(), /\s+/gu).slice(0, 14);
  const point = anchor(scene);
  const size = fitSize(scene, [text], num(values, "fontSize", 104), scene.width * 0.84, 32);
  setType(scene, size);
  const gap = px(scene, size * 0.34);
  const widths = words.map((word) => measuredWidth(ctx, word, px(scene, num(values, "tracking", -2))));
  const total = widths.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, words.length - 1);
  let x = alignment(values) === "left" ? point.x : alignment(values) === "right" ? point.x - total : point.x - total / 2;
  const baseRaw = phase(scene);
  const base = easeOutQuint(baseRaw);
  const accentRaw = phase(scene, num(values, "entrance", 0.55) * 0.62, 0.58);
  const accent = easeOutBack(accentRaw, 0.26);
  ctx.globalAlpha = overallAlpha(scene);
  ctx.save();
  ctx.globalAlpha *= base;
  ctx.translate(0, (1 - base) * px(scene, 20));
  ctx.filter = motionBlur(scene, baseRaw, 5);
  const previous = values.alignment;
  values.alignment = "left";
  words.forEach((word, index) => {
    const selected = highlightedRuns(word).some((run) => run.highlighted);
    word = plainText(word);
    ctx.save();
    if (selected && preset.variant === "scale") {
      const center = x + (widths[index] ?? 0) / 2;
      ctx.translate(center, point.y);
      const scale = 1 + accent * (num(values, "intensity", 56) / 100) * 0.105;
      ctx.scale(scale, scale);
      ctx.translate(-center, -point.y);
    }
    if (selected && preset.variant === "color") {
      drawText(scene, word, x, point.y, { size });
      ctx.globalAlpha *= clamp(accentRaw);
      drawText(scene, word, x, point.y, { size, fill: color(values, "accentColor", "#8CA8FF") });
    } else {
      drawText(scene, word, x, point.y, {
        size,
        fill: selected ? color(values, "accentColor", "#8CA8FF") : undefined,
      });
    }
    ctx.restore();
    x += (widths[index] ?? 0) + gap;
  });
  values.alignment = previous ?? "center";
  ctx.restore();
}

function headlineTransition(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const entranceRaw = phase(scene);
  const transitionRaw = phase(scene, num(values, "entrance", 0.55) * 0.68, 1.05);
  const t = easeOutQuart(transitionRaw);
  const intensity = num(values, "intensity", 60) / 100;
  const margin = (num(values, "safeMargin", 8) / 100) * scene.width;
  const startX = scene.width / 2;
  const startY = scene.height / 2;
  const endX = preset.variant === "corner" ? margin : margin + px(scene, 54);
  const endY = preset.variant === "corner" ? scene.height * 0.25 : scene.height * 0.32;
  const startSize = num(values, "fontSize", 150);
  const endSize = preset.variant === "corner" ? 64 : 72;
  const currentSize = mix(startSize, endSize, t);
  const titleLines = splitHighlightedText(str(values, "title"), /\n/g).slice(0, 8);
  const currentWidth = maxLineWidth(scene, titleLines, currentSize);
  const currentX = mix(startX - currentWidth / 2, endX, t);
  const currentY = mix(startY, endY, t) - Math.sin(Math.PI * t) * px(scene, 18) * intensity;
  ctx.globalAlpha = overallAlpha(scene);
  const priorAlign = values.alignment;
  values.alignment = "left";
  ctx.save();
  ctx.translate(currentX, currentY);
  ctx.rotate(-Math.sin(Math.PI * t) * 0.008 * intensity);
  ctx.translate(-currentX, -currentY);
  ctx.filter = motionBlur(scene, transitionRaw, 9);
  drawLines(scene, str(values, "title"), currentX, currentY, { size: currentSize, progress: entranceRaw, lineDelay: 0.08, reveal: "fade" });
  ctx.restore();
  values.alignment = priorAlign ?? "center";
  const ruleP = easeOutQuart(phase(scene, 0.72, 0.62));
  ctx.save();
  ctx.globalAlpha *= ruleP;
  if (preset.variant === "rail") {
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    roundRect(ctx, margin, scene.height * 0.18, px(scene, 3), scene.height * 0.55 * ruleP, px(scene, 2));
    ctx.fill();
  } else {
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    roundRect(ctx, margin, scene.height * 0.43, scene.width * 0.3 * ruleP, px(scene, 3), px(scene, 2));
    ctx.fill();
  }
  ctx.restore();
  const supportP = easeOutQuint(phase(scene, 0.82, 0.62));
  const supportX = preset.variant === "corner" ? scene.width * 0.58 : scene.width * 0.56;
  const supportY = preset.variant === "corner" ? scene.height * 0.57 : scene.height * 0.48;
  const supportAlign = values.alignment;
  values.alignment = "left";
  ctx.save();
  ctx.globalAlpha *= supportP;
  ctx.translate((1 - supportP) * px(scene, 34), 0);
  ctx.filter = motionBlur(scene, phase(scene, 0.82, 0.62), 5);
  drawLines(scene, str(values, "subtitle"), supportX, supportY, { size: 39, weight: 480, progress: supportP, lineDelay: 0.1, reveal: "fade" });
  ctx.restore();
  values.alignment = supportAlign ?? "center";
}

function featureStack(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const items = splitHighlightedText(str(values, "itemsText"), /\n/g).filter(Boolean).slice(0, 7);
  const point = anchor(scene);
  const stagger = num(values, "stagger", preset.variant === "active" ? 0.72 : 0.28);
  ctx.globalAlpha = overallAlpha(scene);
  const titleRaw = phase(scene, 0.04, 0.42);
  const titleP = easeOutQuint(titleRaw);
  ctx.save();
  ctx.globalAlpha *= titleP;
  ctx.translate((1 - titleP) * px(scene, 20), 0);
  drawText(scene, str(values, "title"), point.x, point.y - px(scene, 190), { size: 28, weight: 650, fill: color(values, "accentColor", "#8CA8FF"), tracking: 3 });
  ctx.restore();
  const size = num(values, "fontSize", 70);
  const firstY = point.y - px(scene, 70);
  let activePosition = 0;
  if (preset.variant === "active" && items.length > 0) {
    const timeline = Math.max(0, scene.time - 0.48) / Math.max(stagger, 0.15);
    const step = Math.min(items.length - 1, Math.floor(timeline));
    const fraction = timeline - Math.floor(timeline);
    const travel = easeInOutCubic(clamp((fraction - 0.58) / 0.42));
    activePosition = Math.min(items.length - 1, step + travel);
    const indicatorP = easeOutBack(phase(scene, 0.28, 0.42), 0.26);
    const railX = point.x - px(scene, 27);
    ctx.save();
    ctx.globalAlpha *= clamp(indicatorP);
    ctx.strokeStyle = rgba(color(values, "accentColor", "#8CA8FF"), 0.17);
    ctx.lineWidth = px(scene, 2);
    ctx.beginPath();
    ctx.moveTo(railX + px(scene, 3.5), firstY - px(scene, 47));
    ctx.lineTo(railX + px(scene, 3.5), firstY + (items.length - 1) * px(scene, 90) + px(scene, 15));
    ctx.stroke();
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    roundRect(ctx, railX, firstY - px(scene, 48) + activePosition * px(scene, 90), px(scene, 7), px(scene, 62), px(scene, 4));
    ctx.shadowColor = rgba(color(values, "accentColor", "#8CA8FF"), 0.35);
    ctx.shadowBlur = px(scene, 18);
    ctx.fill();
    ctx.restore();
  }
  items.forEach((item, index) => {
    const y = firstY + index * px(scene, 90);
    const raw = phase(scene, 0.16 + index * (preset.variant === "active" ? 0.07 : stagger), 0.46);
    const p = easeOutQuint(raw);
    const proximity = clamp(1 - Math.abs(index - activePosition));
    const activeWeight = easeInOutCubic(proximity);
    ctx.save();
    ctx.globalAlpha *= (preset.variant === "active" ? mix(0.34, 1, activeWeight) : 1) * p;
    ctx.translate((1 - p) * px(scene, 46), (1 - p) * px(scene, 6));
    ctx.rotate((1 - p) * 0.006);
    ctx.filter = motionBlur(scene, raw, 4);
    if (preset.variant === "accumulate") {
      const bulletScale = easeOutBack(raw, 0.42);
      ctx.strokeStyle = rgba(color(values, "accentColor", "#8CA8FF"), 0.6);
      ctx.lineWidth = px(scene, 2);
      ctx.beginPath();
      ctx.arc(point.x - px(scene, 24), y - px(scene, 16), Math.max(0, px(scene, 6) * bulletScale), 0, TAU);
      ctx.stroke();
    }
    drawText(scene, item, point.x, y, { size, weight: preset.variant === "active" && activeWeight > 0.55 ? 700 : 560 });
    ctx.restore();
  });
}

function drawTile(scene: Scene, x: number, y: number, width: number, height: number, text: string, index: number, progress: number, accent = false): void {
  const { ctx, values } = scene;
  const raw = clamp((progress - index * num(values, "stagger", 0.12)) / Math.max(0.2, 1 - index * 0.1));
  const p = easeOutQuart(raw);
  const shapeP = easeOutBack(raw, 0.5);
  const contentRaw = clamp((raw - 0.22) / 0.78);
  const contentP = easeOutQuint(contentRaw);
  ctx.save();
  ctx.globalAlpha *= p;
  const offset = px(scene, 34 + num(values, "intensity", 58) * 0.32) * (1 - p);
  const startWidth = Math.min(width, Math.max(px(scene, 86), width * 0.34));
  const startHeight = Math.min(height, Math.max(px(scene, 38), height * 0.18));
  const currentWidth = mix(startWidth, width, shapeP);
  const currentHeight = mix(startHeight, height, shapeP);
  const currentX = x + (width - currentWidth) / 2;
  const currentY = y + (height - currentHeight) / 2;
  const targetRadius = px(scene, num(values, "cornerRadius", 28));
  const radius = mix(startHeight / 2, targetRadius, p);
  ctx.translate(x + width / 2, y + height / 2);
  ctx.translate(0, offset);
  ctx.rotate((1 - p) * (index % 2 ? 0.012 : -0.012));
  ctx.translate(-(x + width / 2), -(y + height / 2));
  roundRect(ctx, currentX, currentY, currentWidth, currentHeight, radius);
  ctx.fillStyle = accent ? rgba(color(values, "accentColor", "#8CA8FF"), 0.92) : rgba(color(values, "textColor", "#F7F7F2"), 0.075);
  ctx.shadowColor = "rgba(8, 10, 18, 0.24)";
  ctx.shadowBlur = px(scene, 34);
  ctx.shadowOffsetY = px(scene, 12) * (1 - p * 0.55);
  ctx.fill();
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.strokeStyle = accent ? rgba(color(values, "textColor", "#F7F7F2"), 0.18) : rgba(color(values, "textColor", "#F7F7F2"), 0.12);
  ctx.lineWidth = px(scene, 1.5);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, currentX, currentY, currentWidth, currentHeight, radius);
  ctx.clip();
  ctx.globalAlpha *= contentP;
  ctx.translate(0, (1 - contentP) * px(scene, 18));
  ctx.filter = motionBlur(scene, contentRaw, 4);
  const old = values.alignment;
  values.alignment = "left";
  drawLines(scene, text, x + px(scene, 34), y + height / 2 + px(scene, 12), {
    size: Math.min(58, num(values, "fontSize", 92) * 0.52),
    weight: 650,
    fill: accent ? "#111218" : undefined,
    progress: 1,
  });
  values.alignment = old ?? "center";
  ctx.restore();
  ctx.restore();
}

function bento(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const margin = (num(values, "safeMargin", 8) / 100) * scene.width;
  const gap = px(scene, 18);
  const p = phase(scene, 0.05, 1.22);
  ctx.globalAlpha = overallAlpha(scene);
  if (preset.variant === "mosaic") {
    const leadW = scene.width * 0.39;
    const x = margin;
    const y = scene.height * 0.19;
    const h = scene.height * 0.62;
    const old = values.alignment;
    values.alignment = "left";
    drawLines(scene, str(values, "title"), x, scene.height * 0.48, { size: num(values, "fontSize", 92), progress: easeOutQuint(p), reveal: "up" });
    values.alignment = old ?? "center";
    const gx = x + leadW + gap;
    const gw = scene.width - margin - gx;
    drawTile(scene, gx, y, gw * 0.57, h * 0.52 - gap / 2, str(values, "tile1"), 0, p, true);
    drawTile(scene, gx + gw * 0.57 + gap, y, gw * 0.43 - gap, h * 0.52 - gap / 2, str(values, "tile2"), 1, p);
    drawTile(scene, gx, y + h * 0.52 + gap / 2, gw * 0.42, h * 0.48 - gap / 2, str(values, "tile3"), 2, p);
    drawTile(scene, gx + gw * 0.42 + gap, y + h * 0.52 + gap / 2, gw * 0.58 - gap, h * 0.48 - gap / 2, str(values, "tile4"), 3, p);
  } else {
    const x = margin;
    const y = scene.height * 0.17;
    const width = scene.width - margin * 2;
    const height = scene.height * 0.66;
    const leadW = width * 0.46;
    drawTile(scene, x, y, leadW, height, str(values, "title"), 0, p, true);
    const rx = x + leadW + gap;
    const rw = width - leadW - gap;
    drawTile(scene, rx, y, rw, height * 0.36 - gap / 2, str(values, "tile1"), 1, p);
    drawTile(scene, rx, y + height * 0.36 + gap / 2, rw * 0.5 - gap / 2, height * 0.64 - gap / 2, `${str(values, "tile2")}\n${str(values, "tile3")}`, 2, p);
    drawTile(scene, rx + rw * 0.5 + gap / 2, y + height * 0.36 + gap / 2, rw * 0.5 - gap / 2, height * 0.64 - gap / 2, str(values, "tile4"), 3, p);
  }
}

function productCallout(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const ax = (num(values, "anchorX", 60) / 100) * scene.width;
  const ay = (num(values, "anchorY", 45) / 100) * scene.height;
  const requestedLabelX = (num(values, "labelX", 74) / 100) * scene.width;
  const ly = (num(values, "labelY", 30) / 100) * scene.height;
  const labelText = str(values, "label");
  const subtitleText = str(values, "subtitle");
  const labelSize = fitSize(scene, [labelText], num(values, "fontSize", 64), scene.width * 0.74, 26);
  const labelAlign: Alignment = requestedLabelX < ax ? "right" : "left";
  const oldAlignment = values.alignment;
  values.alignment = labelAlign;
  setType(scene, labelSize, 720);
  const labelWidth = measuredWidth(ctx, labelText, px(scene, num(values, "tracking", -2)));
  setType(scene, 25, 470);
  const subtitleWidth = measuredWidth(ctx, subtitleText, 0);
  const blockWidth = Math.max(labelWidth, subtitleWidth);
  const safe = (num(values, "safeMargin", 8) / 100) * scene.width;
  const lx = labelAlign === "right"
    ? clamp(requestedLabelX, safe + blockWidth, scene.width - safe)
    : clamp(requestedLabelX, safe, scene.width - safe - blockWidth);
  const anchorRaw = phase(scene, 0.02, 0.34);
  const anchorP = easeOutBack(anchorRaw, 0.34);
  const pathRaw = phase(scene, 0.1, 0.72);
  const p = easeOutQuart(pathRaw);
  const qRaw = phase(scene, 0.48, 0.5);
  const q = easeOutQuint(qRaw);
  ctx.globalAlpha = overallAlpha(scene);
  ctx.strokeStyle = color(values, "accentColor", "#8CA8FF");
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = px(scene, 2.5);
  if (preset.variant === "pin") {
    ctx.save();
    ctx.globalAlpha *= clamp(anchorP);
    ctx.beginPath();
    ctx.arc(ax, ay, Math.max(0, px(scene, 7) * anchorP), 0, TAU);
    ctx.fill();
    const pulse = Math.sin(Math.PI * anchorRaw) * (1 - pathRaw);
    ctx.globalAlpha *= pulse * 0.45;
    ctx.beginPath();
    ctx.arc(ax, ay, px(scene, mix(10, 24, anchorRaw)), 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(mix(ax, lx, p), mix(ay, ly, p));
    ctx.stroke();
  } else {
    const radius = px(scene, 18);
    const ringP = easeOutQuart(phase(scene, 0.02, 0.44));
    ctx.beginPath();
    ctx.arc(ax, ay, radius * mix(0.72, 1, anchorP), -Math.PI / 2, -Math.PI / 2 + TAU * ringP);
    ctx.stroke();
    const elbowX = mix(ax, lx, 0.48);
    const firstLeg = easeOutQuart(clamp(pathRaw / 0.4));
    const secondLeg = easeInOutCubic(clamp((pathRaw - 0.3) / 0.42));
    const finalLeg = easeOutQuart(clamp((pathRaw - 0.64) / 0.36));
    ctx.beginPath();
    ctx.moveTo(ax + (lx > ax ? radius : -radius), ay);
    ctx.lineTo(mix(ax, elbowX, firstLeg), ay);
    if (pathRaw > 0.3) {
      ctx.lineTo(elbowX, mix(ay, ly, secondLeg));
    }
    if (pathRaw > 0.64) {
      ctx.lineTo(mix(elbowX, lx, finalLeg), ly);
    }
    ctx.stroke();
  }
  ctx.save();
  ctx.globalAlpha *= q;
  ctx.translate((1 - q) * px(scene, labelAlign === "right" ? -22 : 22), 0);
  ctx.filter = motionBlur(scene, qRaw, 4);
  drawText(scene, labelText, lx, ly - px(scene, 16), { size: labelSize, weight: 720 });
  ctx.restore();
  const subtitleP = easeOutQuint(phase(scene, 0.6, 0.46));
  ctx.save();
  ctx.globalAlpha *= subtitleP;
  ctx.translate((1 - subtitleP) * px(scene, labelAlign === "right" ? -15 : 15), 0);
  drawText(scene, subtitleText, lx, ly + px(scene, 40), { size: 25, weight: 470, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.62), tracking: 0 });
  ctx.restore();
  values.alignment = oldAlignment ?? "center";
}

function performanceComparison(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const margin = (num(values, "safeMargin", 8) / 100) * scene.width;
  const a = Math.max(0, num(values, "valueA", 64));
  const b = Math.max(0, num(values, "valueB", 100));
  const max = Math.max(1, a, b);
  const baseAlpha = overallAlpha(scene);
  const titleRaw = phase(scene, 0.02, 0.48);
  const titleP = easeOutQuint(titleRaw);
  ctx.globalAlpha = baseAlpha;
  const old = values.alignment;
  if (preset.variant === "bars") {
    values.alignment = "left";
    ctx.save();
    ctx.globalAlpha *= titleP;
    ctx.translate((1 - titleP) * px(scene, -24), 0);
    ctx.filter = motionBlur(scene, titleRaw, 5);
    drawText(scene, str(values, "title"), margin, scene.height * 0.25, { size: num(values, "fontSize", 82), weight: 760 });
    ctx.restore();
    const barX = margin + px(scene, 260);
    const barW = scene.width - barX - margin - px(scene, 110);
    [
      { label: str(values, "labelA"), value: a, y: scene.height * 0.48, fill: color(values, "accentColor2", "#C59CFF") },
      { label: str(values, "labelB"), value: b, y: scene.height * 0.65, fill: color(values, "accentColor", "#8CA8FF") },
    ].forEach((item, index) => {
      const raw = phase(scene, 0.2 + index * 0.16, 0.86);
      const p = easeOutQuart(raw);
      const labelP = easeOutQuint(phase(scene, 0.12 + index * 0.14, 0.42));
      ctx.save();
      ctx.globalAlpha *= labelP;
      ctx.translate((1 - labelP) * px(scene, -16), 0);
      drawText(scene, item.label, margin, item.y + px(scene, 18), { size: 29, weight: 520, tracking: 0 });
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= easeOutQuint(clamp(raw * 1.7));
      ctx.fillStyle = rgba(item.fill, 0.18);
      roundRect(ctx, barX, item.y - px(scene, 25), barW, px(scene, 54), px(scene, 27));
      ctx.fill();
      const width = barW * (item.value / max) * p;
      if (width > 0.5) {
        ctx.fillStyle = item.fill;
        ctx.shadowColor = rgba(item.fill, 0.18);
        ctx.shadowBlur = px(scene, 16) * Math.sin(Math.PI * raw);
        roundRect(ctx, barX, item.y - px(scene, 25), width, px(scene, 54), px(scene, 27));
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= easeOutQuint(clamp((raw - 0.08) / 0.5));
      values.alignment = "right";
      drawText(scene, String(Math.round(item.value * p)), scene.width - margin, item.y + px(scene, 19), { size: 36, weight: 720, tracking: 0 });
      ctx.restore();
      values.alignment = "left";
    });
  } else {
    values.alignment = "center";
    ctx.save();
    ctx.globalAlpha *= titleP;
    ctx.translate(0, (1 - titleP) * px(scene, 18));
    drawText(scene, str(values, "title"), scene.width / 2, scene.height * 0.25, { size: num(values, "fontSize", 76), weight: 730 });
    ctx.restore();
    const center = scene.width / 2;
    const ruleP = easeOutQuart(phase(scene, 0.2, 0.7));
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    ctx.fillRect(center - px(scene, 1.5), scene.height * 0.555 - scene.height * 0.165 * ruleP, px(scene, 3), scene.height * 0.33 * ruleP);
    [
      { x: center - scene.width * 0.22, value: a, label: str(values, "labelA"), fill: color(values, "accentColor2", "#C59CFF"), delay: 0.2 },
      { x: center + scene.width * 0.22, value: b, label: str(values, "labelB"), fill: color(values, "accentColor", "#8CA8FF"), delay: 0.3 },
    ].forEach((item) => {
      const raw = phase(scene, item.delay, 0.72);
      const countP = easeOutQuart(raw);
      const settle = settledScale(raw, 0.86, 0.01);
      ctx.save();
      ctx.globalAlpha *= easeOutQuint(clamp(raw * 1.35));
      ctx.translate(item.x, scene.height * 0.58);
      ctx.translate(0, (1 - countP) * px(scene, 26));
      ctx.scale(settle, settle);
      ctx.translate(-item.x, -scene.height * 0.58);
      ctx.filter = motionBlur(scene, raw, 6);
      drawText(scene, String(Math.round(item.value * countP)), item.x, scene.height * 0.58, { size: 126, weight: 800, fill: item.fill, tracking: -3 });
      ctx.restore();
      const labelP = easeOutQuint(phase(scene, item.delay + 0.22, 0.42));
      ctx.save();
      ctx.globalAlpha *= labelP;
      ctx.translate(0, (1 - labelP) * px(scene, 12));
      drawText(scene, item.label, item.x, scene.height * 0.67, { size: 28, weight: 500, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.66), tracking: 0 });
      ctx.restore();
    });
  }
  const footnoteP = easeOutQuint(phase(scene, 0.68, 0.5));
  values.alignment = "center";
  ctx.save();
  ctx.globalAlpha *= footnoteP;
  ctx.translate(0, (1 - footnoteP) * px(scene, 10));
  drawText(scene, str(values, "footnote"), scene.width / 2, scene.height - margin * 0.7, { size: 22, weight: 430, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.45), tracking: 0.4 });
  ctx.restore();
  values.alignment = old ?? "center";
}

function presenter(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const raw = phase(scene, 0.04, num(values, "entrance", 0.55) + 0.08);
  const p = easeOutQuint(raw);
  const side = preset.variant === "right" ? -1 : 1;
  ctx.globalAlpha = overallAlpha(scene);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.translate(side * (1 - p) * px(scene, 42 + num(values, "intensity", 42) * 0.22), (1 - p) * px(scene, 12));
  ctx.rotate(side * (1 - p) * -0.018);
  const groupScale = mix(0.975, 1, easeOutBack(raw, 0.3));
  ctx.scale(groupScale, groupScale);
  ctx.translate(-point.x, -point.y);
  ctx.filter = motionBlur(scene, raw, 6);
  const barX = point.x + (preset.variant === "right" ? px(scene, 23) : -px(scene, 29));
  const markP = easeOutBack(phase(scene, 0.02, 0.48), 0.3);
  const markHeight = px(scene, mix(10, 92, markP));
  ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
  roundRect(ctx, barX, point.y - px(scene, 24) - markHeight / 2, px(scene, 6), markHeight, px(scene, 3));
  ctx.fill();
  const nameP = easeOutQuint(phase(scene, 0.11, 0.44));
  ctx.save();
  ctx.globalAlpha *= nameP;
  ctx.translate(side * (1 - nameP) * px(scene, 18), 0);
  drawText(scene, str(values, "name"), point.x, point.y - px(scene, 18), { size: num(values, "fontSize", 58), weight: 690 });
  ctx.restore();
  const roleP = easeOutQuint(phase(scene, 0.24, 0.44));
  ctx.save();
  ctx.globalAlpha *= roleP;
  ctx.translate(side * (1 - roleP) * px(scene, 14), 0);
  drawText(scene, str(values, "role"), point.x, point.y + px(scene, 37), { size: 28, weight: 470, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.62), tracking: 0 });
  ctx.restore();
  ctx.restore();
}

function price(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const stagger = num(values, "stagger", 0.2);
  const p1Raw = phase(scene, 0.05, 0.48);
  const p2Raw = phase(scene, 0.05 + stagger, 0.54);
  const p3Raw = phase(scene, 0.05 + stagger * 2, 0.5);
  const p1 = easeOutQuint(p1Raw);
  const p2 = easeOutBack(p2Raw, 0.4);
  const p3 = easeOutQuint(p3Raw);
  ctx.globalAlpha = overallAlpha(scene);
  if (preset.variant === "center") {
    ctx.save();
    ctx.globalAlpha *= p1;
    ctx.translate(0, (1 - p1) * px(scene, 34));
    ctx.filter = motionBlur(scene, p1Raw, 4);
    drawText(scene, str(values, "product"), point.x, point.y - px(scene, 142), { size: 32, weight: 650, fill: color(values, "accentColor", "#8CA8FF"), tracking: 3 });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= clamp(p2);
    ctx.translate(point.x, point.y + px(scene, 10));
    ctx.translate(0, (1 - easeOutQuint(p2Raw)) * px(scene, 24));
    const priceScale = settledScale(p2Raw, 0.89, 0.012);
    ctx.scale(priceScale, priceScale);
    ctx.translate(-point.x, -(point.y + px(scene, 10)));
    ctx.filter = motionBlur(scene, p2Raw, 7);
    drawText(scene, str(values, "price"), point.x, point.y + px(scene, 10), { size: num(values, "fontSize", 92), weight: 780 });
    ctx.restore();

    setType(scene, 35, 570);
    const availabilityText = str(values, "availability");
    const availabilityWidth = measuredWidth(ctx, availabilityText, 0) + px(scene, 48);
    const capsuleHeight = px(scene, 58);
    const capsuleWidth = mix(capsuleHeight, availabilityWidth, easeOutBack(p3Raw, 0.22));
    ctx.save();
    ctx.globalAlpha *= p3;
    roundRect(ctx, point.x - capsuleWidth / 2, point.y + px(scene, 55), capsuleWidth, capsuleHeight, capsuleHeight / 2);
    ctx.fillStyle = rgba(color(values, "accentColor", "#8CA8FF"), 0.11);
    ctx.fill();
    ctx.strokeStyle = rgba(color(values, "accentColor", "#8CA8FF"), 0.3);
    ctx.lineWidth = px(scene, 1.5);
    ctx.stroke();
    ctx.restore();
    const availabilityP = easeOutQuint(phase(scene, 0.11 + stagger * 2, 0.4));
    ctx.save();
    ctx.globalAlpha *= availabilityP;
    ctx.translate(0, (1 - availabilityP) * px(scene, 10));
    drawText(scene, availabilityText, point.x, point.y + px(scene, 96), { size: 35, weight: 570, tracking: 0 });
    ctx.restore();
    const subtitleP = easeOutQuint(phase(scene, 0.2 + stagger * 2, 0.4));
    ctx.save();
    ctx.globalAlpha *= subtitleP;
    drawText(scene, str(values, "subtitle"), point.x, point.y + px(scene, 160), { size: 24, weight: 450, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.5), tracking: 0 });
    ctx.restore();
  } else {
    const old = values.alignment;
    values.alignment = "left";
    ctx.save();
    ctx.globalAlpha *= p1;
    ctx.translate((1 - p1) * px(scene, -18), 0);
    drawText(scene, str(values, "product"), point.x, point.y - px(scene, 118), { size: 32, weight: 650, fill: color(values, "accentColor", "#8CA8FF"), tracking: 3 });
    ctx.restore();
    const subtitleP = easeOutQuint(phase(scene, 0.14, 0.44));
    ctx.save();
    ctx.globalAlpha *= subtitleP;
    ctx.translate((1 - subtitleP) * px(scene, -14), 0);
    drawText(scene, str(values, "subtitle"), point.x, point.y - px(scene, 70), { size: 24, weight: 450, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.52), tracking: 0 });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= clamp(p2);
    ctx.translate(point.x, point.y + px(scene, 42));
    ctx.translate((1 - easeOutQuint(p2Raw)) * px(scene, 48), 0);
    ctx.scale(mix(0.96, 1, p2), mix(0.96, 1, p2));
    ctx.translate(-point.x, -(point.y + px(scene, 42)));
    ctx.filter = motionBlur(scene, p2Raw, 6);
    drawText(scene, str(values, "price"), point.x, point.y + px(scene, 42), { size: num(values, "fontSize", 88), weight: 790 });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= p3;
    ctx.fillStyle = color(values, "accentColor", "#8CA8FF");
    ctx.fillRect(scene.width * 0.66, point.y - px(scene, 20) - px(scene, 75) * p3, px(scene, 3), px(scene, 150) * p3);
    ctx.translate((1 - p3) * px(scene, 20), 0);
    drawText(scene, str(values, "availability"), scene.width * 0.71, point.y + px(scene, 4), { size: 34, weight: 560, tracking: 0 });
    ctx.restore();
    values.alignment = old ?? "center";
  }
}

function lightSweep(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  const title = str(values, "title", "LIGHT, PRECISELY");
  const size = fitSize(scene, [title], num(values, "fontSize", 126), scene.width * 0.86, 34);
  const base = overallAlpha(scene);
  const titleRaw = phase(scene, 0, 0.64);
  const titleP = easeOutQuint(titleRaw);
  ctx.save();
  ctx.globalAlpha = base * titleP;
  ctx.translate(0, (1 - titleP) * px(scene, 14));
  ctx.filter = motionBlur(scene, titleRaw, 4);
  drawText(scene, title, point.x, point.y, { size, weight: num(values, "fontWeight", 720), fill: rgba(color(values, "textColor", "#F7F7F2"), 0.48) });
  ctx.restore();
  const activeStart = num(values, "entrance", 0.55) * 0.5;
  const activeLength = Math.max(0.7, scene.duration - num(values, "exit", 0.5) - activeStart);
  let sweep = clamp((scene.time - activeStart) / activeLength);
  if (preset.variant === "loop" || bool(values, "loop", false)) sweep = (sweep * 2) % 1;
  const x = mix(-scene.width * 0.2, scene.width * 1.2, easeInOutCubic(sweep));
  const spread = scene.width * mix(0.16, 0.3, num(values, "intensity", 48) / 100);
  ctx.save();
  ctx.globalAlpha = base * titleP * 0.92;
  const gradient = ctx.createLinearGradient(x - spread, 0, x + spread, 0);
  gradient.addColorStop(0, rgba(color(values, "accentColor2", "#C59CFF"), 0));
  gradient.addColorStop(0.36, rgba(color(values, "accentColor2", "#C59CFF"), 0.5));
  gradient.addColorStop(0.5, rgba(color(values, "textColor", "#F7F7F2"), 0.96));
  gradient.addColorStop(0.64, rgba(color(values, "accentColor", "#8CA8FF"), 0.56));
  gradient.addColorStop(1, rgba(color(values, "accentColor", "#8CA8FF"), 0));
  ctx.fillStyle = gradient;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = rgba(color(values, "textColor", "#F7F7F2"), 0.14);
  ctx.shadowBlur = px(scene, 18) * Math.sin(Math.PI * sweep);
  drawText(scene, title, point.x, point.y, { size, fill: gradient as unknown as string });
  ctx.restore();
}

function softFocus(scene: Scene): void {
  const { ctx, values, preset } = scene;
  const point = anchor(scene);
  ctx.globalAlpha = overallAlpha(scene);
  if (preset.variant === "whole") {
    const raw = phase(scene, 0, 0.94);
    const p = easeOutQuint(raw);
    ctx.save();
    ctx.filter = `blur(${(1 - p) * px(scene, 18 + num(values, "intensity", 46) * 0.18)}px)`;
    ctx.translate(point.x, point.y);
    ctx.translate(0, (1 - p) * px(scene, 24));
    const scale = mix(1.035, 1, easeOutQuart(raw));
    ctx.scale(scale, scale);
    ctx.translate(-point.x, -point.y);
    drawLines(scene, str(values, "title"), point.x, point.y, { progress: raw, reveal: "fade" });
    ctx.restore();
    const subtitleRaw = phase(scene, 0.5, 0.52);
    const subtitleP = easeOutQuint(subtitleRaw);
    ctx.save();
    ctx.globalAlpha *= subtitleP;
    ctx.translate(0, (1 - subtitleP) * px(scene, 14));
    ctx.filter = motionBlur(scene, subtitleRaw, 3);
    drawText(scene, str(values, "subtitle"), point.x, point.y + px(scene, 118), { size: 27, weight: 460, fill: rgba(color(values, "textColor", "#F7F7F2"), 0.58), tracking: 1 });
    ctx.restore();
  } else {
    const words = splitHighlightedText(str(values, "title", "SEE THE WHOLE IDEA"), /\s+/gu).slice(0, 10);
      const size = fitSize(scene, [words.join(" ")], num(values, "fontSize", 114), scene.width * 0.84, 34);
    setType(scene, size);
    const gap = px(scene, size * 0.25);
    const widths = words.map((word) => measuredWidth(ctx, word, px(scene, num(values, "tracking", -2))));
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (words.length - 1);
    let x = point.x - total / 2;
    const oldAlignment = values.alignment;
    values.alignment = "left";
    words.forEach((word, index) => {
      const raw = phase(scene, 0.04 + index * num(values, "stagger", 0.2), 0.68);
      const p = easeOutQuint(raw);
      const settle = easeOutBack(raw, 0.28);
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.filter = `blur(${(1 - p) * px(scene, 16)}px)`;
      const centerX = x + (widths[index] ?? 0) / 2;
      ctx.translate(centerX, point.y);
      ctx.translate(0, (1 - p) * px(scene, 20));
      const scale = mix(0.975, 1, settle);
      ctx.scale(scale, scale);
      ctx.translate(-centerX, -point.y);
      drawText(scene, word, x, point.y, { size });
      ctx.restore();
      x += (widths[index] ?? 0) + gap;
    });
    values.alignment = oldAlignment ?? "center";
  }
}

const familyRenderers: Record<PresetDefinition["family"], (scene: Scene) => void> = {
  "hero-headline": hero,
  "specification-reveal": specification,
  "word-by-word": wordByWord,
  "rapid-replacement": rapidReplacement,
  "masked-line-reveal": maskedReveal,
  "keyword-emphasis": keywordEmphasis,
  "headline-layout-transition": headlineTransition,
  "feature-stack": featureStack,
  "bento-summary": bento,
  "product-callout": productCallout,
  "performance-comparison": performanceComparison,
  "presenter-title": presenter,
  "price-availability": price,
  "light-sweep": lightSweep,
  "soft-focus": softFocus,
};

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  config: RenderConfig,
  timeSeconds: number,
): RenderDiagnostics {
  const preset = presetById.get(config.presetId);
  if (!preset) throw new Error(`Unknown preset: ${config.presetId}`);
  const values = valuesForPreset(config.presetId, config.values);
  const width = Math.max(16, config.width);
  const height = Math.max(16, config.height);
  const scene: Scene = {
    ctx,
    width,
    height,
    scale: Math.max(0.1, Math.min(width / 1920, height / 1080)),
    time: clamp(timeSeconds, 0, config.duration),
    duration: Math.max(0.1, config.duration),
    values,
    preset,
    diagnostics: { warnings: [], overflow: false },
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  paintBackground(scene, config);
  applyExitMotion(scene);
  familyRenderers[preset.family](scene);
  ctx.restore();
  return scene.diagnostics;
}

export function aspectDimensions(aspect: string, longEdge = 1280): { width: number; height: number } {
  if (aspect === "9:16") return { width: Math.round((longEdge * 9) / 16), height: longEdge };
  if (aspect === "1:1") return { width: longEdge, height: longEdge };
  return { width: longEdge, height: Math.round((longEdge * 9) / 16) };
}
