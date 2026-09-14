# Compatibility and test report

## Build environment

- macOS 26.6.2 on Apple Silicon
- Node.js 22.22.2 and npm 10.9.7
- Adobe Premiere Pro 2026, version 26.0.2, installed locally
- After Effects not present in the workspace workflow

The CEP manifest declares Premiere Pro 2020 (14.0) or newer, matching the proven Caption Plug extension shell. This is a declared compatibility range, not a claim that every release and operating system has been exercised.

## Completed verification

- TypeScript type-check: passed
- Automated tests: 9 files, 41 tests passed
- CEP adapter tests: sequence parsing, serialized placement data, changed-sequence errors, occupied fixed-track refusal, automatic free-track selection, update overlap protection, and integer-frame tick placement passed
- Host script syntax: passed a JavaScript parser check while remaining ES3-style ExtendScript
- Catalog: 30 presets, exactly 2 variants in each of 15 families
- Build validator: CEP manifest, bridge load order, Premiere host entrypoints, 30 MP4 previews, 30 JPG posters, 30 WAV assets, font/license files, and both runtime bundles passed
- Browser layout/renderer smoke test: passed at 390×720 and 760×820
- Simulated CEP shell: bridge detected, live renderer connected through an `IFRAME`, no UXP `WEBVIEW` created, and Add/Update actions enabled after both the renderer handshake and valid sequence detection
- Portable CEP ZIP integrity: passed for 0.3.0, 6.7 MB
- Local 0.3.0 installation: 123 files verified byte-for-byte against `dist/`; previous installation archived in `build/backups/MotionPlug-installed-before-0.3.0.zip`
- macOS development installation: copied successfully to `~/Library/Application Support/Adobe/CEP/extensions/MotionPlug`
- CEP PlayerDebugMode: enabled for CSXS generations 9 through 15
- Full dependency audit: 0 vulnerabilities

Browser and VM checks validate panel behavior, renderer communication, request construction, and deterministic host-side safety helpers. They do not substitute for Premiere timeline acceptance.

## Premiere acceptance checklist

The extension is installed and ready for a host pass. Complete these checks in Premiere Pro 26.0.2 before distribution:

- [ ] Fully restart Premiere and open Motion Plug from **Window → Extensions → Motion Plug**.
- [ ] Browse categories/families, search, favorite, preview, scrub, use the color picker, and audition matched SFX.
- [ ] Customize Hero Headline and insert at the playhead with SFX off and on.
- [ ] Confirm alpha, typography, timing, and audio in an exported video.
- [ ] Select the graphic, load its settings, change text/timing, and use **Update selected**.
- [ ] Verify actual Premiere Undo/Redo behavior for Add and Update.
- [ ] Verify no-sequence messaging and occupied/specific/locked-track refusal.
- [ ] Test 23.976, 24, 25, 29.97, and 30 fps sequences where available.
- [ ] Test 1920×1080, 3840×2160, 1080×1920, and square sequences.
- [ ] Test long text, manual line breaks, punctuation, accented characters, and short/long timings.
- [ ] Save, close, reopen, relink if prompted, and update an existing Motion Plug clip.
- [ ] Confirm direct Premiere trimming does not falsely resynchronize separate SFX.
- [ ] Repeat representative checks for Word-by-Word Build and Bento Feature Summary, then spot-check the remaining families.

## Not yet claimed

The prior UXP screenshot demonstrated the renderer handshake and native-control layout failure that prompted this CEP rebuild. Those UXP paths are no longer part of the shipping extension.

The current session did not have the required computer-control runtime for operating Premiere’s UI, so panel discovery, live insertion, replacement rollback, Undo/Redo, project reopen, export, and Windows behavior remain explicitly unverified in the actual Adobe host.

## 0.3.0 update, September 13, 2026

- 41 tests cover the recorded sample bank, WAV encoding, clipping/fades/mute, word and replacement cue scheduling, bracket parsing/migration, color conversion, font signatures, and exact sequence sizing for Add/Update, alongside the existing host safety tests.
- Browser feature checks exercise category filtering, mouse/keyboard colour picking, TTF and OTF loading in the actual canvas renderer, font/variation persistence across reload, audio playback, and pixel-level transparent export with visible highlighted text.
- A simulated CEP sequence switches from 2048×858 to 1080×1920; the preview follows it, and clearing the active sequence disables insertion.
- Installed Adobe timeline insertion, playback, Undo/Redo, and final export still need a live Premiere acceptance pass. No live Premiere success is claimed by the automated browser/VM checks.
