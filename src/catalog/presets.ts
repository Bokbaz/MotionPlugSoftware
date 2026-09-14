import { soundForPreset, soundSamples } from "../audio/sample-catalog";
import { migrateKeyword } from "../renderer/highlights";
import type { PresetDefinition, PresetValues } from "./types";

const baseDefaults: PresetValues = {
  fontFamily: "Inter Variable",
  fontWeight: 720,
  fontSize: 112,
  lineHeight: 0.92,
  tracking: -2,
  alignment: "center",
  positionX: 50,
  positionY: 50,
  safeMargin: 8,
  cornerRadius: 26,
  textColor: "#F7F7F2",
  accentColor: "#8CA8FF",
  accentColor2: "#C59CFF",
  transparentBackground: true,
  entrance: 0.55,
  hold: 2.3,
  exit: 0.5,
  intensity: 54,
  stagger: 0.14,
  direction: "up",
  sfxEnabled: true,
  sfxVolume: 68,
};

const typographyControls = ["fontFamily", "fontWeight", "fontSize", "lineHeight", "tracking", "textColor"];
const placementControls = ["positionX", "positionY", "safeMargin"];
const motionControls = ["entrance", "hold", "exit", "intensity"];
const outputControls = ["sfxEnabled", "sfxVolume"];

function preset(
  input: Omit<PresetDefinition, "version" | "defaults" | "sfx"> & { defaults: PresetValues },
): PresetDefinition {
  const defaults = { ...baseDefaults, ...input.defaults };
  if (input.defaults.hold === undefined) {
    defaults.hold = Math.max(
      0.4,
      input.duration - Number(defaults.entrance) - Number(defaults.exit),
    );
  }
  migrateKeyword(defaults);
  return {
    ...input,
    version: 2,
    sfx: { sample: soundForPreset(input.family, input.variant), label: soundSamples[soundForPreset(input.family, input.variant)].label },
    defaults,
  };
}

