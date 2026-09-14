# Motion Plug design system

register: product

Motion Plug lives beside Premiere’s timeline in a dim editing workspace. The interface stays low-contrast and compact so the animated work remains the loudest surface.

## Color

Strategy: restrained cool graphite with one periwinkle action color.

| Token | Value | Purpose |
| --- | --- | --- |
| `--bg` | `#18191d` | Panel background |
| `--surface` | `#202126` | Inputs and quiet controls |
| `--surface-2` | `#28292f` | Hover and secondary action |
| `--surface-3` | `#32333a` | Selected neutral state |
| `--line` | `rgba(255,255,255,.09)` | Dividers and field borders |
| `--text` | `#f3f3ef` | Primary text |
| `--muted` | `#a2a4ab` | Labels and descriptions |
| `--subtle` | `#73757d` | Metadata |
| `--accent` | `#91a9ff` | Primary actions, focus, selection |
| `--success` | `#7cdeb0` | Connected/complete status |
| `--danger` | `#ff938f` | Blocking errors |

Accent appears on actions and state only. The panel does not use gradients, glass effects, or decorative color.

## Typography

- Family: bundled Inter Variable, then Inter and the system UI stack.
- Root size: 13px.
- Product labels use the same family as content. Hierarchy comes from weight and a compact 9px to 18px scale.
- Metadata is short and muted. Prose stays below 70 characters per line where practical.

## Shape and spacing

- Radii: 4px fields, 6px compact groups, 8px preview surfaces, 10px overlays.
- Borders: 1px. Shadows are reserved for overlays and the fixed action dock.
- Core spacing rhythm: 4, 7, 10, 12, 16, 20px.
- The 390px docked layout is the primary shape. At 620px, preview and inspector become two columns.

## Components

- The live preview leads the detail view and uses the exact export renderer.
- Presets use two-column family groups at docked width. Scope tabs and a category selector stay above the library; related variants have a switcher above their preview.
- Inspector groups are border-separated accordions, not nested cards. Open sections remain open across font import and variation saving.
- Colour swatches open an inline hue and saturation/brightness picker. OTF/TTF imports sit directly below the font menu.
- A fixed checkerboard communicates transparency; a read-only timeline size replaces frame and background choices.
- Add and Update stay in a fixed bottom dock. Only Add uses the accent fill.
- Every interactive element has hover, focus, active, disabled, and error treatment.
- Errors describe what remains unchanged and what the editor can do next.

## Motion

- UI transitions remain below 200ms and communicate state only.
- No layout-property animation, bounce, or page-load choreography.
- `prefers-reduced-motion` disables nonessential panel animation.

## CEP constraints

- CSS must work in legacy CEP Chromium: no `oklch()`, `accent-color`, `aspect-ratio`, or flex `gap`.
- Focus uses broadly supported `:focus` rules.
- Range and progress controls use WebKit pseudo-elements instead of host defaults.
- Panel code is bundled for Chrome 61. ExtendScript in `jsx/host.jsx` stays ES3-style.
