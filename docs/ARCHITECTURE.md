# Architecture and Adobe host decision

## Why Motion Plug now ships as CEP

The original UXP build depended on a nested native WebView for customized canvas rendering. In Premiere, that surface failed its configuration handshake and did not consistently honor the panel’s HTML/CSS sizing, which blocked both preview and timeline actions.

Motion Plug 0.3.0 uses the architecture proven by the local Caption Plug reference:

- `CSXS/manifest.xml` registers a Premiere CEP panel and enables its embedded Node.js runtime.
- `plugin/cs-bridge.js` provides the small `evalScript` and Node module bridge the panel needs.
- `jsx/host.jsx` performs active-sequence inspection, safe track selection, numbered-still import, SFX placement, selection lookup, and replacement inside Premiere.
- The preview renderer runs in a normal same-origin iframe. It no longer depends on Premiere’s UXP WebView implementation.

CEP also keeps the panel usable on Premiere releases before the current UXP surface. The manifest declares Premiere Pro 2020 and newer; distribution claims still depend on completing the host checklist on each supported platform/version.

## Runtime flow

1. `src/panel/main.ts` presents the catalog, persistent user state, relevant controls, preview transport, and Add/Update actions.
2. `src/catalog/` owns stable preset IDs, schemas, defaults, metadata, and sound sample assignments.
3. `src/renderer/core.ts` is the single animation source for the live customized preview and final frame export.
4. `src/render/render-client.ts` communicates with the same-origin renderer iframe and writes each acknowledged PNG through CEP’s embedded Node runtime.
5. `src/audio/matched-sfx.ts` mixes edited recordings into a peak-safe 48 kHz stereo WAV. Cue times use the same seconds, stagger, word counts, and transition phases as the renderer. `src/audio/sample-catalog.ts` assigns a suitable sound to each preset.
6. `src/premiere/workflow.ts` creates immutable versioned media and delegates the host edit to `src/premiere/host.ts`.
7. `src/premiere/host.ts` serializes requests to `jsx/host.jsx`. The host script validates the active sequence, duration, files, lock state, and occupied range before importing or overwriting anything.
8. `plugin/license.js` signs the machine in to the customer's captionplug.com account, which holds both the Caption Plug and Motion Plug entitlements. It posts to `/api/plugin/signin` with `product: "motion_plug"`, caches the returned license key, machine hash, and server-minted activation signature in `~/.motionplug`, and revalidates in the background at most once a day. Only an explicit 403 — a refund-revoked license, or a slot freed from the account page — signs a machine out; every other failure leaves a paying user working. The password is never stored.
9. `plugin/updater.js` checks Motion Plug's public release manifest without credentials. It verifies the updater ZIP's SHA-256 digest before extraction. `plugin/update-transaction.js` validates a complete sibling tree and atomically swaps it into place with rollback.

The sequence ID and playhead frame are captured before rendering. A changed sequence aborts the host edit. Frame positions cross the CEP boundary as integers and are converted to Premiere ticks with the active sequence timebase.

## Account gate

Browsing, previewing, and auditioning presets never require an account. Only
`runWorkflow` — Add to timeline and Update selected — calls `requireAccount()`,
so a signed-out panel stays fully explorable and the sign-in overlay appears at
the moment output is actually requested. The overlay is dismissable for the same
reason.

The account layer is skipped entirely where it cannot work: outside Premiere,
and in a CEP panel whose Node runtime is unavailable. That keeps a
misconfigured host from showing a sign-in wall nobody can pass.

## Add and update safety

For **Add**, the host chooses an unlocked range with no overlapping clips. Auto mode prefers a free video track above media at that time and creates a new track through Premiere’s QE DOM only when required. A fixed track fails clearly if it is locked or occupied. Audio is evaluated separately and never overwrites an existing audio clip.

For **Update**, the selected original is found again by stable track-item identity, media path, track, and start frame after the new render finishes. The host preflights the replacement duration and imports the new media before removing the original. If an insertion step fails, it removes partial new clips and attempts to restore the previous video and SFX.

Imported recovery media can remain in the Motion Plug project bin after a host refusal. Generated files are removed only when rendering itself fails before import.

## Why this is not a MOGRT collection

Premiere scripting does not author genuine After Effects Motion Graphics Templates, and After Effects source compositions are not present in this workspace. Motion Plug therefore does not ship renamed, empty, or simulated `.mogrt` files.

The supported alternative is a shared canvas renderer whose output is imported as an alpha PNG sequence. Optional SFX is a separate WAV. Controls are edited through Motion Plug rather than Premiere’s Properties panel.

## Data and round-trip editing

Every insertion receives a unique instance ID and render version. Normalized settings are stored in `motion-plug.json` beside the rendered version. The selected timeline clip resolves back to that metadata through its numbered-still media path.

Updating creates a new immutable version folder, preserves the instance ID and creation time, replaces only the selected timeline clip, and rewrites the new version’s metadata with the final track placement. Older files remain available to existing project references and manual recovery.

## Source and generated assets

- Authored source: `src/catalog/`, `src/renderer/`, `src/audio/`, `src/premiere/`
- CEP host source: `CSXS/`, `plugin/cs-bridge.js`, `jsx/host.jsx`
- Generated browsing previews: `assets/previews/`
- Generated audition SFX: `assets/sfx/`
- Final project media: `Motion Plug Media/` beside the Premiere project
- Compiled loadable extension: `dist/`
- Portable archive: `build/Motion-Plug-CEP-<version>.zip`
- User release artifacts: `release/MotionPlug-v<version>.zip`, `.pkg`, and `.exe`

User preferences, imported fonts, and saved variations live in CEP browser storage outside the extension directory, so native reinstalls and in-panel directory swaps preserve them. The Windows updater also carries the installed uninstaller into the replacement tree.

The logo and recorded SFX were supplied by the user. Sound provenance is recorded in `assets/sfx/sources.json`. Inter is bundled under the SIL Open Font License.

## Transparent output, sizing, and fonts

The workflow reads exact width/height and FPS from the active sequence on every Add/Update. Legacy aspect and opaque-background values are discarded, and the export renderer clears to alpha even when old metadata requests a solid fill. The panel refreshes sequence dimensions on focus and every two seconds while editing.

`src/renderer/highlights.ts` parses bracketed spans before text measurement and carries them through per-word and per-line animations. Old keyword metadata is converted to brackets when reopened.

`src/fonts/custom-fonts.ts` validates OTF/TTF headers, verifies each file with FontFace, and persists the file in IndexedDB under a content-derived family name. The renderer awaits custom font loading before preview or export. Timeline metadata embeds the selected font data; local variations reference the stored family to avoid duplicating large files in localStorage. A missing or corrupt custom font blocks rendering with an actionable message.
