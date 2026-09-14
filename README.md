# Motion Plug

Motion Plug is an offline CEP extension for Adobe Premiere Pro. It lets editors browse, preview, customize, add, and later update original motion graphics, with an optional matching sound effect.

Version 0.3.0 uses the same proven extension structure as Caption Plug: a Chromium panel, a small CEP bridge, and an ExtendScript host adapter. The live preview and exported transparent frames share one TypeScript canvas renderer, so customization does not drift between the panel and the timeline.

The installed catalog contains 30 finished presets, two distinct variants in each of 15 motion families.

## Updated workflow

- Output always has a transparent background. The checkerboard is a preview aid and is never exported.
- Frame dimensions and frame rate come from the active Premiere sequence, including custom frame sizes. Changing sequences refreshes the preview automatically.
- Highlight text inline: `Make [these words] stand out`. Only bracketed occurrences receive the accent colour. Balanced brackets are hidden in the rendered graphic, and phrases and line breaks are supported.
- Click a colour swatch for the in-panel hue, saturation, and brightness picker. Drag the colour area or use its arrow keys; hex entry remains available.
- Under **Typography & color**, choose **Import font…** for an OTF or TTF file up to 10 MB. Fonts are stored locally; the selected font is embedded in timeline edit metadata. Saved variations reuse the local font library.
- Browse by category and animation family, use Favorites/Recent/Variations, and switch between related variants above the preview.
- Optional matched sound now uses eight edited recordings from the supplied sound folder. The old synthesizer has been removed. Preview playback and export use the same mix, with cues following word count, stagger, phrase holds, and animation events.

## Requirements

- Adobe Premiere Pro 2020 or newer
- macOS or Windows
- Node.js and FFmpeg for building or installing from this source tree
- Google Chrome/Chromium for regenerating preview videos and running browser checks

The extension itself runs offline. It has no account, sign-in screen, license gate, cloud renderer, subscription, or API key. Its only network feature is the public, checksum-verified release updater.

## Install a user release

First-time users should receive one native installer from `release/`:

- macOS: `MotionPlug-v0.3.0-mac-universal.pkg`
- Windows: `MotionPlug-Setup-0.3.0.exe`

Fully quit Premiere Pro, run the installer, reopen Premiere, and choose **Window → Extensions → Motion Plug**. Both installers are per-user and do not request administrator access. Unsigned public builds still show the normal Gatekeeper or SmartScreen warning; see [code signing](SIGNING.md) before broad distribution.

## Install from source on macOS

Fully quit Premiere, then run:

```sh
npm install
npm run install:cep
```

Reopen Premiere and choose **Window → Extensions → Motion Plug**.

If the previous UXP build is still installed, it may remain visible under **Window → UXP Plugins**. The 0.3.0 build documented here is the entry under **Window → Extensions**; the two installations do not share a runtime.

The development installer enables Adobe CEP PlayerDebugMode for the current user and copies the built extension to:

```text
~/Library/Application Support/Adobe/CEP/extensions/MotionPlug
```

## Install from source on Windows

Fully quit Premiere, then run `install\install-win.bat`. Reopen Premiere and choose **Window → Extensions → Motion Plug**.

The extension is copied to `%APPDATA%\Adobe\CEP\extensions\MotionPlug` and PlayerDebugMode is enabled for the current user.

## First test

1. Save a Premiere project and open a sequence.
2. Move the playhead to an empty time range.
3. Open a preset, customize it, and optionally enable SFX.
4. Keep track placement on **Next free track** for the first insertion.
5. Click **Add to timeline**.
6. Select the inserted video clip, return to Motion Plug, and choose **Edit timeline selection** or **Update selected**.

Generated PNG frames, WAV files, and edit metadata are stored in `Motion Plug Media/<project-name>/` beside the saved project. Unsaved projects use `Documents/Motion Plug Media` and show a warning.

## Build and verify

```sh
npm install
npm run typecheck
npm test
npm run build:assets
npm run validate
npm run test:browser
npm run package:cep
npm run release
```

- Loadable CEP extension: `dist/`
- Portable CEP archive: `build/Motion-Plug-CEP-0.3.0.zip`
- User updater archive: `release/MotionPlug-v0.3.0.zip`
- Native installer for the selected platform: `release/*.pkg` or `release/*.exe`
- Public update manifest and checksum: `release/latest.json` and `release/*.sha256`
- Visual review screenshots: `build/visual-review/` and `build/feature-review/`

The development ZIP is an unpacked extension archive, not a signed ZXP. Users should install the native PKG/EXE produced by `npm run release`. See [Releasing](RELEASING.md) for versioning, CI, updater publication, and verification.

## What is editable

Inserted graphics are transparent PNG sequences, not MOGRTs. Text, layout, color, timing, and SFX options remain editable through Motion Plug’s **Update selected** workflow. Optional sound is a separate WAV clip so it can be mixed or removed independently in Premiere.

Direct panel-to-timeline dragging is not simulated. Motion Plug uses an explicit Add action so it can validate the sequence, locked tracks, occupied ranges, and generated files before changing the edit.

## Documentation

- [Architecture and host integration](docs/ARCHITECTURE.md)
- [Adding presets](docs/ADDING_PRESETS.md)
- [Compatibility and acceptance report](docs/COMPATIBILITY_AND_TEST_REPORT.md)
- [Host limitations](docs/HOST_LIMITATIONS.md)
- [Progress checklist](PROGRESS.md)
