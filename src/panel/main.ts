import { bindColorPickers, closeColorPicker } from "./color-picker";
import { createSoundtrack } from "../audio/matched-sfx";
import { categories, computeDuration, presetById, presets, valuesForPreset } from "../catalog/presets";
import { controlsFor } from "../catalog/controls";
import type {
  ControlGroup,
  ControlSpec,
  PersistentState,
  PresetDefinition,
  PresetValue,
  PresetValues,
  RenderConfig,
} from "../catalog/types";
import { getTimelineContext, getSelectedInstance, hostIsAvailable, type TimelineContext } from "../premiere/host";
import { MotionPlugWorkflow, type WorkflowProgress } from "../premiere/workflow";
import { RenderClient, type RendererFrameLike } from "../render/render-client";
import { importCustomFont, listCustomFonts, type CustomFont } from "../fonts/custom-fonts";
import { SettingsStore } from "../storage/settings";

interface MotionPlugUpdateInfo {
  version: string;
  notes: string;
  url: string;
  sha256: string;
  isNewer: boolean;
  restartPending: boolean;
}

interface MotionPlugSignInError extends Error {
  /** 'no-license' (no Motion Plug purchase) or 'revoked' (refunded). */
  code?: string;
}

interface MotionPlugLicense {
  available(): boolean;
  ok(): boolean;
  email(): string;
  machineLabel(): string;
  onChange(listener: () => void): void;
  signIn(email: string, password: string, callback: (error: MotionPlugSignInError | null) => void): void;
  revalidate(onSignedOut?: (message: string) => void): void;
  reset(): void;
  accountUrl(pathname?: string): string;
  init(): boolean;
}

interface MotionPlugUpdater {
  check(manual: boolean, callback?: (error: Error | null, info?: MotionPlugUpdateInfo) => void): boolean;
  install(info: MotionPlugUpdateInfo, onProgress: (percent: number) => void, callback: (error: Error | null, summary?: { version: string }) => void): void;
  restartPending(): boolean;
  startAutoChecks(callback?: (error: Error | null, info?: MotionPlugUpdateInfo) => void): void;
}

declare global {
  interface Window {
    MP_VERSION?: string;
    MP_API_BASE?: string;
    MotionPlugUpdater?: MotionPlugUpdater;
    MotionPlugLicense?: MotionPlugLicense;
  }
}

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("Motion Plug could not find its application root.");
const root: HTMLDivElement = rootElement;

type View = "library" | "detail";
type LibraryScope = "all" | "favorites" | "recent" | "variations" | string;

const groups: Array<{ id: ControlGroup; label: string }> = [
  { id: "content", label: "Content" },
  { id: "type", label: "Typography & color" },
  { id: "layout", label: "Layout" },
  { id: "motion", label: "Timing & motion" },
  { id: "output", label: "Output" },
];

