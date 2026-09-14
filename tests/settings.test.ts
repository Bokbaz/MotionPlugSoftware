import { describe, expect, it } from "vitest";
import { normalizeState, SettingsStore } from "../src/storage/settings";

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

describe("persistent settings", () => {
  it("repairs malformed and out-of-range preferences", () => {
    const state = normalizeState({
      favorites: ["a", "a", 4],
      preferences: { previewBackground: "neon", sfxVolume: 900, videoTrackIndex: -2 },
    });
    expect(state.favorites).toEqual(["a"]);
    expect(state.preferences.previewBackground).toBe("checker");
    expect(state.preferences.sfxVolume).toBe(100);
    expect(state.preferences.videoTrackIndex).toBe(0);
  });

  it("persists favorites, recents, preferences, and variations", () => {
    const memory = new MemoryStorage();
    const store = new SettingsStore(memory);
    store.toggleFavorite("motionplug.hero.centered.v1");
    store.markRecent("motionplug.hero.centered.v1");
    store.updatePreferences({ aspectRatio: "9:16" });
    store.saveVariation("motionplug.hero.centered.v1", "Vertical launch", { title: "HELLO" });
    const restored = new SettingsStore(memory).snapshot();
    expect(restored.favorites).toContain("motionplug.hero.centered.v1");
    expect(restored.recent[0]?.presetId).toBe("motionplug.hero.centered.v1");
    expect(restored.preferences.aspectRatio).toBe("9:16");
    expect(restored.variations[0]?.values.title).toBe("HELLO");
  });

  it("keeps controls usable when host storage rejects a write", () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); },
    };
    const store = new SettingsStore(storage);
    expect(() => store.toggleFavorite("motionplug.hero.centered.v1")).not.toThrow();
    expect(store.snapshot().favorites).toContain("motionplug.hero.centered.v1");
  });
});