export const presets: PresetDefinition[] = [
  preset({
    id: "motionplug.hero.centered.v1",
    family: "hero-headline",
    familyName: "Hero Headline",
    name: "Quiet Monument",
    variant: "centered",
    category: "Typography",
    description: "A centered announcement that arrives with scale, air, and a measured hold.",
    tags: ["hero", "headline", "centered", "announcement", "minimal"],
    duration: 4,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", ...placementControls, ...motionControls, ...outputControls],
    defaults: { title: "DESIGNED\nTO MOVE", subtitle: "A considered introduction", fontSize: 148, positionY: 48, intensity: 42 },
  }),
  preset({
    id: "motionplug.hero.editorial.v1",
    family: "hero-headline",
    familyName: "Hero Headline",
    name: "Editorial Horizon",
    variant: "editorial",
    category: "Typography",
    description: "A left-set editorial headline with a fine rule and offset supporting copy.",
    tags: ["hero", "editorial", "left", "rule", "magazine"],
    duration: 4.4,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { title: "A NEW\nPOINT OF VIEW", subtitle: "Edition 01  /  Motion Study", alignment: "left", fontSize: 132, positionX: 10, positionY: 56, intensity: 62 },
  }),

  preset({
    id: "motionplug.spec.lockup.v1",
    family: "specification-reveal",
    familyName: "Big Number / Specification Reveal",
    name: "Metric Lockup",
    variant: "lockup",
    category: "Data",
    description: "An oversized metric locks into place before its unit and caption arrive.",
    tags: ["number", "spec", "metric", "stat", "product"],
    duration: 3.8,
    controls: ["value", "unit", "subtitle", "countEnabled", ...typographyControls, "accentColor", ...placementControls, ...motionControls, ...outputControls],
    defaults: { value: 48, unit: "MP", subtitle: "Main camera system", countEnabled: false, fontSize: 204, tracking: -5, positionY: 51, intensity: 48 },
  }),
  preset({
    id: "motionplug.spec.count.v1",
    family: "specification-reveal",
    familyName: "Big Number / Specification Reveal",
    name: "Precision Count",
    variant: "count",
    category: "Data",
    description: "A compact counter rises into a precise two-column specification layout.",
    tags: ["number", "count", "specification", "technical", "split"],
    duration: 4.2,
    controls: ["value", "unit", "subtitle", "countEnabled", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { value: 120, unit: "Hz", subtitle: "Adaptive refresh rate", countEnabled: true, alignment: "left", fontSize: 188, positionX: 12, positionY: 53, intensity: 64 },
  }),

  preset({
    id: "motionplug.words.rise.v1",
    family: "word-by-word",
    familyName: "Word-by-Word Build",
    name: "Measured Rise",
    variant: "rise",
    category: "Typography",
    description: "Words rise one at a time with speech-friendly timing and a stable final lockup.",
    tags: ["words", "speech", "sequential", "rise", "caption"],
    duration: 4.6,
    controls: ["title", ...typographyControls, "accentColor", ...placementControls, "entrance", "hold", "exit", "intensity", "stagger", ...outputControls],
    defaults: { title: "Every detail [earns] its place", fontSize: 108, positionY: 51, stagger: 0.18, intensity: 55 },
  }),
  preset({
    id: "motionplug.words.track.v1",
    family: "word-by-word",
    familyName: "Word-by-Word Build",
    name: "Kinetic Track",
    variant: "track",
    category: "Typography",
    description: "A sentence assembles along a horizontal track with a moving emphasis marker.",
    tags: ["words", "track", "kinetic", "speech", "horizontal"],
    duration: 4.8,
    controls: ["title", ...typographyControls, "accentColor", "positionY", "safeMargin", "entrance", "hold", "exit", "intensity", "stagger", ...outputControls],
    defaults: { title: "Small moves [change] everything", alignment: "left", fontSize: 92, positionX: 9, positionY: 53, stagger: 0.2, intensity: 72 },
  }),

  preset({
    id: "motionplug.replace.cuts.v1",
    family: "rapid-replacement",
    familyName: "Rapid Word Replacement",
    name: "Rhythmic Cuts",
    variant: "cuts",
    category: "Typography",
    description: "Short phrases cut cleanly at one anchor with individually readable holds.",
    tags: ["replace", "rhythmic", "cut", "words", "fast"],
    duration: 4.2,
    controls: ["sequenceText", ...typographyControls, "accentColor", ...placementControls, "hold", "exit", "intensity", ...outputControls],
    defaults: { sequenceText: "FOCUSED\nFLUID\nFAMILIAR\nYOURS", fontSize: 156, hold: 0.72, intensity: 20 },
  }),
  preset({
    id: "motionplug.replace.swaps.v1",
    family: "rapid-replacement",
    familyName: "Rapid Word Replacement",
    name: "Soft Swaps",
    variant: "swaps",
    category: "Typography",
    description: "Phrases trade places through a clipped vertical swap with subtle depth.",
    tags: ["replace", "swap", "mask", "phrases", "vertical"],
    duration: 4.5,
    controls: ["sequenceText", ...typographyControls, "accentColor", ...placementControls, "hold", "exit", "intensity", ...outputControls],
    defaults: { sequenceText: "LESS NOISE\nMORE SIGNAL\nPURE FOCUS", fontSize: 132, hold: 0.95, intensity: 66 },
  }),

  preset({
    id: "motionplug.masked.lift.v1",
    family: "masked-line-reveal",
    familyName: "Masked Line Reveal",
    name: "Line Lift",
    variant: "up",
    category: "Typography",
    description: "Lines emerge upward from crisp invisible boundaries with exact staggering.",
    tags: ["mask", "lines", "up", "stagger", "reveal"],
    duration: 4.4,
    controls: ["title", ...typographyControls, "accentColor", ...placementControls, "entrance", "hold", "exit", "intensity", "stagger", ...outputControls],
    defaults: { title: "BUILT AROUND\nWHAT MATTERS\nMOST", alignment: "left", fontSize: 124, positionX: 10, positionY: 52, stagger: 0.16, intensity: 64 },
  }),
  preset({
    id: "motionplug.masked.side.v1",
    family: "masked-line-reveal",
    familyName: "Masked Line Reveal",
    name: "Side Passage",
    variant: "side",
    category: "Typography",
    description: "A sideways line reveal creates pace without disturbing the final layout.",
    tags: ["mask", "lines", "side", "editorial", "reveal"],
    duration: 4.2,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", ...placementControls, "entrance", "hold", "exit", "intensity", "stagger", ...outputControls],
    defaults: { title: "FORM\nFOLLOWS\nFEELING", subtitle: "A study in considered motion", alignment: "right", fontSize: 122, positionX: 89, positionY: 50, stagger: 0.14, intensity: 76 },
  }),

  preset({
    id: "motionplug.keyword.color.v1",
    family: "keyword-emphasis",
    familyName: "Keyword Emphasis",
    name: "Chromatic Word",
    variant: "color",
    category: "Typography",
    description: "One chosen word takes color while the surrounding sentence remains perfectly still.",
    tags: ["color", "emphasis", "sentence", "stable"],
    duration: 4.2,
    controls: ["title", ...typographyControls, "accentColor", ...placementControls, ...motionControls, ...outputControls],
    defaults: { title: "Clarity makes ideas [memorable]", fontSize: 104, positionY: 51, intensity: 28 },
  }),
  preset({
    id: "motionplug.keyword.scale.v1",
    family: "keyword-emphasis",
    familyName: "Keyword Emphasis",
    name: "Weight of One",
    variant: "scale",
    category: "Typography",
    description: "The selected word grows with controlled scale while the sentence holds its baseline.",
    tags: ["scale", "emphasis", "baseline", "bold"],
    duration: 4.4,
    controls: ["title", ...typographyControls, "accentColor", ...placementControls, ...motionControls, ...outputControls],
    defaults: { title: "Make the [essential] unmistakable", alignment: "left", fontSize: 96, positionX: 9, positionY: 54, intensity: 56 },
  }),

  preset({
    id: "motionplug.transition.corner.v1",
    family: "headline-layout-transition",
    familyName: "Headline-to-Layout Transition",
    name: "Corner Settle",
    variant: "corner",
    category: "Layout",
    description: "A monumental title resolves into a corner heading as supporting content appears.",
    tags: ["transition", "layout", "corner", "headline", "support"],
    duration: 5.2,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", "safeMargin", ...motionControls, ...outputControls],
    defaults: { title: "THE NEXT\nCHAPTER", subtitle: "Designed from the inside out.\nMade to feel immediate.", fontSize: 154, intensity: 62 },
  }),
  preset({
    id: "motionplug.transition.rail.v1",
    family: "headline-layout-transition",
    familyName: "Headline-to-Layout Transition",
    name: "Rail Shift",
    variant: "rail",
    category: "Layout",
    description: "The title travels onto a vertical rail and opens space for a concise statement.",
    tags: ["transition", "layout", "rail", "shift", "editorial"],
    duration: 5,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", "safeMargin", ...motionControls, ...outputControls],
    defaults: { title: "SPACE\nTO THINK", subtitle: "An interface should leave room for the work.", alignment: "left", fontSize: 146, intensity: 75 },
  }),

  preset({
    id: "motionplug.stack.accumulate.v1",
    family: "feature-stack",
    familyName: "Feature Stack",
    name: "Progressive Stack",
    variant: "accumulate",
    category: "Layout",
    description: "Benefits accumulate vertically and remain visible as the list completes.",
    tags: ["features", "stack", "benefits", "list", "progressive"],
    duration: 5,
    controls: ["title", "itemsText", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", "entrance", "hold", "exit", "stagger", ...outputControls],
    defaults: { title: "WHAT CHANGES", itemsText: "Faster decisions\nCleaner handoffs\nMore room to create\nNothing in the way", alignment: "left", fontSize: 72, positionX: 11, positionY: 52, stagger: 0.28 },
  }),
  preset({
    id: "motionplug.stack.active.v1",
    family: "feature-stack",
    familyName: "Feature Stack",
    name: "Active Line",
    variant: "active",
    category: "Layout",
    description: "A quiet list holds while one active benefit advances down a luminous rail.",
    tags: ["features", "active", "rail", "list", "highlight"],
    duration: 5.4,
    controls: ["title", "itemsText", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", "entrance", "hold", "exit", "stagger", ...outputControls],
    defaults: { title: "BUILT IN", itemsText: "Instant preview\nPrecise timing\nEditable sound\nReliable delivery", alignment: "left", fontSize: 70, positionX: 13, positionY: 51, stagger: 0.72 },
  }),

  preset({
    id: "motionplug.bento.mosaic.v1",
    family: "bento-summary",
    familyName: "Bento Feature Summary",
    name: "Balanced Mosaic",
    variant: "mosaic",
    category: "Layout",
    description: "Four rounded tiles assemble into an asymmetric product summary.",
    tags: ["bento", "tiles", "grid", "features", "cards"],
    duration: 5,
    controls: ["title", "tile1", "tile2", "tile3", "tile4", ...typographyControls, "accentColor", "accentColor2", "cornerRadius", "safeMargin", ...motionControls, "stagger", ...outputControls],
    defaults: { title: "EVERYTHING\nIN ITS PLACE", tile1: "48 MP\nDetail", tile2: "All day\nBattery", tile3: "Spatial\nAudio", tile4: "A18\nPerformance", fontSize: 92, cornerRadius: 30, stagger: 0.12, intensity: 58 },
  }),
  preset({
    id: "motionplug.bento.editorial.v1",
    family: "bento-summary",
    familyName: "Bento Feature Summary",
    name: "Editorial Grid",
    variant: "editorial",
    category: "Layout",
    description: "A restrained two-column grid builds around a typographic lead panel.",
    tags: ["bento", "editorial", "grid", "summary", "modular"],
    duration: 5.2,
    controls: ["title", "tile1", "tile2", "tile3", "tile4", ...typographyControls, "accentColor", "accentColor2", "cornerRadius", "safeMargin", ...motionControls, "stagger", ...outputControls],
    defaults: { title: "LESS,\nBETTER", tile1: "2×\nFaster", tile2: "24 hr\nPlayback", tile3: "4 colors", tile4: "100%\nRecycled", alignment: "left", fontSize: 104, cornerRadius: 18, stagger: 0.16, intensity: 68 },
  }),

  preset({
    id: "motionplug.callout.pin.v1",
    family: "product-callout",
    familyName: "Product Callout",
    name: "Precision Pin",
    variant: "pin",
    category: "Layout",
    description: "A fixed anchor draws a precise connector to an editable product label.",
    tags: ["callout", "pin", "connector", "label", "product"],
    duration: 4.2,
    controls: ["label", "subtitle", ...typographyControls, "accentColor", "anchorX", "anchorY", "labelX", "labelY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { label: "TITANIUM FRAME", subtitle: "Grade 5. Brushed finish.", alignment: "left", fontSize: 64, anchorX: 62, anchorY: 43, labelX: 73, labelY: 29, intensity: 54 },
  }),
  preset({
    id: "motionplug.callout.orbit.v1",
    family: "product-callout",
    familyName: "Product Callout",
    name: "Offset Orbit",
    variant: "orbit",
    category: "Layout",
    description: "A ringed anchor and bent connector create a softer technical annotation.",
    tags: ["callout", "orbit", "connector", "annotation", "fixed"],
    duration: 4.4,
    controls: ["label", "subtitle", ...typographyControls, "accentColor", "anchorX", "anchorY", "labelX", "labelY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { label: "ACTION BUTTON", subtitle: "Your shortcut to anything.", alignment: "left", fontSize: 62, anchorX: 32, anchorY: 56, labelX: 47, labelY: 32, intensity: 67 },
  }),

  preset({
    id: "motionplug.compare.bars.v1",
    family: "performance-comparison",
    familyName: "Performance Comparison",
    name: "Measured Bars",
    variant: "bars",
    category: "Data",
    description: "Two values resolve into proportional bars with labels and a quiet source line.",
    tags: ["comparison", "bars", "performance", "data", "values"],
    duration: 4.8,
    controls: ["title", "labelA", "labelB", "valueA", "valueB", "footnote", ...typographyControls, "accentColor", "accentColor2", "safeMargin", ...motionControls, ...outputControls],
    defaults: { title: "A GENERATIONAL LEAP", labelA: "Previous", labelB: "New", valueA: 64, valueB: 100, footnote: "Relative graphics performance", alignment: "left", fontSize: 82, intensity: 58 },
  }),
  preset({
    id: "motionplug.compare.split.v1",
    family: "performance-comparison",
    familyName: "Performance Comparison",
    name: "Split Measure",
    variant: "split",
    category: "Data",
    description: "A central measure divides two typographic values for an editorial comparison.",
    tags: ["comparison", "split", "measure", "data", "editorial"],
    duration: 4.6,
    controls: ["title", "labelA", "labelB", "valueA", "valueB", "footnote", ...typographyControls, "accentColor", "accentColor2", "safeMargin", ...motionControls, ...outputControls],
    defaults: { title: "MORE FROM EVERY CORE", labelA: "Efficiency", labelB: "Performance", valueA: 35, valueB: 70, footnote: "Improvement over previous generation", fontSize: 76, intensity: 48 },
  }),

  preset({
    id: "motionplug.presenter.left.v1",
    family: "presenter-title",
    familyName: "Minimal Presenter Title",
    name: "Quiet Introduction",
    variant: "left",
    category: "Identity",
    description: "An understated left-aligned name and role with a restrained leading mark.",
    tags: ["presenter", "lower third", "name", "role", "left"],
    duration: 4.6,
    controls: ["name", "role", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { name: "MAYA CHEN", role: "Industrial Designer", alignment: "left", fontSize: 58, positionX: 8, positionY: 82, intensity: 38 },
  }),
  preset({
    id: "motionplug.presenter.right.v1",
    family: "presenter-title",
    familyName: "Minimal Presenter Title",
    name: "Quiet Introduction Right",
    variant: "right",
    category: "Identity",
    description: "A right-aligned presenter title that unfolds from a compact endpoint.",
    tags: ["presenter", "lower third", "name", "role", "right"],
    duration: 4.6,
    controls: ["name", "role", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", ...motionControls, ...outputControls],
    defaults: { name: "ALEX RIVERA", role: "Director of Photography", alignment: "right", fontSize: 58, positionX: 92, positionY: 82, intensity: 46 },
  }),

  preset({
    id: "motionplug.price.center.v1",
    family: "price-availability",
    familyName: "Price and Availability Reveal",
    name: "Launch Price",
    variant: "center",
    category: "Commerce",
    description: "Product, price, and availability arrive in a deliberate centered sequence.",
    tags: ["price", "availability", "launch", "currency", "center"],
    duration: 4.6,
    controls: ["product", "price", "availability", "subtitle", ...typographyControls, "accentColor", ...placementControls, ...motionControls, "stagger", ...outputControls],
    defaults: { product: "AURA ONE", price: "From $799", availability: "Available 09.20", subtitle: "Pre-order Friday", fontSize: 92, positionY: 49, stagger: 0.22, intensity: 42 },
  }),
  preset({
    id: "motionplug.price.side.v1",
    family: "price-availability",
    familyName: "Price and Availability Reveal",
    name: "Price Ledger",
    variant: "side",
    category: "Commerce",
    description: "A side-set product lockup balances a large price against compact availability.",
    tags: ["price", "availability", "ledger", "split", "currency"],
    duration: 4.8,
    controls: ["product", "price", "availability", "subtitle", ...typographyControls, "accentColor", "positionX", "positionY", "safeMargin", ...motionControls, "stagger", ...outputControls],
    defaults: { product: "STUDIO DISPLAY", price: "€1,749", availability: "Ships today", subtitle: "27-inch 5K Retina display", alignment: "left", fontSize: 88, positionX: 9, positionY: 52, stagger: 0.2, intensity: 55 },
  }),

  preset({
    id: "motionplug.sweep.single.v1",
    family: "light-sweep",
    familyName: "Gradient / Light Sweep Text",
    name: "Single Light",
    variant: "single",
    category: "Effects",
    description: "One narrow light sweep travels through stable typography, then disappears.",
    tags: ["light", "sweep", "gradient", "text", "single"],
    duration: 4.4,
    controls: ["title", ...typographyControls, "accentColor", "accentColor2", ...placementControls, ...motionControls, ...outputControls],
    defaults: { title: "LIGHT, PRECISELY", fontSize: 126, intensity: 48, loop: false },
  }),
  preset({
    id: "motionplug.sweep.loop.v1",
    family: "light-sweep",
    familyName: "Gradient / Light Sweep Text",
    name: "Quiet Current",
    variant: "loop",
    category: "Effects",
    description: "A restrained tonal current crosses the title twice without moving the type.",
    tags: ["light", "sweep", "loop", "gradient", "ambient"],
    duration: 5.2,
    controls: ["title", ...typographyControls, "accentColor", "accentColor2", ...placementControls, ...motionControls, "loop", ...outputControls],
    defaults: { title: "ALWAYS IN MOTION", fontSize: 118, intensity: 38, loop: true },
  }),

  preset({
    id: "motionplug.focus.whole.v1",
    family: "soft-focus",
    familyName: "Soft Focus Reveal",
    name: "Whole Resolve",
    variant: "whole",
    category: "Effects",
    description: "The complete title resolves from soft focus with barely perceptible movement.",
    tags: ["focus", "blur", "resolve", "soft", "whole"],
    duration: 4.6,
    controls: ["title", "subtitle", ...typographyControls, "accentColor", ...placementControls, ...motionControls, ...outputControls],
    defaults: { title: "COME INTO FOCUS", subtitle: "Nothing more than what matters", fontSize: 120, intensity: 46 },
  }),
  preset({
    id: "motionplug.focus.words.v1",
    family: "soft-focus",
    familyName: "Soft Focus Reveal",
    name: "Word Resolve",
    variant: "words",
    category: "Effects",
    description: "Words sharpen in sequence and settle into a clean final sentence.",
    tags: ["focus", "blur", "words", "stagger", "resolve"],
    duration: 5,
    controls: ["title", ...typographyControls, "accentColor", ...placementControls, "entrance", "hold", "exit", "intensity", "stagger", ...outputControls],
    defaults: { title: "SEE THE [WHOLE] IDEA", fontSize: 114, stagger: 0.2, intensity: 62 },
  }),
];

export const presetById = new Map(presets.map((item) => [item.id, item]));

export const familyNames = [...new Set(presets.map((item) => item.familyName))];
export const categories = [...new Set(presets.map((item) => item.category))];

export function valuesForPreset(id: string, overrides: PresetValues = {}): PresetValues {
  const item = presetById.get(id);
  if (!item) throw new Error(`Unknown preset: ${id}`);
  const values = { ...item.defaults, ...overrides };
  migrateKeyword(values);
  values.transparentBackground = true;
  delete values.backgroundColor;
  delete values.aspectRatio;
  return values;
}

export function computeDuration(values: PresetValues, fallback: number): number {
  const entrance = Number(values.entrance ?? 0.5);
  const hold = Number(values.hold ?? Math.max(0.6, fallback - 1));
  const exit = Number(values.exit ?? 0.5);
  if (typeof values.sequenceText === "string") {
    const itemCount = Math.max(1, values.sequenceText.split("\n").filter(Boolean).length);
    return Math.max(1, entrance + hold * itemCount + exit);
  }
  return Math.max(1, entrance + hold + exit);
}
