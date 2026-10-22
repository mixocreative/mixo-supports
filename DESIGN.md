# Design System: Mixo Supports

Stitch design system for mixosupports (resin 3D-print support editor). Tokens only. Screen
structure, modes, the command registry and per-screen Stitch prompts are in
`docs/design/ui-structure.md`; token source of truth is the `mixo-app-style` skill
(`tokens.css`, `base.css`). Upload with `stitch upload design DESIGN.md` only after the owner
approves the Stitch project; never upload models or project data.

## 1. Visual Theme & Atmosphere

Quiet, flat, paper-like desktop tool for lay resin printers. Unbleached paper surfaces, warm grey
ink, 1 px hairlines, no shadows, one dark-red accent. Dense rows; the 3D viewport is the room, the
panels are the bench. Light theme only.

## 2. Color Palette & Roles

### Primary Foundation
- **Paper (`#f4f2ed`)**: app and panel background.
- **Surface (`#fbfaf7`)**: raised controls, tool bars, toasts.
- **Sunken (`#ebe8e1`)**: hover, selected rows, group heading bands.
- **Viewport (`#e9e6df`)**: 3D background.

### Accent & Interactive
- **Mixo Red (`#7f0019`, hover `#96102b`)**: the one primary button per view (Generate, Done), Support Edit Mode frame and badge, active-object letter badge, progress fill.
- **Zone Navy (`#1d3461`, hover `#284579`)**: No-support zones frame and badge, Regenerate button, the zone layer on the model.
- **Ink fill (`#3b3631`)**: pressed toggles, chosen segments and tool buttons (paper text).

### Typography & Text Hierarchy
- **Ink (`#3b3631`)**: body text and headings.
- **Muted (`#8a847a`)**: captions, counts, units, help lines.
- **Lines (`#dcd7cd`, strong `#c4bdb0`)**: 1 px borders and dividers.

### Functional States
- **Danger (`#b3261e`)**: destructive actions as outline + text, never filled; island markers.
- **Warning (`#b07a12`)**, **Success (`#4a6b3a`)**, **Info (`#3b4a5c`)**: muted text/icon colours; banners use a ~10 % tint.
- Locked panels in a focus mode: content at 45 % opacity, not interactive.

## 3. Typography Rules

- **Zen Kaku Gothic New** (bundled, 400 / 500 / 700); Traditional Chinese uses PingFang TC / Noto Sans TC / Microsoft JhengHei first.
- Body and controls 11.5–13 px, weight 400; buttons 13 px; primary 500.
- Group headings 12 px, weight 700, tracked .06em, ink on a sunken band.
- Panel title 14 px / 500; captions and status bar 11–11.5 px; numbers tabular.

## 4. Component Stylings

- **Buttons**: 2 px radius, 1 px `#dcd7cd` border on surface; hover strong line + white. Primary: red fill, white text. Destructive: danger outline. Pressed: ink fill, paper text. Disabled: muted, 55 % opacity.
- **Segmented controls**: joined segments in a surface trough; chosen = ink fill.
- **Tool choice**: 40 px tall buttons with a 19 px line icon left of the label (Click: arrow, Drag over: brush).
- **Number fields**: right-aligned value with a unit, underline turns red on focus.
- **Collapsible groups**: sunken heading band with a left chevron.
- **Mode chrome**: 1 px frame round the viewport in the mode colour; badge top-left in the mode colour naming mode, object and what a click does; tool bar top-right on surface with a hairline: tool → options → actions → Done.
- **Toast**: surface, hairline, 2 px radius, "… · Undo", bottom centre of the viewport.

## 5. Layout Principles

- Desktop 1366 × 768 reference: header 56 px, left panel 268 px, viewport fluid, right panel 300 px, footer 32 px.
- 4 px base gap, 8 px panel padding unit, 22–26 px rows; panels scroll, the viewport never grows the page.
- Below 1100 px: viewport on top, panels below; tool bar docks at the viewport bottom.
- Hit areas ≥ 24 px; 40 px on touch.

## 6. Design System Notes for Stitch Generation

- **Atmosphere keywords**: flat paper editor, warm grey ink, hairline borders, no shadows, dense desktop tool, one dark-red primary.
- **Canonical colours**: Paper `#f4f2ed`, Surface `#fbfaf7`, Sunken `#ebe8e1`, Ink `#3b3631`, Muted `#8a847a`, Mixo Red `#7f0019`, Zone Navy `#1d3461`, Danger `#b3261e`.
- **Component prompts**: a three-column editor (setup panel, 3D viewport, settings panel) with a status footer; a viewport in a tool mode with a 1 px coloured frame, a filled badge top-left and a light tool bar top-right ending in a dark-red "Done  Esc"; a settings panel of collapsible groups with left chevrons and dense number rows.