const store = new SettingsStore();
let persisted: PersistentState = store.snapshot();
let view: View = "library";
let scope: LibraryScope = "all";
let search = "";
let categoryFilter = "all";
let customFonts: CustomFont[] = [];
let timelineContext: TimelineContext | undefined;
let timelineError = "";
let refreshingTimeline = false;
const openSections = new Set(["content"]);
let selected: PresetDefinition = presets[0]!;
let values: PresetValues = valuesForPreset(selected.id);
let renderClient: RenderClient | undefined;
let workflow: MotionPlugWorkflow | undefined;
let previewElement: RendererFrameLike | undefined;
let previewResizeListener: (() => void) | undefined;
let previewGeneration = 0;
let previewReady = false;
let previewFailed = false;
let previewTime = 0;
let previewPlaying = false;
let previewPoster = true;
let previewTimer: number | undefined;
let activeAudio: HTMLAudioElement | undefined;
let activeAudioUrl: string | undefined;
let audioGeneration = 0;
let hostAvailable = false;
let busy = false;
let variationEditorOpen = false;
let signedIn = false;
let signInBusy = false;
let availableUpdate: MotionPlugUpdateInfo | undefined;
let updateOperationBusy = false;
let announcedUpdateVersion = "";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function icon(name: "search" | "heart" | "back" | "play" | "pause" | "replay" | "sound" | "sliders" | "plus" | "update" | "close"): string {
  const paths: Record<typeof name, string> = {
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
    heart: '<path d="M20.8 8.8c0 5.7-8.8 10.5-8.8 10.5S3.2 14.5 3.2 8.8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.8 1.8Z"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    replay: '<path d="M4.5 9A8 8 0 1 1 5 16"/><path d="M4.5 4v5h5"/>',
    sound: '<path d="M5 14H2v-4h3l5-4v12l-5-4Z"/><path d="M14 9a4 4 0 0 1 0 6M17 6a8 8 0 0 1 0 12"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    update: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.4 9A7 7 0 0 0 6.8 6.4L4 9M5.6 15A7 7 0 0 0 17.2 17.6L20 15"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function announce(message: string, tone: "neutral" | "success" | "error" = "neutral", timeout = 5000): void {
  let region = document.querySelector<HTMLDivElement>("#toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("aria-live", "assertive");
    document.body.append(region);
  }
  const duplicate = [...region.querySelectorAll<HTMLElement>(".toast span")]
    .find((item) => item.textContent === message);
  if (duplicate) return;
  while (region.children.length >= 2) region.firstElementChild?.remove();
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button class="icon-button toast__close" aria-label="Dismiss">${icon("close")}</button>`;
  toast.querySelector("button")?.addEventListener("click", () => toast.remove());
  region.append(toast);
  window.setTimeout(() => toast.remove(), timeout);
}

function queryPresets(): PresetDefinition[] {
  let items = presets;
  if (scope === "favorites") items = items.filter((item) => persisted.favorites.includes(item.id));
  else if (scope === "recent") {
    const rank = new Map(persisted.recent.map((item, index) => [item.presetId, index]));
    items = items.filter((item) => rank.has(item.id)).sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  } else if (scope !== "all" && scope !== "variations") {
    items = items.filter((item) => item.category === scope);
  }
  if (categoryFilter !== "all") items = items.filter((item) => item.category === categoryFilter);
  const query = search.trim().toLocaleLowerCase();
  if (query) {
    items = items.filter((item) =>
      [item.name, item.familyName, item.category, item.description, ...item.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }
  return items;
}

function cardMarkup(preset: PresetDefinition): string {
  const favorite = persisted.favorites.includes(preset.id);
  return `
    <article class="preset-card" data-preset-id="${escapeHtml(preset.id)}">
      <button class="preset-card__select" aria-label="Open ${escapeHtml(preset.name)}">
        <span class="preset-card__visual">
          <img loading="lazy" src="previews/${escapeHtml(preset.id)}.jpg" alt="" />
          <span class="preset-card__fallback" aria-hidden="true">${escapeHtml(preset.name.split(" ").slice(0, 2).map((word) => word[0]).join(""))}</span>
          <span class="preset-card__play">${icon("play")}</span>
        </span>
        <span class="preset-card__copy">
          <strong>${escapeHtml(preset.name)}</strong>
          <small>${computeDuration(preset.defaults, preset.duration).toFixed(1)}s</small>
        </span>
      </button>
      <button class="favorite-button ${favorite ? "is-active" : ""}" data-favorite="${escapeHtml(preset.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${favorite}">${icon("heart")}</button>
    </article>`;
}

function variationMarkup(): string {
  const query = search.trim().toLocaleLowerCase();
  const items = persisted.variations.filter((item) => {
    const preset = presetById.get(item.presetId);
    return !query || `${item.name} ${preset?.name ?? ""}`.toLocaleLowerCase().includes(query);
  });
  if (!items.length) return emptyMarkup(search ? "No variations match this search." : "Save a customized preset and it will appear here.", "No saved variations");
  return `<div class="variation-list">${items.map((item) => {
    const preset = presetById.get(item.presetId);
    return `<article class="variation-row">
      <button data-variation="${escapeHtml(item.id)}">
        <span class="variation-row__thumb"><img src="previews/${escapeHtml(item.presetId)}.jpg" alt="" /></span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(preset?.name ?? "Missing preset")}</small></span>
      </button>
      <button class="icon-button" data-remove-variation="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}">${icon("close")}</button>
    </article>`;
  }).join("")}</div>`;
}

function emptyMarkup(message: string, title = "Nothing here yet"): string {
  return `<div class="empty-state"><span class="empty-state__mark">MP</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${scope !== "all" ? '<button class="quiet-button" data-clear-filter>Show all presets</button>' : ""}</div>`;
}

function familyGroupsMarkup(items: PresetDefinition[]): string {
  if (scope === "recent" || scope === "favorites") return `<div class="preset-grid">${items.map(cardMarkup).join("")}</div>`;
  const families = [...new Set(items.map((item) => item.family))];
  return families.map((family) => {
    const variants = items.filter((item) => item.family === family);
    return `<section class="preset-family" aria-label="${escapeHtml(variants[0]!.familyName)}"><div class="family-heading"><h2>${escapeHtml(variants[0]!.familyName)}</h2><span>${variants.length} variants</span></div><div class="preset-grid">${variants.map(cardMarkup).join("")}</div></section>`;
  }).join("");
}

function accountStripMarkup(): string {
  // Outside Premiere there is no Node, so there is no account layer at all.
  if (!licenseApi()) return "";
  return `<div class="account-strip" data-account-strip>
    <span class="account-strip__dot"></span>
    <span class="account-strip__text" data-account-text>Checking your account…</span>
    <button class="quiet-button" data-account-action>Sign in</button>
  </div>`;
}

function appUpdateButtonMarkup(): string {
  return `<button type="button" class="app-update-button" data-install-app-update hidden>${icon("update")} <span>Update</span></button>`;
}

function libraryMarkup(): string {
  const items = queryPresets();
  const filterLabel = scope === "all" ? "All presets" : scope === "favorites" ? "Favorites" : scope === "recent" ? "Recently used" : scope === "variations" ? "Saved variations" : scope;
  const count = scope === "variations" ? persisted.variations.length : items.length;
  const navigation = [
    { id: "all", label: "All" },
    { id: "favorites", label: `Favorites${persisted.favorites.length ? ` · ${persisted.favorites.length}` : ""}` },
    { id: "recent", label: "Recent" },
    { id: "variations", label: "Variations" },
  ];
  return `
    <main class="library">
      <header class="app-header">
        <div class="brand"><span class="brand__mark"><img src="icons/motionplug-logo.png" alt="" /></span><span><strong>Motion Plug</strong><small>Motion, ready when you are.</small></span></div>
        <div class="app-header__actions">${appUpdateButtonMarkup()}<span class="host-pill ${hostAvailable ? "is-live" : ""}" title="${hostAvailable ? "Connected to Premiere" : "Preview mode"}"><i></i>${hostAvailable ? "Premiere" : "Preview"}</span></div>
      </header>
      <section class="library-tools" aria-label="Browse presets">
        <label class="search-field">${icon("search")}<input id="preset-search" type="search" placeholder="Search 30 presets" value="${escapeHtml(search)}" autocomplete="off" aria-label="Search presets" /><kbd>⌘K</kbd></label>
        <nav class="filter-strip" aria-label="Preset filters">${navigation.map((item) => `<button class="filter-chip ${scope === item.id ? "is-active" : ""}" data-scope="${escapeHtml(item.id)}" aria-pressed="${scope === item.id}">${escapeHtml(item.label)}</button>`).join("")}</nav>
        ${scope !== "variations" ? `<label class="category-filter"><span>Category</span><select data-category aria-label="Preset category"><option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${categoryFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label>` : ""}
      </section>
      <section class="library-content" aria-labelledby="library-heading">
        <div class="section-heading"><div><p>Library</p><h1 id="library-heading">${escapeHtml(filterLabel)}</h1></div><span>${count} ${count === 1 ? "item" : "items"}</span></div>
        ${scope === "variations" ? variationMarkup() : items.length ? familyGroupsMarkup(items) : emptyMarkup(search ? "Try a broader name, family, category, or tag." : "Use the heart on a preset to keep it close.", search ? "No matching presets" : undefined)}
      </section>
      <footer class="library-footer">
        ${accountStripMarkup()}
        <div class="library-footer__meta"><span>v${escapeHtml(window.MP_VERSION ?? "0.3.0")} · 30 presets · Offline</span><div><button class="quiet-button" data-check-updates ${hostAvailable ? "" : "disabled"}>Check for updates</button><button class="quiet-button" data-load-selected>${icon("update")} Edit timeline selection</button></div></div>
      </footer>
    </main>`;
}

function inputMarkup(control: ControlSpec): string {
  const current = values[control.id] ?? "";
  const id = `control-${control.id}`;
  if (control.type === "textarea") {
    return `<label class="field field--wide" for="${id}"><span>${escapeHtml(control.label)}</span><textarea id="${id}" data-control="${control.id}" rows="${control.id === "itemsText" || control.id === "sequenceText" ? 4 : 2}" placeholder="${escapeHtml(control.placeholder ?? "")}">${escapeHtml(current)}</textarea>${control.description ? `<small>${escapeHtml(control.description)}</small>` : ""}</label>`;
  }
  if (control.type === "text" || control.type === "number") {
    return `<label class="field ${control.type === "text" ? "field--wide" : ""}" for="${id}"><span>${escapeHtml(control.label)}</span><input id="${id}" data-control="${control.id}" type="${control.type}" value="${escapeHtml(current)}" ${control.min !== undefined ? `min="${control.min}"` : ""} ${control.max !== undefined ? `max="${control.max}"` : ""} ${control.step !== undefined ? `step="${control.step}"` : ""} /></label>`;
  }
  if (control.type === "range") {
    return `<label class="field field--range" for="${id}"><span>${escapeHtml(control.label)}<span data-output="${control.id}">${escapeHtml(current)}${escapeHtml(control.suffix ?? "")}</span></span><input id="${id}" data-control="${control.id}" type="range" value="${escapeHtml(current)}" min="${control.min ?? 0}" max="${control.max ?? 100}" step="${control.step ?? 1}" /></label>`;
  }
  if (control.type === "color") {
    return `<label class="field field--color" for="${id}"><span>${escapeHtml(control.label)}</span><span class="color-input"><input class="color-picker" type="color" data-color-picker="${control.id}" value="${escapeHtml(current)}" aria-label="Pick ${escapeHtml(control.label.toLowerCase())} color" title="Choose a color" /><input id="${id}" data-control="${control.id}" type="text" maxlength="7" value="${escapeHtml(current)}" aria-label="${escapeHtml(control.label)} hex color" /></span></label>`;
  }
  if (control.type === "toggle") {
    return `<label class="toggle-field" for="${id}"><span><strong>${escapeHtml(control.label)}</strong>${control.description ? `<small>${escapeHtml(control.description)}</small>` : ""}</span><input id="${id}" data-control="${control.id}" type="checkbox" ${current ? "checked" : ""} /><i aria-hidden="true"></i></label>`;
  }
  if (control.type === "select") {
    const options = [...(control.options ?? [])];
    if (control.id === "fontFamily") {
      options.push(...customFonts.map((font) => ({ label: font.name, value: font.family })));
      if (!options.some((option) => option.value === current)) options.push({ label: String(values.fontName ?? current), value: String(current) });
    }
    return `<label class="field ${control.id === "fontFamily" ? "field--wide" : ""}" for="${id}"><span>${escapeHtml(control.label)}</span><select id="${id}" data-control="${control.id}">${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(current) === String(option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>${control.id === "fontFamily" ? '<div class="font-import field--wide"><button class="quiet-button" data-import-font type="button">Import font…</button><span>OTF or TTF · saved locally</span><input data-font-file type="file" accept=".otf,.ttf" hidden /></div>' : ""}`;
  }
  return `<fieldset class="segmented-field field--wide"><legend>${escapeHtml(control.label)}</legend><div>${(control.options ?? []).map((option) => `<button type="button" class="${String(current) === String(option.value) ? "is-active" : ""}" data-segment-control="${control.id}" data-value="${escapeHtml(option.value)}" aria-pressed="${String(current) === String(option.value)}">${escapeHtml(option.label)}</button>`).join("")}</div></fieldset>`;
}

function controlsMarkup(): string {
  const controls = controlsFor(selected.controls);
  return groups.map((group) => {
    const matching = controls.filter((control) => control.group === group.id);
    if (!matching.length) return "";
    return `<section data-section="${group.id}" class="control-section ${openSections.has(group.id) ? "is-open" : ""}">
      <button class="control-section__heading" aria-expanded="${openSections.has(group.id)}" type="button"><span>${escapeHtml(group.label)}</span><i></i></button>
      <div class="control-section__body">${group.id === "content" ? '<p class="content-help">Put <strong>[square brackets]</strong> around words to highlight them. Brackets won’t appear in your graphic.</p>' : ""}<div class="control-grid">${matching.map(inputMarkup).join("")}</div>${group.id === "output" ? `<p class="sound-match">${escapeHtml(selected.sfx.label)} · follows the animation timing</p>${timelineOptionsMarkup()}` : ""}</div>
    </section>`;
  }).join("");
}

function timelineOptionsMarkup(): string {
  const p = persisted.preferences;
  return `<div class="timeline-options"><p>Timeline destination</p><div class="control-grid">
    <label class="field"><span>Video track</span><select data-preference="videoTrackPolicy"><option value="auto" ${p.videoTrackPolicy === "auto" ? "selected" : ""}>Next free track</option><option value="specific" ${p.videoTrackPolicy === "specific" ? "selected" : ""}>Specific track</option></select></label>
    <label class="field"><span>V track number</span><input data-preference="videoTrackIndex" type="number" min="1" max="99" value="${p.videoTrackIndex + 1}" ${p.videoTrackPolicy === "auto" ? "disabled" : ""} /></label>
    <label class="field"><span>Audio track</span><select data-preference="audioTrackPolicy"><option value="auto" ${p.audioTrackPolicy === "auto" ? "selected" : ""}>Next free track</option><option value="specific" ${p.audioTrackPolicy === "specific" ? "selected" : ""}>Specific track</option></select></label>
    <label class="field"><span>A track number</span><input data-preference="audioTrackIndex" type="number" min="1" max="99" value="${p.audioTrackIndex + 1}" ${p.audioTrackPolicy === "auto" ? "disabled" : ""} /></label>
  </div><small>Auto uses a free track and retries a new one if Premiere rejects a locked destination.</small></div>`;
}

function detailMarkup(): string {
  const favorite = persisted.favorites.includes(selected.id);
  const duration = computeDuration(values, selected.duration);
  return `
    <main class="detail-view">
      <header class="detail-header">
        <button class="icon-button" data-back aria-label="Back to presets">${icon("back")}</button>
        <div><small>${escapeHtml(selected.familyName)}</small><strong>${escapeHtml(selected.name)}</strong></div>
        <div class="detail-header__actions">${appUpdateButtonMarkup()}<button class="icon-button favorite-button ${favorite ? "is-active" : ""}" data-favorite="${escapeHtml(selected.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${favorite}">${icon("heart")}</button></div>
      </header>
      <nav class="variant-switcher" aria-label="Animation variants">${presets.filter((preset) => preset.family === selected.family).map((preset) => `<button data-variant="${preset.id}" class="${preset.id === selected.id ? "is-active" : ""}" aria-pressed="${preset.id === selected.id}">${escapeHtml(preset.name)}</button>`).join("")}</nav>
      <div class="detail-workspace">
        <div class="preview-column">
          <section class="preview-shell">
            <div class="preview-frame" id="preview-frame">
              <div id="preview-host" class="preview-host is-connecting">
                <img class="preview-poster" src="previews/${escapeHtml(selected.id)}.jpg" alt="" />
                <div class="preview-status" data-preview-status><i></i><strong>Connecting live preview</strong><small>Loading the exact animation renderer</small></div>
                <div class="preview-fallback is-hidden" data-preview-fallback><span>Reference frame</span><strong>Live preview unavailable</strong><small data-preview-error></small><button class="quiet-button" data-preview-retry>Retry renderer</button></div>
              </div>
            </div>
            <div class="preview-controls" aria-label="Preview controls">
              <button class="icon-button" data-preview-play aria-label="Play preview">${icon("play")}</button>
              <button class="icon-button" data-preview-replay aria-label="Replay preview">${icon("replay")}</button>
              <input data-preview-scrub type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Preview position" />
              <time data-preview-time>0:00 / ${formatTime(duration)}</time>
              <button class="icon-button" data-audition aria-label="Preview animation with matched sound" title="Preview animation with matched sound">${icon("sound")}</button>
            </div>
            <div class="preview-options">
              <span>Transparent</span><span class="preview-options__spacer"></span><span data-timeline-size>${escapeHtml(timelineLabel())}</span>
            </div>
            <p id="preview-warning" class="inline-warning is-hidden"></p>
          </section>
          <section class="preset-intro"><p>${escapeHtml(selected.description)}</p><div>${selected.tags.slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>
        </div>
        <section class="customization" aria-label="Customize preset">
          <div class="customization__heading"><div><p>Inspector</p><h1>Customize</h1></div><button class="quiet-button" data-reset>Reset</button></div>
          ${controlsMarkup()}
          <button class="save-variation-button" data-save-variation>${icon("plus")} Save as variation</button>
          ${variationEditorOpen ? `<div class="variation-editor"><label class="field"><span>Variation name</span><input id="variation-name" maxlength="60" value="${escapeHtml(`${selected.name} variation`)}" /></label><button class="primary-small" data-confirm-variation>Save</button><button class="quiet-button" data-cancel-variation>Cancel</button></div>` : ""}
        </section>
      </div>
      <div class="action-spacer"></div>
      <footer class="action-bar">
        <div class="action-bar__status"><i class="${hostAvailable ? "is-live" : ""}"></i><span>${hostAvailable ? "Starting renderer" : "Preview mode · Premiere required"}</span></div>
        <div class="action-bar__buttons">
          <button class="secondary-action" data-update disabled>${icon("update")} Update selected</button>
          <button class="primary-action" data-add disabled>${icon("plus")} ${hostAvailable ? "Add to timeline" : "Premiere required"}</button>
        </div>
      </footer>
      <div class="busy-overlay ${busy ? "" : "is-hidden"}" id="busy-overlay" aria-live="assertive"><div><span class="render-orbit"><i></i></span><strong data-progress-label>Preparing animation…</strong><small data-progress-detail>Creating editable project media</small><progress max="1" value="0"></progress><button class="quiet-button" data-cancel-render>Cancel</button></div></div>
    </main>`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const tenths = Math.floor((seconds - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths}`;
}

function render(): void {
  closeColorPicker();
  previewGeneration += 1;
  previewReady = false;
  previewFailed = false;
  window.clearTimeout(previewTimer);
  stopAudio();
  window.removeEventListener("message", previewWindowListener);
  if (previewResizeListener) window.removeEventListener("resize", previewResizeListener);
  previewResizeListener = undefined;
  renderClient?.destroy();
  renderClient = undefined;
  workflow = undefined;
  previewElement = undefined;
  root.innerHTML = view === "library" ? libraryMarkup() : detailMarkup();
  view === "library" ? bindLibrary() : bindDetail();
  bindUpdaterActions();
  refreshUpdaterUi();
  bindAccountActions();
  refreshAccountUi();
}

function bindLibrary(): void {
  const searchInput = document.querySelector<HTMLInputElement>("#preset-search");
  searchInput?.addEventListener("input", () => {
    search = searchInput.value;
    render();
    const next = document.querySelector<HTMLInputElement>("#preset-search");
    next?.focus();
    next?.setSelectionRange(search.length, search.length);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-scope]").forEach((button) => button.addEventListener("click", () => {
    scope = button.dataset.scope ?? "all";
    search = "";
    render();
  }));
  document.querySelector<HTMLSelectElement>("[data-category]")?.addEventListener("change", (event) => {
    categoryFilter = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  document.querySelector<HTMLButtonElement>("[data-clear-filter]")?.addEventListener("click", () => { scope = "all"; categoryFilter = "all"; search = ""; render(); });
  document.querySelectorAll<HTMLElement>(".preset-card").forEach((card) => {
    const id = card.dataset.presetId;
    card.querySelector<HTMLButtonElement>(".preset-card__select")?.addEventListener("click", () => id && openPreset(id));
    card.querySelector<HTMLImageElement>("img")?.addEventListener("error", (event) => (event.currentTarget as HTMLElement).classList.add("is-missing"));
  });
  bindFavorites();
  document.querySelectorAll<HTMLButtonElement>("[data-variation]").forEach((button) => button.addEventListener("click", () => {
    const variation = persisted.variations.find((item) => item.id === button.dataset.variation);
    if (!variation || !presetById.has(variation.presetId)) return announce("That variation's source preset is missing.", "error");
    openPreset(variation.presetId, variation.values);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-remove-variation]").forEach((button) => button.addEventListener("click", () => {
    persisted = store.removeVariation(button.dataset.removeVariation ?? "");
    render();
  }));
  document.querySelector<HTMLButtonElement>("[data-load-selected]")?.addEventListener("click", () => void loadTimelineSelection());
  bindCardKeyboard();
}

/* ------------------------------ account ---------------------------------- */

/**
 * The account layer, or undefined where it cannot run: outside Premiere, or in
 * a CEP panel without Node. Every account path goes through this, so those
 * cases simply have no account layer rather than a gate nobody can pass.
 */
function licenseApi(): MotionPlugLicense | undefined {
  if (!hostAvailable) return undefined;
  const license = window.MotionPlugLicense;
  if (!license) return undefined;
  try { return license.available() ? license : undefined; }
  catch { return undefined; }
}

function bindAccountActions(): void {
  document.querySelector<HTMLButtonElement>("[data-account-action]")
    ?.addEventListener("click", () => (signedIn ? signOutOfAccount() : openSignInGate()));
}

function refreshAccountUi(): void {
  const strip = document.querySelector<HTMLElement>("[data-account-strip]");
  if (!strip) return;
  const text = strip.querySelector<HTMLElement>("[data-account-text]");
  const action = strip.querySelector<HTMLButtonElement>("[data-account-action]");
  strip.classList.toggle("is-signed-in", signedIn);
  const email = licenseApi()?.email() ?? "";
  if (text) text.textContent = signedIn ? `Signed in as ${email || "your account"}` : "Not signed in on this machine";
  if (action) action.textContent = signedIn ? "Sign out" : "Sign in";
  updateActionAvailability();
}

function signOutOfAccount(): void {
  const license = licenseApi();
  if (!license) return;
  const confirmed = window.confirm(
    "Sign out of Motion Plug on this machine?\n\n" +
    "This machine keeps its activation slot until you free it from your account page.",
  );
  if (!confirmed) return;
  license.reset();
  announce("Signed out on this machine.", "neutral");
}

function closeSignInGate(): void {
  document.querySelector("#account-gate")?.remove();
}

/**
 * The sign-in overlay. Dismissable on purpose: browsing presets and previewing
 * them costs nothing, so only the actions that put a graphic on the timeline
 * are gated (see requireAccount).
 */
function openSignInGate(): void {
  const license = licenseApi();
  if (!license || license.ok() || document.querySelector("#account-gate")) return;

  const overlay = document.createElement("div");
  overlay.id = "account-gate";
  overlay.className = "busy-overlay account-gate";
  overlay.innerHTML = `<div class="account-gate__card" role="dialog" aria-label="Sign in to Motion Plug" aria-modal="true">
    <span class="account-gate__mark"><img src="icons/motionplug-logo.png" alt="" /></span>
    <strong>Sign in to your account</strong>
    <small>Use the email and password from your captionplug.com account — the one you bought Motion Plug with. One-time step on this machine; your license covers 3 machines.</small>
    <label class="field field--wide" for="account-email"><span>Email</span><input id="account-email" type="email" autocomplete="username" spellcheck="false" placeholder="you@studio.com" /></label>
    <label class="field field--wide" for="account-password"><span>Password</span><input id="account-password" type="password" autocomplete="current-password" placeholder="Your password" /></label>
    <p class="account-gate__error is-hidden" data-gate-error role="alert"></p>
    <div class="account-gate__links">
      <button class="quiet-button" type="button" data-gate-reset>Forgot password?</button>
      <button class="quiet-button" type="button" data-gate-pricing>Get Motion Plug</button>
    </div>
    <div class="account-gate__actions">
      <button class="quiet-button" type="button" data-gate-dismiss>Not now</button>
      <button class="primary-small" type="button" data-gate-submit>Sign in</button>
    </div>
    <p class="account-gate__foot">This machine: ${escapeHtml(license.machineLabel())} · works offline once signed in · your password is never stored</p>
  </div>`;
  document.body.append(overlay);

  const emailField = overlay.querySelector<HTMLInputElement>("#account-email");
  const passwordField = overlay.querySelector<HTMLInputElement>("#account-password");
  const errorField = overlay.querySelector<HTMLElement>("[data-gate-error]");
  const submit = overlay.querySelector<HTMLButtonElement>("[data-gate-submit]");

  function showError(message: string): void {
    if (!errorField) return;
    errorField.textContent = message;
    errorField.classList.remove("is-hidden");
  }

  const attempt = (): void => {
    if (signInBusy || !submit) return;
    errorField?.classList.add("is-hidden");
    signInBusy = true;
    submit.disabled = true;
    submit.textContent = "Signing in…";
    license.signIn(emailField?.value ?? "", passwordField?.value ?? "", (error) => {
      signInBusy = false;
      submit.disabled = false;
      submit.textContent = "Sign in";
      if (error) {
        showError(error.code === "no-license"
          ? `${error.message} Buy it once at captionplug.com/motion-plug, then sign in again.`
          : error.message);
        return;
      }
      closeSignInGate();
      announce(`Signed in as ${license.email()} on ${license.machineLabel()}.`, "success", 7000);
    });
  };

  overlay.querySelector<HTMLButtonElement>("[data-gate-submit]")?.addEventListener("click", attempt);
  overlay.querySelector<HTMLButtonElement>("[data-gate-dismiss]")?.addEventListener("click", closeSignInGate);
  overlay.querySelector<HTMLButtonElement>("[data-gate-reset]")
    ?.addEventListener("click", () => window.CSBridge?.openURL(license.accountUrl("/reset")));
  overlay.querySelector<HTMLButtonElement>("[data-gate-pricing]")
    ?.addEventListener("click", () => window.CSBridge?.openURL(license.accountUrl("/motion-plug")));
  [emailField, passwordField].forEach((field) => field?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") attempt();
  }));
  emailField?.focus();
}

/** Gate for the actions that produce output. True = signed in, go ahead. */
function requireAccount(): boolean {
  const license = licenseApi();
  if (!license) return true; // outside Premiere the host check reports first
  if (license.ok()) return true;
  announce("Sign in with your captionplug.com account first — a one-time step on this machine.", "neutral", 7000);
  openSignInGate();
  return false;
}

function bindUpdaterActions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-install-app-update]").forEach((button) => {
    button.addEventListener("click", installAvailableUpdate);
  });
  document.querySelector<HTMLButtonElement>("[data-check-updates]")?.addEventListener("click", checkForUpdatesManually);
}

