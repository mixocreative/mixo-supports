# Support selection in Support Edit Mode — design

Date: 2026-10-21. Owner decisions from the 2026-10-21 session (015Ni9eJEgk682CcmgrgzSM4).

## Problem

Removing supports one click at a time is slow and error-prone:

- Right-click a support removes every contact within Erase radius (1.5 mm default, spacing 2 mm),
  so one click often removes 2–3 supports. Blender parity (`remove_manual_near`).
- A removal marker keeps hiding every contact within Erase radius of the removed spot on every
  compose, manual ones included: a support added next to a removed one silently disappears.

## Goal

Select first, act second. Selecting never changes the scene; Delete is a separate button.
Step 1 (this spec): select (click or brush), Delete, Clear. Step 2 (later spec): an Adjust panel
that overrides a few settings for the selection only.

## Rules (owner)

1. Plain-language UI for lay users. Words on buttons, no Blender-style mode icons.
2. Never require a key held while dragging. Shift/Ctrl+click, Delete key and Esc are optional
   shortcuts; every action also has a visible button.
3. No right-drag for anything.
4. Where a drag starts decides what it does: on the active object's model or supports with the
   brush on, it paints; on empty space, it rotates the camera as always.

## Edit Mode bar

```
[ Add supports | Select supports ]   (Select:) [ Click | Drag over ]  (Drag over:) [ Select | Unselect ]  Size ●── 2 mm
{n} selected  [ Delete ] [ Clear selection ]                                                          [ Done ]
```

- **Add supports**: click the model to add (today's default). Replaces today's Add/Remove toggle;
  the touch-only "tap removes" mode goes away (touch users select and press Delete).
- **Select supports → Click**: click a support to select it, click again to unselect. Clicking
  more supports adds them; no Shift needed. Shift/Ctrl+click behave the same.
- **Select supports → Drag over**: drag from the model sweeps a selection ring over supports. *Select* adds what the brush touches;
  *Unselect* removes it. The brush reaches only supports on the side facing the camera, never
  through a thin wall to the far side (PrusaSlicer's sphere brush painting hidden faces is a known
  complaint). Size slider 0.5–10 mm, step 0.5, default 2 mm (view state, not a
  support setting, so the add-on's Erase radius is untouched).
- **{n} selected / Delete / Clear selection** show only while something is selected and work in
  every tool. Delete is a `.danger` outline; Done is the mode's one primary (mixo-app-style).
- Right-click a support keeps today's behaviour (removes within Erase radius) in every tool.

## Feedback

- Selected supports: the whole body (tip, neck, pillar) solid red `#7f0019`. In the tips view only
  the tip, since only tips are drawn.
- Drag over on, pointer over the active object: a ring on the surface sized to the brush follows the
  pointer (red for Select, grey for Unselect), the supports inside it preview in see-through red,
  and the cursor shows a brush icon. Over empty space: normal cursor, no ring (a drag rotates).
- Click style: the support under the pointer previews see-through red.
- The Edit Mode badge names the tool: "Click supports to select" / "Drag over supports to select".
- The count updates live while painting.

## Deleting exactly

- Delete removes exactly the selected supports: manual ones from the manual list, automatic ones
  into a new per-object `deleted` list. One undo step per Delete. The selection empties; the tool
  stays as it was (cleaning is usually several areas in a row).
- A `deleted` entry hides the automatic contact with that ID. After a regeneration that moved the
  spots (ID gone), it hides the single nearest automatic contact within half the support spacing,
  so a deleted support stays deleted without taking neighbours. It never hides manual contacts.
- Today's radius `suppressed` markers stay as they are (right-click parity with the add-on).
- Clear manual edits also clears `deleted`.

## Selection lifetime

Selection is view state of the active object in Edit Mode (not in history). It empties on leaving
Edit Mode, on changing the active object and after Delete; IDs that no longer exist (undo,
regeneration) drop out. Esc clears the selection first, and leaves Edit Mode when nothing is
selected.

## Camera

No view cube (owner: lay users). A **Fit view** button joins **Tips only** and **Bottom view** at
the viewport's top right: it frames the selected objects from the current angle, for when the model
fills the screen and there is no empty space to drag.

## Naming (owner, 2026-10-21)

Selection never says "brush" or "paint": those words belong to the later **No-support zones**
mode (its own blue-framed mode for painting the surface, separate spec). Selection words:
Add supports / Select supports, Click / Drag over, Select / Unselect, Size
(zh-Hant 新增支撐 / 選取支撐, 點選 / 拖曳選取, 選取 / 取消選取, 範圍;
ja サポート追加 / サポート選択, クリック / なぞって選択, 選択 / 選択解除, 範囲).

## Out of scope

Adjust panel (step 2), box select, clipping slider, add-on changes.
