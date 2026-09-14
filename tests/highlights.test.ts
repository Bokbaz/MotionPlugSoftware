import { describe, expect, it } from "vitest";
import { highlightedRuns, plainText, splitHighlightedText } from "../src/renderer/highlights";
import { valuesForPreset, presets } from "../src/catalog/presets";
import { validFontSignature } from "../src/fonts/custom-fonts";

describe("inline highlighting", () => {
  it("highlights only the bracketed occurrence, including phrases and punctuation", () => {
    expect(highlightedRuns("Move [this word], then this word.")).toEqual([
      { text: "Move ", highlighted: false }, { text: "this word", highlighted: true }, { text: ", then this word.", highlighted: false },
    ]);
    expect(plainText("[Élan] and [東京!] 🚀")).toBe("Élan and 東京! 🚀");
  });
  it("preserves highlights across word and line animations", () => {
    expect(splitHighlightedText("Keep [these words] together", /\s+/g)).toEqual(["Keep", "[these]", "[words]", "together"]);
    expect(splitHighlightedText("[FIRST\nSECOND]\nTHIRD", /\n/g)).toEqual(["[FIRST]", "[SECOND]", "THIRD"]);
    expect(plainText("Unfinished [input")).toBe("Unfinished [input");
  });
  it("migrates old keyword clips and enforces transparent automatic sizing", () => {
    const values = valuesForPreset(presets[0]!.id, { title: "Make this clear!", keyword: "clear", transparentBackground: false, backgroundColor: "#ff0000", aspectRatio: "1:1" });
    expect(values.title).toBe("Make this [clear]!");
    expect(values.keyword).toBeUndefined();
    expect(values.transparentBackground).toBe(true);
    expect(values.backgroundColor).toBeUndefined();
    expect(values.aspectRatio).toBeUndefined();
    for (const preset of presets) for (const removed of ["keyword", "aspectRatio", "backgroundColor", "transparentBackground"]) expect(preset.controls).not.toContain(removed);
  });
});

describe("custom font validation", () => {
  it("accepts OTF/TTF signatures and rejects renamed non-fonts", () => {
    expect(validFontSignature(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(validFontSignature(new Uint8Array([79, 84, 84, 79, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(validFontSignature(new Uint8Array([80, 78, 71, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(validFontSignature(new Uint8Array([0, 1]))).toBe(false);
  });
});

import { hexToHsv, hsvToHex } from "../src/panel/color-picker";
describe("interactive color model", () => {
  it("round-trips primary, neutral, and custom colors without channel loss", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#000000", "#ffffff", "#808080", "#91a9ff", "#fa48c1"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
  it("adjusts saturation and brightness independently", () => {
    expect(hsvToHex({ h: 0, s: 0, v: 1 })).toBe("#ffffff");
    expect(hsvToHex({ h: 120, s: 1, v: 0.5 })).toBe("#008000");
  });
});