function refreshUpdaterUi(): void {
  const restartPending = Boolean(window.MotionPlugUpdater?.restartPending());
  document.querySelectorAll<HTMLButtonElement>("[data-install-app-update]").forEach((button) => {
    button.hidden = !restartPending && !availableUpdate?.isNewer;
    button.disabled = updateOperationBusy || restartPending;
    const label = button.querySelector("span");
    if (label) label.textContent = restartPending ? "Restart Premiere" : availableUpdate ? `Update to ${availableUpdate.version}` : "Update";
  });
  const checkButton = document.querySelector<HTMLButtonElement>("[data-check-updates]");
  if (checkButton) {
    checkButton.disabled = updateOperationBusy || !hostAvailable || !window.MotionPlugUpdater;
    checkButton.textContent = updateOperationBusy ? "Checking…" : "Check for updates";
  }
}

function acceptUpdateCheck(error: Error | null, info?: MotionPlugUpdateInfo, manual = false): void {
  updateOperationBusy = false;
  if (error) {
    if (manual) announce(error.message || "Could not check for updates.", "error", 8000);
    refreshUpdaterUi();
    return;
  }
  if (!info) {
    refreshUpdaterUi();
    return;
  }
  availableUpdate = info;
  refreshUpdaterUi();
  if (info.restartPending) {
    if (manual) announce(`Motion Plug ${info.version} is installed. Restart Premiere Pro to load it.`, "success", 9000);
  } else if (info.isNewer) {
    if (manual || announcedUpdateVersion !== info.version) {
      announcedUpdateVersion = info.version;
      announce(`Motion Plug ${info.version} is available.`, "neutral", 8000);
    }
  } else if (manual) {
    announce(`Motion Plug ${window.MP_VERSION ?? ""} is up to date.`, "success");
  }
}

