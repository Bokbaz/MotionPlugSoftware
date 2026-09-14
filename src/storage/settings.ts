import type {
  PersistentState,
  PresetValues,
  RecentPreset,
  SavedVariation,
  UserPreferences,
} from "../catalog/types";

export const SETTINGS_KEY = "motionplug.settings.v1";

export const defaultPreferences: UserPreferences = {
  previewBackground: "checker",
  aspectRatio: "16:9",
  sfxEnabled: true,
  sfxVolume: 68,
  videoTrackPolicy: "auto",
  videoTrackIndex: 0,
  audioTrackPolicy: "auto",
  audioTrackIndex: 0,
};

export const defaultState: PersistentState = {
  schemaVersion: 1,
  favorites: [],
  recent: [],
  variations: [],
  preferences: defaultPreferences,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function recentItems(value: unknown): RecentPreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is RecentPreset => Boolean(item && typeof item.presetId === "string" && typeof item.usedAt === "string"))
    .slice(0, 24);
}

function variations(value: unknown): SavedVariation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is SavedVariation =>
      Boolean(
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.presetId === "string" &&
        item.values &&
        typeof item.values === "object" &&
        typeof item.createdAt === "string" &&
        typeof item.updatedAt === "string",
      ),
  );
}

export function normalizeState(value: unknown): PersistentState {
  if (!value || typeof value !== "object") return clone(defaultState);
  const input = value as Partial<PersistentState>;
  const preferences = (input.preferences ?? {}) as Partial<UserPreferences>;
  return {
    schemaVersion: 1,
    favorites: strings(input.favorites),
    recent: recentItems(input.recent),
    variations: variations(input.variations),
    preferences: {
      ...defaultPreferences,
      ...preferences,
      previewBackground: ["dark", "light", "checker"].includes(String(preferences.previewBackground))
        ? preferences.previewBackground as UserPreferences["previewBackground"]
        : defaultPreferences.previewBackground,
      aspectRatio: ["16:9", "9:16", "1:1"].includes(String(preferences.aspectRatio))
        ? preferences.aspectRatio as UserPreferences["aspectRatio"]
        : defaultPreferences.aspectRatio,
      sfxVolume: Math.min(100, Math.max(0, Number(preferences.sfxVolume ?? defaultPreferences.sfxVolume))),
      videoTrackIndex: Math.max(0, Math.floor(Number(preferences.videoTrackIndex ?? 0))),
      audioTrackIndex: Math.max(0, Math.floor(Number(preferences.audioTrackIndex ?? 0))),
    },
  };
}

export class SettingsStore {
  private state: PersistentState;

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
    this.state = this.read();
  }

  private read(): PersistentState {
    try {
      const serialized = this.storage.getItem(SETTINGS_KEY);
      return serialized ? normalizeState(JSON.parse(serialized)) : clone(defaultState);
    } catch {
      return clone(defaultState);
    }
  }

  private write(): void {
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.state));
    } catch {
      // Keep the in-memory state usable when a host temporarily denies storage.
    }
  }

  snapshot(): PersistentState {
    return clone(this.state);
  }

  updatePreferences(change: Partial<UserPreferences>): PersistentState {
    this.state = normalizeState({
      ...this.state,
      preferences: { ...this.state.preferences, ...change },
    });
    this.write();
    return this.snapshot();
  }

  toggleFavorite(presetId: string): PersistentState {
    const favorite = this.state.favorites.includes(presetId);
    this.state.favorites = favorite
      ? this.state.favorites.filter((id) => id !== presetId)
      : [presetId, ...this.state.favorites];
    this.write();
    return this.snapshot();
  }

  markRecent(presetId: string): PersistentState {
    const item: RecentPreset = { presetId, usedAt: new Date().toISOString() };
    this.state.recent = [item, ...this.state.recent.filter((recent) => recent.presetId !== presetId)].slice(0, 24);
    this.write();
    return this.snapshot();
  }

  saveVariation(presetId: string, name: string, values: PresetValues, id?: string): SavedVariation {
    const now = new Date().toISOString();
    const existing = id ? this.state.variations.find((item) => item.id === id) : undefined;
    const variation: SavedVariation = {
      id: existing?.id ?? `variation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || "Untitled variation",
      presetId,
      values: clone(values),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.state.variations = [variation, ...this.state.variations.filter((item) => item.id !== variation.id)];
    this.write();
    return variation;
  }

  removeVariation(id: string): PersistentState {
    this.state.variations = this.state.variations.filter((item) => item.id !== id);
    this.write();
    return this.snapshot();
  }
}
