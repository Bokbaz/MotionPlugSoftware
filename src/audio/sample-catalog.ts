import type { PresetFamily } from "../catalog/types";

export const soundSamples = {
  airy: { label: "Airy whoosh", file: "airy.wav" },
  deep: { label: "Dry low impact", file: "deep.wav" },
  wind: { label: "Soft wind", file: "wind.wav" },
  tap: { label: "Phone tap", file: "tap.wav" },
  select: { label: "Soft selection", file: "select.wav" },
  complete: { label: "Subtle completion", file: "complete.wav" },
  menu: { label: "Interface movement", file: "menu.wav" },
  pop: { label: "Interface pop", file: "pop.wav" },
} as const;
export type SoundSampleId = keyof typeof soundSamples;

export function soundForPreset(family: PresetFamily, variant: string): SoundSampleId {
  switch (family) {
    case "hero-headline": return variant === "centered" ? "deep" : "airy";
    case "specification-reveal": return variant === "count" ? "select" : "deep";
    case "word-by-word": return variant === "track" ? "tap" : "select";
    case "rapid-replacement": return variant === "swaps" ? "menu" : "tap";
    case "masked-line-reveal": return "airy";
    case "keyword-emphasis": return variant === "scale" ? "pop" : "complete";
    case "headline-layout-transition": return "airy";
    case "feature-stack": return variant === "active" ? "select" : "tap";
    case "bento-summary": return "pop";
    case "product-callout": return "select";
    case "performance-comparison": return "menu";
    case "presenter-title": return "airy";
    case "price-availability": return "complete";
    case "light-sweep": return "wind";
    case "soft-focus": return variant === "words" ? "menu" : "wind";
  }
}