function checkForUpdatesManually(): void {
  if (updateOperationBusy) return;
  const updater = window.MotionPlugUpdater;
  if (!updater) return announce("The updater is unavailable in this build.", "error");
  updateOperationBusy = true;
  refreshUpdaterUi();
  try {
    updater.check(true, (error, info) => acceptUpdateCheck(error, info, true));
  } catch (error) {
    acceptUpdateCheck(error instanceof Error ? error : new Error(String(error)), undefined, true);
  }
}

function showUpdateProgress(percent: number): void {
  let overlay = document.querySelector<HTMLDivElement>("#app-update-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "app-update-overlay";
    overlay.className = "busy-overlay app-update-overlay";
    overlay.innerHTML = `<div><span class="render-orbit"><i></i></span><strong>Installing Motion Plug update…</strong><small>Downloading and validating a complete release</small><progress max="100" value="0"></progress></div>`;
    document.body.append(overlay);
  }
  const progress = overlay.querySelector<HTMLProgressElement>("progress");
  const detail = overlay.querySelector<HTMLElement>("small");
  if (progress) progress.value = percent;
  if (detail) detail.textContent = percent > 0 ? `${percent}% downloaded · your current installation stays recoverable` : "Preparing secure download";
}

function installAvailableUpdate(): void {
  if (updateOperationBusy) return;
  const updater = window.MotionPlugUpdater;
  if (updater?.restartPending()) return announce("Restart Premiere Pro to load the installed update.", "success", 9000);
  if (!updater || !availableUpdate?.isNewer) return;
  updateOperationBusy = true;
  refreshUpdaterUi();
  showUpdateProgress(0);
  updater.install(availableUpdate, showUpdateProgress, (error, summary) => {
    updateOperationBusy = false;
    document.querySelector("#app-update-overlay")?.remove();
    refreshUpdaterUi();
    if (error) return announce(error.message || "The update could not be installed.", "error", 10_000);
    announce(`Motion Plug ${summary?.version ?? availableUpdate?.version ?? ""} is installed. Restart Premiere Pro to finish.`, "success", 12_000);
    refreshUpdaterUi();
  });
}

