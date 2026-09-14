import type { ControlSpec } from "./types";

const fontOptions = [
  { label: "Inter", value: "Inter Variable" },
  { label: "Arial", value: "Arial" },
  { label: "Helvetica", value: "Helvetica Neue" },
  { label: "Georgia", value: "Georgia" },
];

export const controlRegistry: Record<string, ControlSpec> = {
  title: { id: "title", label: "Headline", type: "textarea", group: "content" },
  subtitle: { id: "subtitle", label: "Supporting text", type: "textarea", group: "content" },
  label: { id: "label", label: "Label", type: "text", group: "content" },
  unit: { id: "unit", label: "Unit", type: "text", group: "content" },
  value: { id: "value", label: "Value", type: "number", group: "content", min: 0, max: 9999, step: 1 },
  sequenceText: {
    id: "sequenceText",
    label: "Words or phrases",
    type: "textarea",
    group: "content",
    description: "One item per line",
  },
  itemsText: {
    id: "itemsText",
    label: "Feature lines",
    type: "textarea",
    group: "content",
    description: "One item per line",
  },
  tile1: { id: "tile1", label: "Tile 1", type: "text", group: "content" },
  tile2: { id: "tile2", label: "Tile 2", type: "text", group: "content" },
  tile3: { id: "tile3", label: "Tile 3", type: "text", group: "content" },
  tile4: { id: "tile4", label: "Tile 4", type: "text", group: "content" },
  valueA: { id: "valueA", label: "First value", type: "number", group: "content", min: 0, max: 1000, step: 1 },
  valueB: { id: "valueB", label: "Second value", type: "number", group: "content", min: 0, max: 1000, step: 1 },
  labelA: { id: "labelA", label: "First label", type: "text", group: "content" },
  labelB: { id: "labelB", label: "Second label", type: "text", group: "content" },
  footnote: { id: "footnote", label: "Footnote", type: "text", group: "content" },
  name: { id: "name", label: "Name", type: "text", group: "content" },
  role: { id: "role", label: "Role", type: "text", group: "content" },
  product: { id: "product", label: "Product", type: "text", group: "content" },
  price: { id: "price", label: "Price", type: "text", group: "content" },
  availability: { id: "availability", label: "Availability", type: "text", group: "content" },

  fontFamily: { id: "fontFamily", label: "Font", type: "select", group: "type", options: fontOptions },
  fontWeight: {
    id: "fontWeight",
    label: "Weight",
    type: "select",
    group: "type",
    options: [
      { label: "Regular", value: 400 },
      { label: "Medium", value: 500 },
      { label: "Semibold", value: 650 },
      { label: "Bold", value: 720 },
      { label: "Heavy", value: 760 },
      { label: "Black", value: 880 },
    ],
  },
  fontSize: { id: "fontSize", label: "Type size", type: "range", group: "type", min: 36, max: 220, step: 1 },
  lineHeight: { id: "lineHeight", label: "Line spacing", type: "range", group: "type", min: 0.75, max: 1.5, step: 0.01 },
  tracking: { id: "tracking", label: "Tracking", type: "range", group: "type", min: -5, max: 24, step: 0.5 },
  alignment: {
    id: "alignment",
    label: "Alignment",
    type: "segmented",
    group: "type",
    options: [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ],
  },

  positionX: { id: "positionX", label: "Horizontal position", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  positionY: { id: "positionY", label: "Vertical position", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  anchorX: { id: "anchorX", label: "Anchor X", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  anchorY: { id: "anchorY", label: "Anchor Y", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  labelX: { id: "labelX", label: "Label X", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  labelY: { id: "labelY", label: "Label Y", type: "range", group: "layout", min: 5, max: 95, step: 1, suffix: "%" },
  safeMargin: { id: "safeMargin", label: "Safe margin", type: "range", group: "layout", min: 4, max: 18, step: 1, suffix: "%" },
  cornerRadius: { id: "cornerRadius", label: "Corner radius", type: "range", group: "layout", min: 0, max: 48, step: 1 },

  textColor: { id: "textColor", label: "Text", type: "color", group: "type" },
  accentColor: { id: "accentColor", label: "Accent", type: "color", group: "type" },
  accentColor2: { id: "accentColor2", label: "Accent end", type: "color", group: "type" },

  entrance: { id: "entrance", label: "Entrance speed", type: "range", group: "motion", min: 0.15, max: 1.4, step: 0.05, suffix: "s" },
  hold: { id: "hold", label: "Hold", type: "range", group: "motion", min: 0.4, max: 5, step: 0.1, suffix: "s" },
  exit: { id: "exit", label: "Exit speed", type: "range", group: "motion", min: 0.15, max: 1.4, step: 0.05, suffix: "s" },
  intensity: { id: "intensity", label: "Motion intensity", type: "range", group: "motion", min: 0, max: 100, step: 1, suffix: "%" },
  stagger: { id: "stagger", label: "Stagger delay", type: "range", group: "motion", min: 0.03, max: 0.8, step: 0.01, suffix: "s" },
  direction: {
    id: "direction",
    label: "Direction",
    type: "select",
    group: "motion",
    options: [
      { label: "Up", value: "up" },
      { label: "Down", value: "down" },
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
    ],
  },
  countEnabled: { id: "countEnabled", label: "Animate number", type: "toggle", group: "motion" },
  loop: { id: "loop", label: "Loop sweep", type: "toggle", group: "motion" },

  sfxEnabled: { id: "sfxEnabled", label: "Add sound effect", type: "toggle", group: "output" },
  sfxVolume: { id: "sfxVolume", label: "Sound level", type: "range", group: "output", min: 0, max: 100, step: 1, suffix: "%" },
};

export function controlsFor(ids: string[]): ControlSpec[] {
  return ids.map((id) => {
    const control = controlRegistry[id];
    if (!control) throw new Error(`Unknown control: ${id}`);
    return control;
  });
}
