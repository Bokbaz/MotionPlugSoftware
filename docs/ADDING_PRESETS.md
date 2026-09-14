# Adding a preset

Motion Plug presets are code-authored so preview and export cannot drift apart.

1. Add or reuse control definitions in `src/catalog/controls.ts`.
2. Add a `PresetDefinition` in `src/catalog/presets.ts`. Keep the ID namespaced and versioned, for example `motionplug.family.variant.v1`. Include useful defaults, tags, and duration. Put square brackets around highlighted words in defaults.
3. Add the corresponding render branch in `src/renderer/core.ts`. Rendering must be deterministic from `RenderConfig`; do not read panel state directly.
4. Handle the actual sequence dimensions, including portrait, square, and custom ratios. Preserve explicit line breaks, fit long text safely, and return a visible overflow/font warning when the requested layout cannot fit cleanly.
5. Assign a suitable recorded sample in `src/audio/sample-catalog.ts` and implement event timing in `planSoundCues` in `src/audio/matched-sfx.ts`. Times are seconds, not percentages of the full clip.
6. Add catalog, timing, renderer, and audio assertions under `tests/`.
7. Run the complete generation and validation path:

```sh
npm run typecheck
npm test
npm run build:assets
npm run validate
node scripts/visual-smoke.mjs
```

## Motion quality bar

- Start with a finished still frame and one dominant visual idea.
- Use the shared quartic and quintic easing helpers for decisive departures and long, controlled arrivals. Linear travel is not acceptable.
- Reserve `settledScale` for the principal object. Keep its single overshoot near 0.6% to 1.2%, then return exactly to rest.
- Stagger supporting text, rules, indicators, and metadata. Let the next action begin before the previous one has fully settled.
- Give exits a direction or scale continuation instead of relying on opacity alone.
- When a rounded object changes form, interpolate its dimensions and radius. Use transform scale only when the finished object moves as one unit.
- Keep blur, shadow, glow, and light sweeps subordinate to the motion. They should be most visible during peak velocity and disappear at rest.
- Match sound cues to perceived mass. Small interface motion gets a small sound.

`build:assets` renders the default MP4 and JPG from the same renderer used for insertion, mixes the default WAV from the recorded samples, and rebuilds `dist/catalog.json`. Do not manually replace a preview with a look-alike animation.

Before release, visually review the default and customized preset at narrow and wide panel sizes, all three aspect ratios, representative sequence rates, long/accented text, transparency, SFX on/off, insertion, update, undo, reopen, and export inside Premiere.

To rebuild the curated sample bank from the original supplied folder:

```sh
node scripts/import-sfx.mjs /path/to/source-folder
```

The import script trims individual events from multi-variation recordings, applies short boundary fades, normalizes each sample to a 0.8 peak, and records provenance. Standard builds use the committed prepared WAV samples and do not need the original Downloads folder.