function bindCardKeyboard(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".preset-card__select")];
  buttons.forEach((button, index) => button.addEventListener("keydown", (event) => {
    const columns = Math.max(1, Math.round((button.closest(".preset-grid")?.clientWidth ?? 320) / (button.closest(".preset-card")?.clientWidth ?? 160)));
    let next = index;
    if (event.key === "ArrowRight") next += 1;
    else if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") next -= columns;
    else return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }));
}

function bindFavorites(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-favorite]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    persisted = store.toggleFavorite(button.dataset.favorite ?? "");
    if (view === "library" && scope === "favorites") render();
    else {
      const active = persisted.favorites.includes(button.dataset.favorite ?? "");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }));
}

function openPreset(id: string, override?: PresetValues): void {
  const preset = presetById.get(id);
  if (!preset) return;
  selected = preset;
  values = valuesForPreset(id, override ?? { sfxEnabled: persisted.preferences.sfxEnabled, sfxVolume: persisted.preferences.sfxVolume });
  const font = customFonts.find((item) => item.family === values.fontFamily);
  if (font && !values.fontData) values.fontData = font.data;
  view = "detail";
  variationEditorOpen = false;
  render();
  void refreshTimeline();
}

function timelineLabel(): string {
  return timelineContext ? `${timelineContext.width} × ${timelineContext.height} · Timeline` : hostAvailable ? (timelineError || "Reading timeline…") : "Matches timeline in Premiere";
}

