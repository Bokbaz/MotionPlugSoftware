import type { SoundSampleId } from "../audio/sample-catalog";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type PreviewBackground = "dark" | "light" | "checker";
export type Alignment = "left" | "center" | "right";

export type PresetFamily =
  | "hero-headline"
  | "specification-reveal"
  | "word-by-word"
  | "rapid-replacement"
  | "masked-line-reveal"
  | "keyword-emphasis"
  | "headline-layout-transition"
  | "feature-stack"
  | "bento-summary"
  | "product-callout"
  | "performance-comparison"
  | "presenter-title"
  | "price-availability"
  | "light-sweep"
  | "soft-focus";

export type ControlType =
  | "text"
  | "textarea"
  | "number"
  | "range"
  | "color"
  | "toggle"
  | "select"
  | "segmented";

export type ControlGroup = "content" | "type" | "layout" | "motion" | "output";

export interface ControlOption {
  label: string;
  value: string | number | boolean;
}

export interface ControlSpec {
  id: string;
  label: string;
  type: ControlType;
  group: ControlGroup;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  description?: string;
  options?: ControlOption[];
}

export type PresetValue = string | number | boolean;
export type PresetValues = Record<string, PresetValue>;

export interface PresetDefinition {
  id: string;
  version: number;
  family: PresetFamily;
  familyName: string;
  name: string;
  variant: string;
  category: string;
  description: string;
  tags: string[];
  duration: number;
  controls: string[];
  defaults: PresetValues;
  sfx: {
    sample: SoundSampleId;
    label: string;
  };
}

export interface RenderConfig {
  presetId: string;
  values: PresetValues;
  width: number;
  height: number;
  duration: number;
  background: PreviewBackground | "transparent";
  renderMode?: "preview" | "export";
}

export interface SavedVariation {
  id: string;
  name: string;
  presetId: string;
  values: PresetValues;
  createdAt: string;
  updatedAt: string;
}

export interface RecentPreset {
  presetId: string;
  usedAt: string;
}

export interface UserPreferences {
  previewBackground: PreviewBackground;
  aspectRatio: AspectRatio;
  sfxEnabled: boolean;
  sfxVolume: number;
  videoTrackPolicy: "auto" | "specific";
  videoTrackIndex: number;
  audioTrackPolicy: "auto" | "specific";
  audioTrackIndex: number;
}

export interface PersistentState {
  schemaVersion: 1;
  favorites: string[];
  recent: RecentPreset[];
  variations: SavedVariation[];
  preferences: UserPreferences;
}

export interface MotionPlugInstance {
  schemaVersion: 1;
  instanceId: string;
  presetId: string;
  presetVersion: number;
  values: PresetValues;
  duration: number;
  fps: number;
  width: number;
  height: number;
  videoTrackIndex: number;
  audioTrackIndex?: number;
  renderVersion: number;
  videoPath: string;
  audioPath?: string;
  createdAt: string;
  updatedAt: string;
}
