# No-support zones — design

Date: 2026-10-21. Owner-approved flow (session 015Ni9eJEgk682CcmgrgzSM4).

## Goal

Per object, paint areas of the model surface where automatic supports must not grow. Painting
works before or after Generate; auto supports inside a zone disappear; manual supports always stay.

## Kept apart from selection (owner)

| | No-support zones | Select supports |
|---|---|---|
| Acts on | the object's surface | the supports |
| Kept | saved with the object, through regeneration | temporary |
| Words | Paint, Erase, Brush size, zones | Select, Drag over, Size |
| Look | blue frame and badge, blue layer on the surface | red frame, red supports |
| Place | its own mode | Support Edit Mode |

## Flow and UI

- Left panel, a section **No-support zones** between "Edit supports" and "Supports for …":
  "Painted" or "None" (muted, never a count: one stroke is many stamps) · **Paint zones** · **Clear** (`.danger` outline, disabled when none).
  Help line: "Paint where supports must not grow. Manual supports stay."
- **Paint zones** enters zones mode for the active object (needs an active object, like Edit Mode).
  Viewport: blue hairline frame, blue badge "Painting no-support zones · {object}", bar top right:
  `[ Paint | Erase ]  Brush size ●── 2 mm  [ Clear all zones ]  [ Done ]`.
  Brush size 0.5–10 mm, step 0.5, default 2 (view state). Clear all zones = `.danger` outline;
  Done = the mode's one primary. Esc / Enter (not on a button) leave the mode, as Edit Mode does.
- Support Edit Mode bar gets a plain link-style button **Edit no-support zones →** that switches
  straight to zones mode (and zones mode's Done returns to where the user came from: Edit Mode if
  entered from there, else off).
- Painting: a drag that starts on the active object's model paints (or erases); a drag on empty
  space rotates. A blue ring lies on the surface under the pointer (grey for Erase) with the brush
  cursor. Supports are drawn but take no pointer events in zones mode.
- The blue layer (`--blue` `#1d3461`, see-through) shows on the model in zones mode and, fainter, in
  Support Edit Mode. Hidden otherwise; the panel count says zones exist.
- One stroke = one undo step. Auto supports inside the new zone disappear when the stroke ends
  (the support mesh rebuilds as for any edit). Erase brings them back.

## Data

- `PrintUnit.zones: ZoneStamp[]`, ordered. `ZoneStamp = { center: Vector; radius: number;
  normal: Vector; kind: 'paint' | 'erase' }`, all in object-local space (moves/rotates with the
  object). Old saves load with `zones: []`.
- A point with surface normal `n` is **zoned** when the last stamp covering it is a paint stamp.
  A stamp covers the point when `distance(point, center) <= radius` and `dot(n, stamp.normal) > 0`
  (same side of the surface: a stroke on one face of a thin wall never zones the far face).
- `unitContacts` drops automatic contacts whose position+normal is zoned. Manual contacts are never
  dropped. Placement itself is unchanged (zones only hide), so changing zones never re-runs
  placement.
- Stamps along a stroke: a new stamp when the pointer has moved at least half the brush radius
  from the last stamp of the stroke (first press always stamps).
- **Clear** / **Clear all zones** remove every stamp of that object (one undo step). "Clear manual
  edits" does not touch zones.

## Check supports

Islands and overhangs whose position is zoned are still listed, labelled
"in a no-support zone" so the user knows why they lack supports.

## Out of scope

"Must support here" painting, smart fill, clipping plane, add-on support for zones.