async function refreshTimeline(): Promise<void> {
  if (!hostAvailable || refreshingTimeline || busy) return;
  refreshingTimeline = true;
  try {
    const next = await getTimelineContext();
    const changed = !timelineContext || next.width !== timelineContext.width || next.height !== timelineContext.height || next.sequenceId !== timelineContext.sequenceId;
    timelineContext = next;
    timelineError = "";
    if (changed && view === "detail") {
      syncPreviewElementSize();
      await updatePreview(true);
    }
  } catch {
    timelineContext = undefined;
    timelineError = "Open an active sequence";
  } finally {
    refreshingTimeline = false;
    const label = document.querySelector<HTMLElement>("[data-timeline-size]");
    if (label) label.textContent = timelineLabel();
    updateActionAvailability();
  }
}

function updateActionAvailability(): void {
  const available = hostAvailable && Boolean(timelineContext) && previewReady && Boolean(workflow) && !busy;
  document.querySelectorAll<HTMLButtonElement>("[data-add], [data-update]").forEach((button) => {
    button.disabled = !available;
  });
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-preview-play], [data-preview-replay], [data-preview-scrub]").forEach((control) => {
    control.disabled = !previewReady;
  });
  const status = document.querySelector<HTMLElement>(".action-bar__status span");
  if (!status) return;
  if (!hostAvailable) status.textContent = "Preview mode · Premiere required";
  // The Add/Update buttons stay clickable when signed out: the click opens the
  // sign-in gate, which explains the one-time step better than a dead button.
  else if (licenseApi() && !signedIn) status.textContent = "Sign in to add graphics to the timeline";
  else if (!timelineContext) status.textContent = timelineError || "Reading active sequence";
  else if (busy) status.textContent = "Preparing timeline media";
  else if (previewReady) status.textContent = "Renderer ready · Premiere connected";
  else if (previewFailed) status.textContent = "Renderer unavailable · retry preview";
  else status.textContent = "Starting renderer";
}

function syncPreviewElementSize(): void {
  const host = document.querySelector<HTMLDivElement>("#preview-host");
  const element = previewElement;
  if (!host || !element) return;
  const frame = document.querySelector<HTMLElement>("#preview-frame");
  if (frame) {
    const ratio = timelineContext ? timelineContext.width / timelineContext.height : 16 / 9;
    const availableWidth = frame.parentElement?.clientWidth ? frame.parentElement.clientWidth - 24 : 320;
    const width = Math.min(availableWidth, (window.innerWidth < 620 ? 360 : 420) * ratio);
    frame.style.width = `${Math.max(16, width)}px`;
    frame.style.height = `${Math.max(16, width / ratio)}px`;
    frame.style.marginLeft = frame.style.marginRight = "auto";
  }
  const rect = host.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || host.clientWidth || 320));
  const height = Math.max(1, Math.round(rect.height || host.clientHeight || 180));
  element.setAttribute("width", `${width}px`);
  element.setAttribute("height", `${height}px`);
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function showPreviewFallback(error: unknown, generation: number): void {
  if (generation !== previewGeneration) return;
  previewReady = false;
  previewFailed = true;
  renderClient?.destroy();
  renderClient = undefined;
  workflow = undefined;
  previewElement?.remove();
  previewElement = undefined;
  const host = document.querySelector<HTMLDivElement>("#preview-host");
  const fallback = host?.querySelector<HTMLElement>("[data-preview-fallback]");
  const detail = fallback?.querySelector<HTMLElement>("[data-preview-error]");
  host?.classList.remove("is-connecting", "is-ready");
  host?.classList.add("is-fallback");
  host?.querySelector<HTMLElement>("[data-preview-status]")?.classList.add("is-hidden");
  fallback?.classList.remove("is-hidden");
  if (detail) {
    const message = error instanceof Error ? error.message : String(error);
    detail.textContent = `${message} The shipped reference frame is shown instead.`;
  }
  updateActionAvailability();
}

function createPreview(): void {
  const host = document.querySelector<HTMLDivElement>("#preview-host");
  if (!host) return;
  previewGeneration += 1;
  const generation = previewGeneration;
  previewReady = false;
  previewFailed = false;
  renderClient?.destroy();
  renderClient = undefined;
  workflow = undefined;
  previewElement?.remove();
  previewElement = undefined;
  host.classList.remove("is-ready", "is-fallback");
  host.classList.add("is-connecting");
  host.querySelector<HTMLElement>("[data-preview-status]")?.classList.remove("is-hidden");
  host.querySelector<HTMLElement>("[data-preview-fallback]")?.classList.add("is-hidden");
  const element = document.createElement("iframe") as RendererFrameLike;
  element.className = "preview-renderer";
  element.setAttribute("src", "renderer.html");
  element.setAttribute("title", `${selected.name} customized preview`);
  // CEP uses a regular same-origin iframe. Explicit dimensions keep the canvas
  // pinned to its preview frame while a floating panel is being resized.
  const hostRect = host.getBoundingClientRect();
  const initialWidth = Math.max(1, Math.round(hostRect.width || host.clientWidth || 320));
  const initialHeight = Math.max(1, Math.round(hostRect.height || host.clientHeight || 180));
  element.setAttribute("width", `${initialWidth}px`);
  element.setAttribute("height", `${initialHeight}px`);
  element.style.width = `${initialWidth}px`;
  element.style.height = `${initialHeight}px`;
  element.setAttribute("sandbox", "allow-scripts allow-same-origin");
  host.appendChild(element);
  previewElement = element;
  syncPreviewElementSize();
  window.requestAnimationFrame(syncPreviewElementSize);
  if (previewResizeListener) window.removeEventListener("resize", previewResizeListener);
  previewResizeListener = () => window.requestAnimationFrame(syncPreviewElementSize);
  window.addEventListener("resize", previewResizeListener);
  renderClient = new RenderClient(element);
  workflow = new MotionPlugWorkflow(renderClient);
  element.addEventListener("message", (event) => handlePreviewMessage((event as MessageEvent).data ?? (event as CustomEvent).detail));
  window.addEventListener("message", previewWindowListener);
  updateActionAvailability();
  void updatePreview(true, generation);
}

function previewWindowListener(event: MessageEvent): void {
  handlePreviewMessage(event.data);
}

function handlePreviewMessage(raw: unknown): void {
  try {
    const message = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
    if (!message || message.type !== "render-state") return;
    previewTime = Number(message.time ?? 0);
    previewPlaying = Boolean(message.playing);
    if (!previewPlaying && activeAudio && previewTime >= Number(message.duration ?? 0) - 0.02) stopAudio();
    const scrub = document.querySelector<HTMLInputElement>("[data-preview-scrub]");
    const time = document.querySelector<HTMLElement>("[data-preview-time]");
    const button = document.querySelector<HTMLButtonElement>("[data-preview-play]");
    const duration = computeDuration(values, selected.duration);
    if (scrub && document.activeElement !== scrub) scrub.value = String(previewTime);
    if (time) time.textContent = `${formatTime(previewTime)} / ${formatTime(duration)}`;
    if (button) {
      button.innerHTML = icon(previewPlaying ? "pause" : "play");
      button.setAttribute("aria-label", previewPlaying ? "Pause preview" : "Play preview");
    }
    const warning = document.querySelector<HTMLParagraphElement>("#preview-warning");
    const warnings = Array.isArray(message.warnings) ? message.warnings.filter((item): item is string => typeof item === "string") : [];
    if (warning) {
      warning.textContent = warnings.join(" ");
      warning.classList.toggle("is-hidden", !warnings.length);
    }
  } catch {
    // Ignore messages from unrelated frames.
  }
}

function currentPreviewConfig(): RenderConfig {
  const ratio = timelineContext ? timelineContext.width / timelineContext.height : 16 / 9;
  const dimensions = ratio >= 1 ? { width: 960, height: Math.round(960 / ratio) } : { width: Math.round(960 * ratio), height: 960 };
  return {
    presetId: selected.id,
    values,
    ...dimensions,
    duration: computeDuration(values, selected.duration),
    background: "checker",
    renderMode: "preview",
  };
}

async function updatePreview(immediate = false, generation = previewGeneration): Promise<void> {
  if (!renderClient && previewFailed && view === "detail") { createPreview(); return; }
  stopAudio();
  window.clearTimeout(previewTimer);
  const run = async () => {
    const client = renderClient;
    if (!client) return;
    try {
      await client.configure(currentPreviewConfig());
      previewPoster = true;
      if (generation !== previewGeneration || client !== renderClient) return;
      previewReady = true;
      previewFailed = false;
      const host = document.querySelector<HTMLDivElement>("#preview-host");
      host?.classList.remove("is-connecting", "is-fallback");
      host?.classList.add("is-ready");
      previewElement?.style.setProperty("visibility", "visible");
      const scrub = document.querySelector<HTMLInputElement>("[data-preview-scrub]");
      if (scrub) scrub.max = String(computeDuration(values, selected.duration));
      updateActionAvailability();
    } catch (error) {
      showPreviewFallback(error, generation);
    }
  };
  if (immediate) await run();
  else previewTimer = window.setTimeout(() => void run(), 90);
}

function readControl(control: ControlSpec, element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): PresetValue {
  if (control.type === "toggle") return (element as HTMLInputElement).checked;
  if (control.type === "number" || control.type === "range") return Number(element.value);
  if (control.id === "fontWeight") return Number(element.value);
  return element.value;
}

function bindDetail(): void {
  document.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => { view = "library"; render(); });
  bindFavorites();
  document.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach((button) => button.addEventListener("click", () => {
    const shared: PresetValues = {};
    const content = controlsFor(selected.controls).filter((control) => control.group === "content").map((control) => control.id);
    for (const key of [...content, "fontFamily", "fontData", "fontName", "textColor", "accentColor", "accentColor2", "sfxEnabled", "sfxVolume"]) {
      if (values[key] !== undefined) shared[key] = values[key]!;
    }
    openPreset(button.dataset.variant!, shared);
  }));
  document.querySelector<HTMLButtonElement>("[data-import-font]")?.addEventListener("click", () => document.querySelector<HTMLInputElement>("[data-font-file]")?.click());
  document.querySelector<HTMLInputElement>("[data-font-file]")?.addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const presetId = selected.id;
    const button = document.querySelector<HTMLButtonElement>("[data-import-font]");
    if (button) { button.disabled = true; button.textContent = "Importing…"; }
    try {
      const font = await importCustomFont(file);
      customFonts = [...customFonts.filter((item) => item.family !== font.family), font];
      if (selected.id === presetId && view === "detail") {
        values.fontFamily = font.family; values.fontData = font.data; values.fontName = font.name;
        openSections.add("type");
        render();
      }
      announce(`Imported ${font.name}.`, "success");
    } catch (error) { announce(error instanceof Error ? error.message : String(error), "error"); }
    finally { if (button) { button.disabled = false; button.textContent = "Import font…"; } }
  });
  document.querySelectorAll<HTMLInputElement>("[data-color-picker]").forEach((picker) => picker.addEventListener("input", () => {
    const input = document.querySelector<HTMLInputElement>(`[data-control="${picker.dataset.colorPicker}"]`);
    if (input) { input.value = picker.value; input.dispatchEvent(new Event("input", { bubbles: true })); }
  }));
  bindColorPickers();
  createPreview();
  document.querySelector<HTMLButtonElement>("[data-preview-retry]")?.addEventListener("click", createPreview);
  const specs = new Map(controlsFor(selected.controls).map((control) => [control.id, control]));
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-control]").forEach((element) => {
    const control = specs.get(element.dataset.control ?? "");
    const eventName = control && ["range", "color", "text", "textarea"].includes(control.type) ? "input" : "change";
    element.addEventListener(eventName, () => {
      if (!control) return;
      if (control.type === "color") {
        const valid = /^#[0-9a-f]{6}$/i.test(element.value);
        element.setAttribute("aria-invalid", String(!valid));
        if (!valid) return;
      }
      values[control.id] = readControl(control, element);
      if (control.id === "sfxEnabled") persisted = store.updatePreferences({ sfxEnabled: Boolean(values.sfxEnabled) });
      if (control.id === "sfxVolume") persisted = store.updatePreferences({ sfxVolume: Number(values.sfxVolume) });
      const output = document.querySelector<HTMLElement>(`[data-output="${control.id}"]`);
      if (output) output.textContent = `${element.value}${control.suffix ?? ""}`;
      if (control.type === "color") {
        const picker = element.parentElement?.querySelector<HTMLInputElement>("[data-color-picker]");
        if (picker) picker.value = element.value;
      }
      if (control.id === "fontFamily") {
        const font = customFonts.find((item) => item.family === element.value);
        if (font) { values.fontData = font.data; values.fontName = font.name; }
        else if (!element.value.startsWith("MotionPlugCustom-")) { delete values.fontData; delete values.fontName; }
      }
      void updatePreview();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-segment-control]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.segmentControl ?? "";
    values[id] = button.dataset.value ?? "";
    document.querySelectorAll<HTMLButtonElement>(`[data-segment-control="${id}"]`).forEach((peer) => {
      const active = peer === button;
      peer.classList.toggle("is-active", active);
      peer.setAttribute("aria-pressed", String(active));
    });
    void updatePreview();
  }));
  document.querySelectorAll<HTMLButtonElement>(".control-section__heading").forEach((button) => button.addEventListener("click", () => {
    const section = button.parentElement;
    const open = !section?.classList.contains("is-open");
    section?.classList.toggle("is-open", open);
    const group = section?.getAttribute("data-section");
    if (group) { if (open) openSections.add(group); else openSections.delete(group); }
    button.setAttribute("aria-expanded", String(open));
  }));
  document.querySelectorAll<HTMLSelectElement | HTMLInputElement>("[data-preference]").forEach((element) => element.addEventListener("change", () => {
    const key = element.dataset.preference as keyof PersistentState["preferences"];
    const raw: string | number = key.endsWith("Index") ? Math.max(0, Number(element.value) - 1) : element.value;
    persisted = store.updatePreferences({ [key]: raw });
    if (key.endsWith("Policy")) render();
  }));
  document.querySelector<HTMLButtonElement>("[data-preview-play]")?.addEventListener("click", () => { if (previewPlaying) { renderClient?.pause(); stopAudio(); } else void playPreview(false); });
  document.querySelector<HTMLButtonElement>("[data-preview-replay]")?.addEventListener("click", () => void playPreview(true));
  document.querySelector<HTMLInputElement>("[data-preview-scrub]")?.addEventListener("input", (event) => { stopAudio(); previewPoster = false; renderClient?.seek(Number((event.currentTarget as HTMLInputElement).value)); });
  document.querySelector<HTMLButtonElement>("[data-audition]")?.addEventListener("click", () => void playPreview(true, true));
  document.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => { values = valuesForPreset(selected.id); render(); announce("Preset reset to its original values."); });
  document.querySelector<HTMLButtonElement>("[data-save-variation]")?.addEventListener("click", () => { variationEditorOpen = true; render(); window.setTimeout(() => document.querySelector<HTMLInputElement>("#variation-name")?.select(), 0); });
  document.querySelector<HTMLButtonElement>("[data-cancel-variation]")?.addEventListener("click", () => { variationEditorOpen = false; render(); });
  document.querySelector<HTMLButtonElement>("[data-confirm-variation]")?.addEventListener("click", saveVariation);
  document.querySelector<HTMLInputElement>("#variation-name")?.addEventListener("keydown", (event) => { if (event.key === "Enter") saveVariation(); });
  document.querySelector<HTMLButtonElement>("[data-add]")?.addEventListener("click", () => void runWorkflow("add"));
  document.querySelector<HTMLButtonElement>("[data-update]")?.addEventListener("click", () => void runWorkflow("update"));
  document.querySelector<HTMLButtonElement>("[data-cancel-render]")?.addEventListener("click", () => renderClient?.cancel());
}

function saveVariation(): void {
  const input = document.querySelector<HTMLInputElement>("#variation-name");
  if (!input?.value.trim()) return input?.focus();
  const savedValues = { ...values };
  if (customFonts.some((font) => font.family === values.fontFamily)) delete savedValues.fontData;
  store.saveVariation(selected.id, input.value, savedValues);
  persisted = store.snapshot();
  variationEditorOpen = false;
  render();
  announce(`Saved “${input.value.trim()}”.`, "success");
}

async function playPreview(restart: boolean, audition = false): Promise<void> {
  if (!previewReady || busy) return;
  stopAudio();
  const generation = audioGeneration;
  const duration = computeDuration(values, selected.duration);
  const start = restart || previewPoster || previewTime >= duration - 0.01 ? 0 : previewTime;
  try {
    if (Boolean(values.sfxEnabled) || audition) {
    const wav = await createSoundtrack(selected, values, duration, Number(values.sfxVolume ?? persisted.preferences.sfxVolume));
    if (generation !== audioGeneration) return;
    const copy = new Uint8Array(wav.byteLength);
    copy.set(wav);
    activeAudioUrl = URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }));
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.addEventListener("ended", stopAudio, { once: true });
    activeAudio.currentTime = start;
    await activeAudio.play();
    }
    if (generation !== audioGeneration) return;
    previewPoster = false;
    renderClient?.seek(start);
    renderClient?.play();
  } catch (error) {
    stopAudio();
    announce(error instanceof Error ? error.message : "Could not play the matching sound.", "error");
  }
}

function stopAudio(): void {
  audioGeneration += 1;
  activeAudio?.pause();
  activeAudio = undefined;
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = undefined;
}

function updateProgress(progress: WorkflowProgress): void {
  const overlay = document.querySelector<HTMLDivElement>("#busy-overlay");
  const label = overlay?.querySelector<HTMLElement>("[data-progress-label]");
  const detail = overlay?.querySelector<HTMLElement>("[data-progress-detail]");
  const bar = overlay?.querySelector<HTMLProgressElement>("progress");
  overlay?.classList.remove("is-hidden");
  if (bar) bar.value = progress.ratio;
  if (label) label.textContent = progress.stage === "importing" ? "Adding to Premiere…" : `Rendering frame ${progress.frame} of ${progress.total}`;
  if (detail) detail.textContent = progress.stage === "importing" ? "Importing and creating one undoable timeline edit" : `${Math.round(progress.ratio * 100)}% · transparent PNG sequence`;
}

async function runWorkflow(mode: "add" | "update"): Promise<void> {
  if (busy) return;
  if (!hostAvailable) return announce("Open Motion Plug inside Premiere to add a graphic.", "neutral");
  if (!requireAccount()) return;
  if (!workflow || !previewReady) return announce("The animation renderer is not ready. Retry the live preview first.", "error");
  busy = true;
  stopAudio();
  updateActionAvailability();
  document.querySelector<HTMLDivElement>("#busy-overlay")?.classList.remove("is-hidden");
  document.querySelectorAll<HTMLButtonElement>("[data-add], [data-update]").forEach((button) => { button.disabled = true; });
  try {
    const result = mode === "add"
      ? await workflow.add({ presetId: selected.id, values, preferences: persisted.preferences, onProgress: updateProgress })
      : await workflow.update({ presetId: selected.id, values, preferences: persisted.preferences, onProgress: updateProgress });
    persisted = store.markRecent(selected.id);
    announce(mode === "add" ? `Added “${selected.name}” at the playhead.` : `Updated “${selected.name}” in place.`, "success", 7000);
    if (result.warnings.length) announce(result.warnings.join(" "), "neutral", 9000);
  } catch (error) {
    announce(error instanceof Error ? error.message : String(error), "error", 10_000);
  } finally {
    busy = false;
    const overlay = document.querySelector<HTMLDivElement>("#busy-overlay");
    overlay?.classList.add("is-hidden");
    // Export rendering temporarily configures the shared renderer for transparent
    // frame output. Restore the interactive poster/config before re-enabling the
    // timeline actions so the preview never appears blank after an Add/Update.
    if (renderClient) await updatePreview(true);
    updateActionAvailability();
  }
}

async function loadTimelineSelection(): Promise<void> {
  if (!hostAvailable) return announce("Open Motion Plug inside Premiere, then select a Motion Plug clip.", "neutral");
  try {
    const selectedGraphic = await getSelectedInstance();
    openPreset(selectedGraphic.instance.presetId, selectedGraphic.instance.values);
    announce("Loaded the selected Motion Plug graphic for editing.", "success");
  } catch (error) {
    announce(error instanceof Error ? error.message : String(error), "error");
  }
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    if (view !== "library") { view = "library"; render(); }
    document.querySelector<HTMLInputElement>("#preset-search")?.focus();
  }
  if (event.key === "Escape" && document.querySelector("#account-gate")) {
    event.preventDefault();
    closeSignInGate();
    return;
  }
  if (event.key === "Escape" && view === "detail" && !busy) { view = "library"; render(); }
});

window.addEventListener("unload", () => {
  renderClient?.destroy();
  stopAudio();
  window.removeEventListener("message", previewWindowListener);
  if (previewResizeListener) window.removeEventListener("resize", previewResizeListener);
});

try { hostAvailable = hostIsAvailable(); } catch { hostAvailable = false; }

const license = licenseApi();
if (license) {
  try { signedIn = license.init(); }
  catch { signedIn = false; }
  license.onChange(() => {
    signedIn = license.ok();
    refreshAccountUi();
    if (!signedIn) openSignInGate();
  });
}

render();

if (license) {
  if (signedIn) {
    // A refund revokes the license row on the website; this is where that
    // reaches the panel, as an explicit 403 that signs this machine out.
    license.revalidate((message) => announce(message, "error", 14_000));
  } else {
    openSignInGate();
  }
}

if (hostAvailable && window.MotionPlugUpdater) {
  window.MotionPlugUpdater.startAutoChecks((error, info) => acceptUpdateCheck(error, info, false));
}
void listCustomFonts().then((fonts) => {
  customFonts = fonts;
  if (view === "detail" && !busy) {
    const font = fonts.find((item) => item.family === values.fontFamily);
    if (font && !values.fontData) values.fontData = font.data;
    render();
  }
}).catch(() => undefined);
void refreshTimeline();
window.addEventListener("focus", () => void refreshTimeline());
window.setInterval(() => { if (view === "detail" && !document.hidden) void refreshTimeline(); }, 2000);
