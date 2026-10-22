# mixosupports UI structure

Date: 2026-10-22. Status: implemented at `05d42c4` (see the status section below). Written as a design,
with the owner decisions of 2026-10-22 encoded; revised after a four-model
review and a behaviour audit (sections 12 and 13). Code baseline for every
"today" statement in sections 2 to 11: commit `acd3f98` (branch `refactor/app-shell`, which contains
`refactor/selection-pipeline`); file:line references are in the appendix, refreshed for `05d42c4`. Behaviour details that
this document does not change (key table, pick table, strokes, colours of 3D marks, camera numbers)
stay in `docs/superpowers/specs/2026-10-21-support-editing-ui-spec.md` (the behaviour spec).
Terms: `docs/migration/glossary.md`. House style: skill `mixo-app-style` (`tokens.css`, `base.css`).

Contents

1. Purpose, audience, principles
2. Screen anatomy and wireframes (1366 × 768)
3. Left panel brush-up
4. Mode state machine
5. Command registry
6. Copy (en / zh-Hant / ja) and naming rules
7. Visual rules
8. Accessibility and keyboard
9. What changes vs today, and the Babylon port
10. Stitch
11. Prerequisite bugs, then the feature: context-sensitive right panel and per-support settings
12. Owner-confirmable rules and open questions
13. UI behaviour audit
14. Project files (Save and Open)
- Appendix A: verified against the code (file:line)

Markers used below: **[today]** = shipped at `acd3f98`; **[change]** = this document changes it;
**[new]** = new control or string; **[feature]** = section 11, built after the layout work;
**[confirm]** = rule the owner should confirm (listed again in section 12).

---

## Status at 05d42c4: implemented

Everything in sections 1 to 11 is built, with the deviations listed after the table. Sections 2 to 11
keep their design wording, and their "today" statements describe `acd3f98`. Sections 12 and 13 and
Appendix A carry the shipped state. Commit detail is in `git log --oneline 57f5eb0..HEAD`.

| Section | Shipped in |
|---|---|
| 11.0 a and b: exact right-click removal, unit-local ids, old removals kept through migration | `23627b4`, `002fc0d`, `069b320`, `ab99ed5` |
| Step 1 (2.x, 4, 5, 8): command registry (`src/editing/commands.ts`), Tab freed, Esc rules, one `mode.exit`, header Generate removed, file drop refused in modes, Modes group | `e01941f`, `a55d4ec`, `83b85e4`, `83ccbe1`, `434b239` |
| Step 1 (4.5, 7.2): per-section inert locks that fold to headings, lock-note click catcher | `83ccbe1`, `f3ebfe9`, `54be8c9` |
| Step 1 (2.6, 5.7): zones focus mode (red frame, "n supports hidden by zones"), Clear all zones with an Undo toast | `f7dc6d1`, `2b494b7`, `1ddc5de` |
| Step 1 (Q2): Check live in Edit, Fix in place, re-check wording, stale Check label, Generate in the edit bar | `e51fc50`, `258520b`, `d4549f7`, `dae2674`, `fb6bf27` |
| Step 1 (Q4): right panel split into Object and Support shape, placement waits for Generate in Edit, regeneration report | `fae0a4b`, `33dbd0a`, `ea0e4f9`, `fea3145`, `dae2674` |
| Step 1 (Q6): Add / Remove switch, Click reach, Drag over starts on a model or support and orbits elsewhere | `b8c8f34`, `807c7f7`, `02e6aa8` |
| Step 2: Select / Unselect switch, Shift read from the pointer event and latched at stroke start | `785c5a8`, `ae4570d`, `6ebcad7`, `d3cbc72`, `4c82c6f` |
| Step 3 (section 11): per-support settings (`contactSettings`, `SHAPE_KEYS`), count band, Select them, Reset, ring mark, coalesced undo, regeneration keeps or resets | `8fc7742`, `7ca03e1`, `2305c39`, `ff3b726`, `66c74a4`, `7dbaaf1`, `2e0cbe5`, `f1de455`, `7d2b612`, `4297fc7`, `49114f9`, `8cb45b4`, `cb48f21`, `7f4fe9b`, `808c6a2`, `1b1b46e` |
| Audit polish (section 13): toasts, export and cancel text, add flash, step-naming Undo and Redo hints, `disabledReason` on every disabled command, Delete always shown | `fd7e66c`, `1748ef5`, `e9ccce2`, `b44da0d`, `54be8c9`, `44315ae`, `f8d25fd`, `02630b7` |
| CIA-06 "Supports are still building", CIA-07 idle zone overlay, Hide / Show models with Drag over, zh-Hant wording lint | `9b60d3e`, `6f7b554`, `9c4a670`, `a1e0f53`, `3cde47b` |
| Project files: Save project and Open project (section 14) | `05d42c4` |
| `npm run walk`: an AI-free browser walk, 24 checks with fixed baselines | `3c04a2a`, `4fd7537` |

### Deviations from the spec

Each item was checked against the code at `05d42c4`.

- **Object region.** It is live while supports are selected (Q4, C9), as specified. The order changed.
  With supports selected, Support shape comes before Object so it is on screen (`cb48f21`,
  `SettingsPanel.tsx:219`). With none selected, Object comes first.
- **Select them.** It selects the supports of the active object only, because the mode edits one
  object. When other selected objects also have customised supports, the hint gives their count and
  says to edit them one at a time (`commands.ts:261-275`). C10 had no such limit.
- **Shift hint.** While Shift is held the hint reads "Release Shift to select" or "Release Shift to
  unselect". At rest it reads "Hold Shift to unselect" or "Hold Shift to select" (`EditBar.tsx:66`).
  The copy table in 6.2 lists only the resting wording.
- **Fix.** It frames the spot and says "Click the framed spot to add a support." It draws no ghost
  marker. After the add, the re-check says "Spot covered." or "Still unsupported here."
  (`useFixSpot.ts:54,67,79`; `check.ts:89`).
- **Placement in Edit.** A placement change made in Support Edit Mode is deferred, not regenerated.
  The right panel says "Placement changed. Regenerate to apply." until Generate runs
  (`SettingsPanel.tsx:264`). Outside a mode the change still schedules a regeneration, announced as
  "Placement changed: regenerating {name}." (`regenerate.ts:46`).
- **Undo floor hint.** At the mode floor the Undo reason reads "Nothing to undo here: leave the mode
  to undo earlier steps." (`commands.ts:127`), not the audit's wording.
- **Tips only and Drag over.** Q7 assumed no interaction. Tips only does change what Drag over can
  pick (12.2, Q7).
- **Open audit rows.** The Click reach ring and Add with models hidden are not done (section 13).
- **Not in the design.** Save project and Open project were added after the document was written
  (section 14).

---

## 1. Purpose, audience, principles

**Purpose.** One reference for what is on screen, where, when, and why, for three readers: the
React implementer of the layout brush-up, the Babylon.js porter (mixomesh), and Stitch (UI mockups,
section 10). It defines the structure; the behaviour spec defines the gestures.

**Audience of the app.** Lay resin printers: they know "supports", "raft", "overhang" from their
resin slicer, not 3D-editor jargon. They print one or a few models, want automatic
supports, then fix a few spots by hand. They must never be unsure which mode they are in or how to
get out.

**Principles.**

| # | Principle | What it means here |
|---|---|---|
| P1 | One primary per view | Exactly one red-filled button visible at a time: the left-panel Generate outside a mode, the viewport Done inside a mode. Check findings' Fix stops being red **[change]**. |
| P2 | Progressive disclosure | Mode → Tool → Tool options → Actions. Each level is shown only while its parent is active (Click reach only under Add; Click / Drag over only under Select; Select / Unselect switch and Circle size only under Drag over; selection actions only with a selection). |
| P3 | No repeated controls | Every control exists once in the registry and is rendered in one place. Removed duplicates: header Generate **[change, confirm]**, viewport "Edit supports" button **[change]**, left-panel "Clear" zones button **[change]**, "Edit no-support zones →" **[change]**. One accepted exception: Click reach (section 3.3). |
| P4 | Layperson words | Printing words, one term per concept (glossary), the badge says in words what a click does. Paint / Erase / Brush only for zones; Select / Drag over / Circle size only for picking supports. |
| P5 | Modes are siblings and isolated | Support Edit Mode and No-support zones never nest: exit one before entering the other. A mode belongs to the active object. |
| P6 | Always a visible way out | Each mode has two visible exits (left-panel Exit button, viewport Done) plus Esc. Both buttons run the one command `mode.exit`, so they never disagree (4.4). No exit needs a key. |
| P7 | No required key + drag | Every drag works without a key held. Keys (Shift, Ctrl, Delete, Esc, G, R) are optional accelerators with a visible equivalent. |
| P8 | mixo-app-style tokens | Paper / surface / sunken, hairlines, 2 px radius, no shadows, ink fill for pressed, red for the one primary, `.danger` outline for destructive. Values are copied from `tokens.css`, never re-derived. |

---

## 2. Screen anatomy and wireframes

### 2.1 Regions (desktop, 1366 × 768)

| Region | Size today | Content | Live in |
|---|---|---|---|
| Header | 56 px tall (`styles.css` header) | Wordmark + "Resin Support Studio"; language EN / 中文 / 日本語; Undo, Redo; Hide models / Show models, Wireframe / Solid. Header Generate removed **[change, confirm]**. | all states |
| Left panel | 268 px wide | Setup: Import, Objects, Transform, Supports, Modes, Check (section 3). | setup; in a mode only its Exit button |
| Viewport | 798 × 680 px | Canvas; object name (setup) or mode badge (mode); mode bar (mode); view toggles Tips only / Fit view / Bottom view; Circle size preview; job activity list; Undo toast; drop overlay; unit note. | all states |
| Right panel | 300 px wide | Support settings (inventory, unchanged layout) and Export STL. Context header **[feature]**. | setup, Support Edit Mode; locked in zones |
| Footer | 32 px tall | Object count, active object's triangles, contact counts (automatic / manual / removed), status line (live region). | all states |

Viewport overlay positions (today, kept): object name or badge top-left (16 px, 14 px); mode bar
top-right under the badge row (top 56 px, right 14 px); view toggles top-right outside a mode and
bottom-right inside a mode (`.viewport--editing .viewport-view`); job activity bottom-left; Undo toast
bottom centre; unit note bottom-right outside a mode. With the viewport "Edit supports" button removed
**[change]**, the view toggles move up to the top-right corner (top 12 px) outside a mode.

Below 1100 px (today, kept): viewport on top, panels below, the mode bar docks at the viewport
bottom, toast moves to the top. Focus-mode dimming applies to the panels wherever they sit.

### 2.2 Wireframe legend

`[ Label ]` secondary button · `[* Label *]` primary (red fill) · `[! Label !]` destructive
(`.danger` outline) · `[= Label =]` pressed / chosen (ink fill, paper text) · `[a|=b=|c]` segmented
group, `b` chosen · `░` dimmed and locked (`inert`) · `#` red 1 px mode frame (both modes) ·
 `|A|` the active object's letter badge (red) · `v` / `>` open / closed group. Panel content is
abbreviated where 11.5 px text would not fit 22 ASCII columns; exact strings are in section 6.
English shown; zh-Hant and ja are longer and must fit the same rows (see 7.6).

### 2.3 No mode (setup)

```text
+--------------------------------------------------------------------------------------------------------------------+
| MIXO SUPPORTS  Resin Support Studio      [EN|ZH|JA]  [Undo][Redo] | [Hide models][Wireframe]                       |
+----------------------+-------------------------------------------------------------------+-------------------------+
| IMPORT MODELS        | bust.stl                        [Tips only][Fit view][Bottom view]| SUPPORT SETTINGS  bust  |
| [ Import models    ] |                                                                   | Preset [Lt|=Md=|Hv|Cu]  |
|  STL, GLB or glTF.   |                                                                   | Lift height    5.0 mm   |
| OBJECTS           3  |                                                                   | Roof/cage [=Off=|Rf|Cg] |
| |A| bust.stl    412  |                                                                   | v Auto placement        |
|  B  base.stl     88  |                         .----------.                              |   Support spacing  3.0  |
|  C  ring.stl      -  |                        (   model    )                             |   Overhang angle   50   |
| [Select all][Delete] |                         '--||-||--'                               |   [x] Downward faces    |
| TRANSFORM            |                            || ||   supports                       |   [x] Islands           |
| [Select|=Move=|Rot.] |                     ======================  build plate           | v Contact tip           |
| SUPPORTS FOR ALL 3   |                                                                   |   Shape [=None=|Sphere] |
| [*Regenerate      *] |                                                                   |   Point dia.  0.40 mm   |
| [Clear manual edits] |                                                                   | > Pillar                |
| [! Remove supports!] |                                                                   | > Foot                  |
| MODES                |                                                                   | > Bracing               |
| [ Edit supports    ] |                                                                   | > Raft                  |
| [ No-support zones ] |                                                                   | > Letter label          |
| CHECK SUPPORTS       |                                                                   | > Advanced              |
| [Check for unsupp. ] | +-----------------------------+                                   | EXPORT STL              |
|  o Island  A    [Fix]| | Placing contacts... 42% [x] |   (job activity, only while busy) | [Active obj + model ]   |
|  o Overhang A   [Fix]| +-----------------------------+                                   | [Active, supports   ]   |
|                      |            [ Manual edits cleared. . Undo ]   (toast, 6 s)        | [Each obj + model   ]   |
|                      |                                  Millimetres. Build plate at zero.| [Each, supports     ]   |
|                      |                                                                   | [Whole plate, 1 file]   |
+----------------------+-------------------------------------------------------------------+-------------------------+
| 3 objects   412,330 triangles   396 automatic, 16 manual, 2 removed          (status) Support added.               |
+--------------------------------------------------------------------------------------------------------------------+
```

Notes: one primary (left Generate, blue when it reads Regenerate). The view toggles take the
top-right corner. Job list and toast appear only while there is something to show.

### 2.4 Support Edit Mode, Add tool

```text
+--------------------------------------------------------------------------------------------------------------------+
| MIXO SUPPORTS  Resin Support Studio      [EN|ZH|JA]  [Undo][Redo] | [Hide models][Wireframe]                       |
+----------------------+-------------------------------------------------------------------+-------------------------+
| Finish editing       |#=================================================================#| SUPPORT SETTINGS  bust  |
| supports first: press|#[SUPPORT EDIT MODE  bust.stl  Click the model to add supports]   #| Preset [Lt|=Md=|Hv|Cu]  |
| Esc or Done.         |#                                                                 #| Lift height    5.0 mm   |
|                      |#                    +------------------------------------------+ #| Roof/cage [=Off=|Rf|Cg] |
|░IMPORT MODELS        |#                    | [=Add supports=][ Select supports ]      | #| v Auto placement        |
|░[ Import models    ] |#                    | Click reach   [ 1.5 ] mm                 | #|   Support spacing  3.0  |
|░ STL, GLB or glTF.   |#                    | Right-click / Ctrl+Click remove  Ctrl+Z  | #|   Overhang angle   50   |
|░OBJECTS           3  |#                    |                          [* Done  Esc *] | #|   [x] Downward faces    |
|░|A| bust.stl    412  |#                    +------------------------------------------+ #|   [x] Islands           |
|░ B  base.stl     88  |#                         .----------.                            #| v Contact tip           |
|░ C  ring.stl      -  |#                        (   model  + )  + = ghost tip at cursor  #|   Shape [=None=|Sphere] |
|░[Select all][Delete] |#                         '--||-||--'                             #|   Point dia.  0.40 mm   |
|░TRANSFORM            |#                     ======================                      #| > Pillar                |
|░[Select|=Move=|Rot.] |#                                                                 #| > Foot                  |
|░SUPPORTS FOR ALL 3   |#                                                                 #| > Bracing               |
|░[*Regenerate      *] |#                                                                 #| > Raft                  |
|░[Clear manual edits] |#                                                                 #| > Letter label          |
|░[! Remove supports!] |#                                                                 #| > Advanced              |
| MODES                |#                                                                 #| EXPORT STL              |
| [=Exit Support Edit=]|#                                                                 #| [Active obj + model ]   |
|   (live, ink fill)   |#                                                                 #| [Active, supports   ]   |
|░[ No-support zones ] |#                                                                 #| [Each obj + model   ]   |
|░CHECK SUPPORTS       |#                                                                 #| [Each, supports     ]   |
|░[Check for unsupp. ] |#                                                                 #| [Whole plate, 1 file]   |
|░ o Island  A    [Fix]|#                               [Tips only][Fit view][Bottom view]#|                         |
|░ o Overhang A   [Fix]|#=================================================================#|                         |
+----------------------+-------------------------------------------------------------------+-------------------------+
| 3 objects   412,330 triangles   396 automatic, 17 manual, 2 removed    Support Edit Mode: click the model to add...|
+--------------------------------------------------------------------------------------------------------------------+
```

Notes: the left panel is dimmed and locked except its Exit button (4.4); the lock note sits at the
panel top at full opacity. The right panel stays live (today's content shown; the context header of
section 11 comes later). The bar reads top to bottom: tool, tool option (Click reach), key hints,
Done. No selection actions exist under Add.

### 2.5 Support Edit Mode, Select → Drag over, 37 supports selected

```text
+--------------------------------------------------------------------------------------------------------------------+
| MIXO SUPPORTS  Resin Support Studio      [EN|ZH|JA]  [Undo][Redo] | [Hide models][Wireframe]                       |
+----------------------+-------------------------------------------------------------------+-------------------------+
| Finish editing       |#=================================================================#| SUPPORT SETTINGS  bust  |
| supports first: press|#[SUPPORT EDIT MODE  bust.stl  Drag over supports to select]      #| Settings for 37         |
| Esc or Done.         |#                                                                 #| selected  [Reset to     |
|                      |#      +---------------------------------------------------------+#|            defaults]    |
|░IMPORT MODELS        |#      | [ Add supports ][=Select supports=]                     |#| Changes apply to the    |
|░[ Import models    ] |#      | How to select:  [ > Click ] [= Drag over =]             |#| selected supports only. |
|░ STL, GLB or glTF.   |#      |                 [=Select=|Unselect]  Circle size  24 px |#|░Preset [Lt|Md|Hv|Cu]    |
|░OBJECTS           3  |#      |                 Hold Shift to unselect  [-----o-------] |#|░Lift height    5.0 mm   |
|░|A| bust.stl    412  |#      | Right-click remove   Ctrl+Z undo                        |#|░Roof/cage [Off|Rf|Cg]   |
|░ B  base.stl     88  |#      | 37 selected [Clear selection] [! Delete !] [*Done Esc*] |#|░> Auto placement        |
|░ C  ring.stl      -  |#      +---------------------------------------------------------+#|░> Tree supports         |
|░[Select all][Delete] |#                         .----------.                            #| v Contact tip           |
|░TRANSFORM            |#                        (   model    )      ( O ) = circle,      #|   Shape [None|Sphere]   |
|░[Select|=Move=|Rot.] |#                         '--##-##--'        red: Select          #|   Point dia.   --  mm   |
|░SUPPORTS FOR ALL 3   |#                     ======================  grey + "-": Unselect#|   Penetration 0.30 mm   |
|░[*Regenerate      *] |#                                                                 #| v Pillar                |
|░[Clear manual edits] |#                                                                 #|   Middle dia. 1.20 mm   |
|░[! Remove supports!] |#                                                                 #| v Foot                  |
| MODES                |#                                                                 #|   Bottom dia. 3.00 mm   |
| [=Exit Support Edit=]|#                                                                 #|░> Bracing               |
|   (live, ink fill)   |#                                                                 #|░> Raft                  |
|░[ No-support zones ] |#                                                                 #|░> Letter label          |
|░CHECK SUPPORTS       |#                                                                 #|░> Advanced              |
|░[Check for unsupp. ] |#                                                                 #| EXPORT STL              |
|░ o Island  A    [Fix]|#                                                                 #| [Active obj + model ]   |
|░ o Overhang A   [Fix]|#                                                                 #| [Active, supports   ]   |
|                      |#                                                                 #| [Each obj + model   ]   |
|                      |#                               [Tips only][Fit view][Bottom view]#| [Each, supports     ]   |
|                      |#=================================================================#| [Whole plate, 1 file]   |
+----------------------+-------------------------------------------------------------------+-------------------------+
| 3 objects   412,330 triangles   396 automatic, 16 manual, 2 removed    Support Edit Mode: drag the circle over...  |
+--------------------------------------------------------------------------------------------------------------------+
```

Notes: Click | Drag over are the big icon buttons (`.tool-choice`); directly under Drag over sit the
Select | Unselect switch and Circle size, with the hint "Hold Shift to unselect" **[new]**. The
selection row appears only with a selection: "{n} selected", Clear selection, Delete (danger), and
Done stays last and red. The right panel is drawn in its **[feature]** state B (section 11); until
that feature ships it looks as in 2.4.

### 2.6 No-support zones (focus mode)

```text
+--------------------------------------------------------------------------------------------------------------------+
| MIXO SUPPORTS  Resin Support Studio      [EN|ZH|JA]  [Undo][Redo] | [Hide models][Wireframe]                       |
+----------------------+-------------------------------------------------------------------+-------------------------+
| Finish painting zones|#=================================================================#| Finish painting zones   |
| first: press Esc or  |#[PAINTING NO-SUPPORT ZONES  bust.stl]                            #| first: press Esc or     |
| Done.                |#                                                                 #| Done.                   |
|                      |#            +---------------------------------------------------+#|                         |
|░IMPORT MODELS        |#            | [=Paint=|Erase]  Brush size [-----o-----] 2.0 mm  |#|░SUPPORT SETTINGS  bust  |
|░[ Import models    ] |#            | Supports attach underneath: turn the view (Bottom |#|░Preset [Lt|=Md=|Hv|Cu]  |
|░ STL, GLB or glTF.   |#            | view) to paint where they are.          Ctrl+Z    |#|░Lift height    5.0 mm   |
|░OBJECTS           3  |#            |            [! Clear all zones !]  [* Done  Esc *] |#|░Roof/cage [=Off=|Rf|Cg] |
|░|A| bust.stl    412  |#            +---------------------------------------------------+#|░v Auto placement        |
|░ B  base.stl     88  |#                         .----------.                            #|░  Support spacing  3.0  |
|░ C  ring.stl      -  |#                        (  /////     )   //// = blue zone layer  #|░  Overhang angle   50   |
|░[Select all][Delete] |#                         '--..-..--'     (tips only, forced)     #|░  [x] Downward faces    |
|░TRANSFORM            |#                     ======================                      #|░  [x] Islands           |
|░[Select|=Move=|Rot.] |#                                                                 #|░v Contact tip           |
|░SUPPORTS FOR ALL 3   |#                                                                 #|░  Shape [=None=|Sphere] |
|░[*Regenerate      *] |#                                                                 #|░  Point dia.  0.40 mm   |
|░[Clear manual edits] |#                                                                 #|░> Pillar                |
|░[! Remove supports!] |#                                                                 #|░> Foot                  |
| MODES                |#                                                                 #|░> Bracing               |
| [=Exit no-support z=]|#                                                                 #|░> Raft                  |
|   (live, ink fill)   |#                                                                 #|░> Letter label          |
|░[ Edit supports    ] |#                                                                 #|░> Advanced              |
|░CHECK SUPPORTS       |#                                                                 #|░EXPORT STL              |
|░[Check for unsupp. ] |#                                                                 #|░[Active obj + model ]   |
|░ o Island  A    [Fix]|#                                                                 #|░[Active, supports   ]   |
|░ o Overhang A   [Fix]|#                                                                 #|░[Each obj + model   ]   |
|                      |#                             [=Tips only=][Fit view][Bottom view]#|░[Each, supports     ]   |
|                      |#=================================================================#|░[Whole plate, 1 file]   |
+----------------------+-------------------------------------------------------------------+-------------------------+
| 3 objects   412,330 triangles   396 automatic, 16 manual, 2 removed  Paint where supports must not grow; drag on...|
+--------------------------------------------------------------------------------------------------------------------+
```

Notes: both side panels are dimmed and locked; the only live panel control is the left Exit button
(4.4). Tips only shows pressed and does nothing (forced, today). Clear all zones lives only here
**[change]**, with an Undo toast. The frame is red like Support Edit Mode (mixo-app-style: a tool mode gets a
red hairline; blue is the zone layer on the model) **[change, confirm]**; the badge names the mode and
carries "{n} supports hidden by zones" **[new]**. The camera-above-plate note shows only while the camera is above the plate (today).

---

## 3. Left panel brush-up

### 3.1 Proposed order and why

1. **Import models** — first step, always at the top.
   Under it, one row with **Open project** and **Save project** (the file counterpart of Import; same lock in a mode). The format is the scene JSON under a `{ app: 'mixo-supports', version: 1 }` header, gzip-compressed where the browser can; opening an older or plain file works.
2. **Objects** — what was imported; selection decides the scope of everything below.
3. **Transform** — orient before generating (rotation changes placement).
4. **Supports for {scope}** — Generate / Regenerate (the primary), Clear manual edits, Remove supports.
5. **Modes** — Edit supports, No-support zones: hand work on the supports just generated, so it sits
   right under Supports.
6. **Check supports** — the last step before export; its findings list grows (up to 12 rows + "and
   {n} more"), so at the bottom it never pushes the Mode buttons below the fold at 768 px.

Export STL stays where it is today: at the bottom of the right panel (owner: "Export placement as
today").

Why Modes moved below Supports: today the mode sections sit between Transform and Supports, so the
eye meets "Enter Support Edit Mode" before anything was generated, and the panel order does not
follow the work order.

### 3.2 Before / after inventory

| # | Today (order, label) | After | Reason |
|---|---|---|---|
| 1 | Import models (drop / file picker), help "STL, GLB or glTF. Files stay on this device." | Same, position 1 | Unchanged. In a mode the panel is locked, so it cannot import mid-mode (4.5). |
| 2 | Objects: rows (letter, name, support count), Select all, Delete | Same, position 2; Delete restyled `.danger` **[change]** | Destructive role (P8). |
| 3 | Transform: Select / Move / Rotate (disabled in a mode) | Same, position 3 | Unchanged; the whole panel locks in a mode instead of this one control. |
| 4 | Section "Edit supports": button Enter Support Edit Mode / Exit Support Edit Mode, help "Add or remove supports by clicking the model. Tab toggles." (Tab no longer toggles, 8.2) | Moved into group **Modes** (position 5) as button **Edit supports** / **Exit Support Edit Mode** **[change]** | One group for both modes; label as owner named it. |
| 5 | Section "No-support zones" with count (Painted / None): button Paint zones / Exit no-support zones; **Clear** (danger, compact); help "Paint where supports must not grow. Manual supports stay." | Group **Modes**: button **No-support zones** / **Exit no-support zones**, with the muted state word Painted / None at the button's right end **[change]**. **Clear removed** (lives in the zones bar). | One button per mode, no other mode controls in the left panel. The state word is information, not a control: it tells the user zones exist (they change generation). |
| 6 | Supports for {scope}: Generate supports / Regenerate (red / blue), Clear manual edits, Remove supports | Same controls, position 4; Clear manual edits and Remove supports restyled `.danger` **[change]** | Work order; destructive role. |
| 7 | Check supports: Check for unsupported spots, findings (Show me, Fix in red), help line | Same, position 6; **Fix becomes secondary** **[change]** | P1: one primary per view (up to 12 red Fix buttons today). |
| 8 | Help lines under the two mode sections | One help line under the Modes group, shown only when both buttons are disabled: "Select an object first." or the heavy-model line | Says why, only when needed. |
| — | (viewport) "Edit supports" button top-right outside a mode | Removed **[change]** | Duplicate of the Modes button (P3); breaks sibling symmetry (zones has none). Tab is not a mode key any more (8.2). |
| — | (header) Generate supports for {scope} | Removed **[change, confirm]** | Duplicate of the Supports group button (P3) and a second red button (P1). |

### 3.3 The Click reach exception

Owner: the removal option belongs to the Add tool. Today it is a per-object setting in the right
panel (Advanced → Remove radius, setting `eraseRadius`, 0.1–50 mm, default 1.5). After the right-click
fix (11.0 a) it no longer removes a radius of supports: it is only the **pick tolerance**, how far
from a support a right-click may land and still hit it. The field is renamed **Click reach**
**[change]** (key `rp.eraseRadius` stays) so the label does not promise a wider erase than it does. The right panel stays
as is (owner), so the field stays there too. Both places bind the **same registry control**
(`setting.eraseRadius` of the active object): one state, two renderings, never diverging. The Add bar
renders it as a number field (same clamping and keys as the right panel), not a slider, because its
range (0.1–50 mm) is too wide for a slider. Recommendation **[confirm]**: drop it from the right panel
once the Add bar has it.

---

## 4. Mode state machine

### 4.1 States

```
UiState
  mode: 'setup' | 'edit' | 'zones'
  edit:  { tool: 'add' | 'select',
           method: 'click' | 'dragOver',          // under select
           dragAction: 'select' | 'unselect',      // under dragOver; the switch
           shiftHeld: boolean,                     // live key state, flips dragAction while held
           circleSize: 8..80 px (step 4, default 24),
           selection: Set<contactId> }
  zones: { tool: 'paint' | 'erase', brushSize: 0.5..10 mm (step 0.5, default 2) }
  guards: active (an active object), editable (active and not heavy)
```

Effective drag action = `shiftHeld ? flip(dragAction) : dragAction` **[new]**. The tool, method,
switch, sizes survive mode changes and object changes (today's rule); the selection empties on every
mode change and active-object change (today). `zonesReturn` is deleted **[change]**: zones always
returns to setup.

### 4.2 Diagram

```
                ENTER_EDIT  (Edit supports button, check finding Fix)        guard: editable
      ┌───────┐ ─────────────────────────────────────────────────────────▶ ┌──────────────┐
      │       │ ◀───────────────────────────────────────────────────────── │ edit         │
      │ setup │   EXIT = mode.exit (Done, Exit button, Esc*, Enter†)       │  add         │
      │       │                                                            │  select      │
      │       │ ENTER_ZONES (No-support zones button)   guard: editable    │   click      │
      │       │ ──────────────────────────────▶ ┌────────────┐             │   dragOver   │
      │       │ ◀────────────────────────────── │ zones      │             │    select    │
      └───────┘   EXIT (Done, Exit button,      │  paint     │             │    unselect  │
          ▲        Esc, Enter†)                 │  erase     │             └──────────────┘
          │                                     └────────────┘
          └── FORCE_LEAVE from any mode: the active object goes (Delete, Undo past its import).
   No edge edit ⇄ zones: exit first (P5). "Edit no-support zones →" is removed.
   * Esc in edit with a selection clears the selection first (Undo toast); the next Esc exits.
   Every EXIT edge is the one command `mode.exit`; Tab is not a mode key.
   † Enter exits only when focus is not on a button, link, summary or tabindex element (today).
```

### 4.3 Transitions

| From | Event (sources) | Guard | To | Effects |
|---|---|---|---|---|
| setup | ENTER_EDIT (Modes → Edit supports; check Fix on a finding) | editable | edit | Undo floor = scene now; selection empty; status = tool line (6.4); focus → mode bar's pressed tool button (8.2). Fix selects the finding's object first, then enters (today). |
| setup | ENTER_EDIT / ENTER_ZONES | no active object | setup | Status "Select an object to edit its supports." / "Select an object first." (today). The buttons are disabled in this state, so no control reaches this row; it stays as a guard. |
| setup | ENTER_EDIT / ENTER_ZONES | heavy | setup | Status: the heavy-model line (today). |
| setup | ENTER_ZONES (Modes → No-support zones) | editable | zones | Undo floor; Tips only forced; focus → Paint / Erase group. |
| edit | EXIT = `mode.exit` (Done; left Exit Support Edit Mode; Esc with no selection; Enter†) | — | setup | Status "Support edits kept."; focus → left Modes button. |
| edit | Esc | selection > 0 | edit | Clear selection, Undo toast (today). |
| edit | Delete / Backspace | selection > 0 | edit | Delete selected, one undo step (today). |
| edit | ENTER_ZONES | — | — | Not reachable: the zones button is locked in edit (4.4), no shortcut exists. |
| zones | EXIT = `mode.exit` (Done; left Exit no-support zones; Esc; Enter†) | — | setup | Status "No-support zones kept."; Tips only returns to its previous state; focus → left Modes button. |
| edit, zones | click on another object in the viewport | — | same | Refused, status "Finish … first: press Esc or Done." (today). |
| edit, zones | file dropped on the viewport | — | same | Refused with the same busy line **[change, confirm]** (today an import ends the mode). |
| edit, zones | the active object leaves the scene | — | setup | Forced exit (today). |
| edit, zones | Esc or Enter typed in a text, number, select or textarea field | focus in the field | same | Affects only the field (revert, blur, commit); no mode event **[change]** (8.6). |
| edit, zones | click on a locked region of either panel | — | same | Status "Finish ... first: press Esc or Done." and the lock note pulses **[change]** (4.5). |
| edit (sub) | Tool Add ↔ Select; Click ↔ Drag over; switch Select ↔ Unselect | — | edit | Status line updates to the new tool line (today); badge text follows (6.4). |
| edit (sub) | Shift down / up during Drag over | method = dragOver | edit | `shiftHeld` flips the effective drag action; the circle, cursor badge and badge text follow at once; a running stroke applies it to later steps (stroke queue keeps per-step mode, today) **[new]**. |

Removed transitions **[change]**: edit → zones ("Edit no-support zones →", `openZones from: 'edit'`),
zones → edit (`closeZones` with `zonesReturn = 'edit'`), and "Remove supports ends the mode" (Remove
supports is in the locked left panel, so it cannot be pressed in a mode).

### 4.4 What each region does per state

| Region | setup | edit (Support Edit Mode) | zones (No-support zones, focus mode) |
|---|---|---|---|
| Header | live | live. The lock blocks scene-changing commands only: Undo / Redo stay live down to the mode's floor, and the view toggles (Hide models, Wireframe, language) are never locked **[confirm]** | live (same rule) |
| Left panel | live | dimmed + locked; **Exit Support Edit Mode** stays live (pressed, ink) | dimmed + locked; **Exit no-support zones** stays live (pressed, ink) |
| Viewport | object name, view toggles top-right, unit note | red frame, red badge, edit bar top-right, view toggles bottom-right | red frame, red badge, zones bar top-right, view toggles bottom-right, Tips only forced |
| Right panel | live | **live** (owner ruling): settings and Export | dimmed + locked, no exception |
| Footer | live | live | live |
| Keyboard | Delete (objects), G, R, Ctrl+Z / Y | Esc, Enter, Delete / Backspace (supports), Shift (Drag over), Ctrl+Z / Y | Esc, Enter, Ctrl+Z / Y |

**Decision: the Exit button stays live inside the locked left panel, in both modes.** Reasons: (1)
the button that took the user in takes them out, in the same spot, as shipped; (2) a visible
"Exit …" label on a dead button would be a dead control (the user clicks, nothing happens); (3) one
rule for both modes, so the user learns it once; (4) focus mode exists to stop scene changes from the
panels while painting, and leaving the mode is not a scene change. The viewport Done and Esc remain;
in zones the viewport Done is the primary exit, the left Exit the secondary one. **Left Exit and
viewport Done dispatch the same command id, `mode.exit`**, with the same guard, the same effects and the
same status line, so they can never disagree; Esc and Enter† map to it too. Two of four reviewers
preferred a single Exit in the viewport bar; the choice is kept (C2). Implementation: put
`inert` on every left-panel section and on the other mode's button, not on the panel element
(an `inert` ancestor cannot have a live child).

### 4.5 Lock behaviour details

- A locked region gets the lock note at its top, at full opacity, not inert: edit → "Finish editing
  supports first: press Esc or Done."; zones → "Finish painting zones first: press Esc or Done."
  (existing strings, today used as the busy status).
- A click on a locked region repeats the note in the status line and pulses the lock note (a
  transparent, non-focusable catcher over the inert sections; **required**, so a click never vanishes
  silently) **[change]**.
- The header lock blocks scene-changing commands only. View toggles (Hide models, Wireframe, language)
  stay live in every mode.
- Job activity Cancel / Dismiss and the Undo toast are inside the viewport, so they stay live in
  every state.
- Fix on a check finding and Remove supports cannot run in a mode (their panel is locked); today's
  code paths that end a mode for them (`send({ type: 'leave' })` at App.tsx:532, 567) stay as a guard.

### 4.6 Framework-free shape

```ts
// src/editing/uiMachine.ts (proposed; replaces session.ts mode/tool fields, keeps selection rules)
type Mode = 'setup' | 'edit' | 'zones';
type UiEvent =
  | { type: 'enterEdit' } | { type: 'enterZones' } | { type: 'exit' } | { type: 'forceLeave' }
  | { type: 'setTool'; tool: 'add' | 'select' } | { type: 'setMethod'; method: 'click' | 'dragOver' }
  | { type: 'setDragAction'; action: 'select' | 'unselect' } | { type: 'shift'; held: boolean }
  | { type: 'setCircleSize'; px: number } | { type: 'setZoneTool'; tool: 'paint' | 'erase' }
  | { type: 'setBrushSize'; mm: number } | { type: 'escape' } /* … selection events as today */;
function reduce(state: UiState, event: UiEvent): UiState; // same object when nothing changes
```

---

## 5. Command registry

### 5.1 Shape

Every control is defined once; panels, the mode bar, the badge, the status line and the keyboard
handler render or dispatch from these records. No component decides visibility or enabled state by
itself.

```ts
interface Command {
  id: string;                       // stable, e.g. 'edit.tool.add'
  label: string;                    // i18n key (English text), or a function of state for two-state buttons
  hint: string;                     // i18n key, shown as title + aria-description
  icon?: 'pointer' | 'brush';       // ToolIcons; most controls are words only
  shortcut?: string;                // display + keyAction binding
  surface: 'header' | 'left' | 'viewport' | 'editBar' | 'zonesBar' | 'right' | 'keyboard';
  role: 'primary' | 'secondary' | 'destructive' | 'toggle' | 'choice' | 'field' | 'info';
  visible(s: UiState): boolean;
  enabled(s: UiState): boolean;     // false → disabled (or inert when the region is locked)
  pressed?(s: UiState): boolean;
  run(ctx: AppContext, s: UiState): void; // a UiEvent or a scene command; never DOM
}
```

Region lock is applied by the renderer from 4.4, on top of `enabled`: a control in a locked region is
inert regardless of its own rule, except the commands marked "lock-exempt".
The two exit buttons and Esc / Enter† all run `mode.exit`; there is no second exit implementation.

State names used below: `mode`, `tool`, `method`, `dragAction`, `zoneTool`, `units` (objects on the
plate), `selObj` (selected objects), `active`, `editable`, `sel` (selected supports), `anySupports`,
`hasZones`, `exporting`, `canUndo`, `canRedo`, `findings`. Copy ids (column "Copy") point to 6.2.

### 5.2 Header

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| app.lang | EN / 中文 / 日本語 (language names, not translated) | — | language's own name | — | always | always | choice | today |
| history.undo | hdr.undo | — | hdr.undo.hint | Ctrl+Z | always | canUndo (stops at the mode floor) | secondary | today |
| history.redo | hdr.redo | — | hdr.redo.hint | Ctrl+Shift+Z, Ctrl+Y | always | canRedo | secondary | today |
| view.models | hdr.hideModels / hdr.showModels | — | hdr.hideModels.hint / hdr.showModels.hint | — | always | always | toggle | today |
| view.wireframe | hdr.wireframe / hdr.solid | — | hdr.wireframe.hint / hdr.solid.hint | — | always | always | toggle | today |
| supports.generate (header copy) | hdr.generateScope | — | sup.generate.hint | — | — | — | primary | **removed [confirm]** |

Header lock rule: in a mode the header blocks scene-changing commands only; `view.models`, `view.wireframe`
and `app.lang` are never locked, `history.*` stay live down to the mode's floor. (If C1 is declined and the
header Generate stays, it locks in modes.)

### 5.3 Left panel

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| import.files | imp.title, imp.help | — | imp.hint | drop on viewport | always | mode = setup | secondary (drop zone) | today; viewport drop refused in a mode **[change]** |
| project.open | Open project | — | Open a .mixosupports project. It replaces the plate; Undo brings the previous plate back | drop a .mixosupports file on the viewport | always | mode = setup (refused with the "Finish … first" line in a mode, like an import) | secondary | **[new]** |
| project.save | Save project | — | Save the plate, supports and hand edits as a .mixosupports file | — | always | units > 0 ("Import a model first.") | secondary | **[new]** |
| objects.row[i] | object letter, name, support count | — | obj.row.hint | Shift / Ctrl+click adds or removes | units > 0 | mode = setup | choice | today |
| objects.selectAll | obj.selectAll | — | obj.selectAll.hint | — | always | units > 0 | secondary | today |
| objects.delete | obj.delete | — | obj.delete.hint | Delete (setup) | always | selObj > 0 | destructive | role **[change]** |
| transform.mode | tr.select / tr.move / tr.rotate | — | tr.*.hint | G (Move), R (Rotate) | always | mode = setup | choice | today |
| supports.generate | sup.generate / sup.regenerate | — | sup.generate.hint | — | always | units > 0 | primary (blue when Regenerate) | today |
| supports.clearManual | sup.clearManual | — | sup.clearManual.hint | — | always | units > 0 | destructive (Undo toast) | role **[change]** |
| supports.remove | sup.remove | — | sup.remove.hint | — | always | units > 0 | destructive | role **[change]** |
| mode.edit | mode.edit / mode.exitEdit | — | mode.edit.hint / mode.exitEdit.hint | — (Tab removed **[change]**) | always | setup: editable; edit: true (**lock-exempt**); zones: false | secondary; pressed (ink) in edit; runs `mode.exit` while pressed | label **[change]** |
| mode.zones | mode.zones (+ zones.state Painted / None) / mode.exitZones | — | mode.zones.hint / mode.exitZones.hint | — | always | setup: editable; zones: true (**lock-exempt**); edit: false | secondary; pressed (ink) in zones; runs `mode.exit` while pressed | label **[change]** |
| mode.exit | (the shared command behind both Exit buttons, both Done buttons, Esc and Enter†) | — | — | Esc, Enter† | mode ≠ setup | always | — | **[new]** |
| mode.help | sel.first / heavy line | — | — | — | setup and both mode buttons disabled | — | info | **[change]** |
| check.run | chk.run | — | chk.help | — | always | anySupports | secondary | today |
| check.showMe[i] | chk.showMe | — | chk.showMe.hint | — | findings > 0 | mode = setup | secondary | today |
| check.fix[i] | chk.fix | — | chk.fix.hint | — | findings > 0 | mode = setup | secondary | role **[change]** (was primary) |

### 5.4 Right panel (summary; inventory only)

| id | Label (copy) | Hint | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|
| right.header | rp.title + active object name (+ "and {n} more") | — | always | — | info | today; context header **[feature]** |
| right.help | rp.help | — | no active object | — | info | today |
| setting.preset | rp.preset: Light / Middle / Heavy, Custom (indicator, always disabled) | rp.preset.hint, per-preset hints | always | active | choice | today |
| setting.liftHeight | rp.lift (number, mm) | rp.lift.hint | always | active | field | today |
| setting.roofMode | rp.roof: Off / Roof / Cage | rp.roof.hint, per-mode hints | always | active | choice | today |
| setting.group[g] | 10 collapsible groups: Auto placement (open), Tree supports (when Tree supports on), Contact tip (open), Pillar, Foot, Bracing, Raft, Roof (when Roof), Cage (when Cage), Letter label, Advanced | per field | per group rule | active | field | today (field list: 6.3) |
| setting.eraseRadius | Advanced → Click reach | rp.eraseRadius.hint | always | active | field | today; also rendered in the Add bar (3.3) |
| export.kind[5] | exp.activePrintable, exp.activeSupports, exp.separatePrintable, exp.separateSupports, exp.wholePrintable | per kind | always | units > 0 and not exporting | secondary | today |
| right.lock | lock.zones | — | mode = zones | — | info | **[new]** placement of an existing string |

Right panel rule: live in setup and edit, locked in zones (4.4).

### 5.5 Viewport (any state)

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| vp.objectName | active object name / vp.nothing | — | — | — | mode = setup | — | info | today |
| view.tips | vp.tips | — | vp.tips.hint.off / .on / .forced | — | always | always; `aria-disabled` while zones (forced on) | toggle | today |
| view.fit | vp.fit | — | vp.fit.hint | — | always | units > 0 | secondary | today |
| view.bottom | vp.bottom | — | vp.bottom.hint | — | always | units > 0 | secondary | today |
| vp.editToggle | mode.edit | — | — | — | — | — | secondary | **removed [change]** |
| vp.note | vp.note | — | — | — | mode = setup | — | info | today |
| vp.dropOverlay | vp.drop | — | — | — | file dragged over, mode = setup | — | info | today; not in a mode **[change]** |
| jobs.cancel[i] | job.cancel | — | job.cancel aria-label | — | cancellable job running | always | secondary | today |
| jobs.dismiss[i] | job.dismiss | — | — | — | job failed | always | secondary | today |
| toast.undo | hdr.undo | — | toast.undo.hint | — | toast shown (6 s, paused on hover / focus) | always | secondary | today |
| vp.circlePreview | (circle at view centre) | — | — | — | method = dragOver and Circle size moving, + 800 ms | — | info | today |

### 5.6 Support Edit Mode (edit bar, badge)

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| edit.badge | badge.edit + object name + badge.add / badge.click / badge.drag / badge.dragUnselect | — | — | — | mode = edit | — | info (`role="status"`) | today; texts **[change]** |
| edit.tool | edit.add / edit.select (group label edit.tool) | — | edit.add.hint / edit.select.hint | — | mode = edit | always | choice | today |
| edit.removeRadius | rp.eraseRadius + "{n} mm" | — | rp.eraseRadius.hint | — | tool = add | active | field (number) | **[new]** placement (3.3) |
| edit.keys.add | kbd Right-click / Ctrl+Click "remove", Ctrl+Z "undo" | — | — | — | tool = add | — | info | today |
| edit.method | edit.click / edit.dragOver (group label edit.how) | pointer / brush | edit.click.hint **[change]** / edit.dragOver.hint | — | tool = select | always | choice (`.tool-choice`) | today |
| edit.dragAction | edit.dragSelect / edit.dragUnselect (group label edit.dragging) | — | edit.dragSelect.hint / edit.dragUnselect.hint; group hint edit.shift | hold **Shift** = the other one while held | method = dragOver | always | choice; shows the effective action while Shift is held | today; Shift **[new]** |
| edit.circleSize | edit.circle + "{n} px" (8–80, step 4) | — | edit.circle.hint | — | method = dragOver | always | field (slider) | today |
| edit.keys.select | kbd Right-click "remove", Ctrl+Z "undo" | — | — | — | tool = select | — | info | today |
| edit.selCount | sel.count "{n} selected" | — | — | — | sel > 0 | — | info | today |
| edit.clearSelection | sel.clear | — | sel.clear.hint | Esc (with a selection) | sel > 0 | always | secondary | today |
| edit.deleteSelection | obj.delete ("Delete") | — | sel.delete.hint | Delete, Backspace | sel > 0 | always | destructive | today |
| edit.adjust | — | — | — | — | — | — | — | not a button: becomes the right panel's "Settings for {n} selected" **[feature]** |
| edit.done | done + kbd Esc | — | edit.done.hint | Esc (no selection), Enter† | mode = edit | always | primary; runs `mode.exit` | today |
| edit.openZones | Edit no-support zones → | — | — | — | — | — | — | **removed [change]** |

### 5.7 No-support zones (zones bar, badge)

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| zones.badge | badge.zones + object name + zones.hidden "{n} supports hidden by zones" (from the shown build's `dropped` contacts, App.tsx:206) | — | — | — | mode = zones | — | info (`role="status"`) | today; count **[new]** |
| zones.tool | zones.paint / zones.erase (group label zones.brush) | — | zones.paint.hint / zones.erase.hint | — | mode = zones | always | choice | today |
| zones.brushSize | zones.size + "{n} mm" (0.5–10, step 0.5) | — | zones.size.hint | — | mode = zones | always | field (slider) | today |
| zones.keys | kbd Ctrl+Z "undo" | — | — | — | mode = zones | — | info | today |
| zones.note | zones.note | — | — | — | camera above the plate | — | info (`role="note"`) | today |
| zones.clearAll | zones.clearAll | — | zones.clearAll.hint | — | mode = zones | hasZones | destructive (Undo toast) | today; the only "Clear all zones" now **[change]** |
| zones.done | done + kbd Esc | — | zones.done.hint | Esc, Enter† | mode = zones | always | primary; runs `mode.exit` | today |
| zones.clearLeft | Clear (left panel, compact) | — | — | — | — | — | — | **removed [change]** |

### 5.8 Keyboard-only bindings

| Key | State | Command | Visible equivalent |
|---|---|---|---|
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | any (not in a text field) | history.undo / history.redo | header Undo / Redo |
| Esc | edit with selection → edit.clearSelection; edit without → mode.exit; zones → mode.exit. Esc inside any text, number, select or textarea field only affects that field (open question Q1 on the order) | as named | Clear selection, Done |
| Enter† | edit, zones | mode.exit | Done |
| Delete, Backspace | edit with selection | edit.deleteSelection | Delete |
| Delete | setup | objects.delete | Objects → Delete |
| G / R | setup | transform.mode Move / Rotate | Transform group |
| Shift (held) | edit, method = dragOver | flips edit.dragAction while held **[new]** | the Select / Unselect switch |
| Click | edit, method = click | toggle one support; never clears the rest. Shift+click is not a separate action **[change]** | the click itself |
| Right-click, Ctrl+click | edit, tool = add | delete exactly the one support hit (pick tolerance: Click reach) **[change]** | Select → Delete |

### 5.9 Status line and badge as registry output

The status line and badge are rendered from the state, not written by controls:
`badgeText(state)` and `statusFor(prev, next, event)` (today `editing/status.ts`). Section 6.4 lists
their strings per state.

---

## 6. Copy

### 6.1 Naming rules

- **Paint / Erase / Brush** only for no-support zones (glossary `ZONE_ONLY_WORDS`, enforced by
  `glossary.test.ts`). **Select / Drag over / Circle size** only for picking supports. Never "brush"
  for Drag over.
- **Delete** = exactly the selected items. **Remove** = one support by right-click (exact), or all
  supports of an object. **Clear** = empty a list (selection, zones, manual edits) with an Undo toast.
- **Support Edit Mode** is the mode's name (badge, status, exit button); "Edit supports" is the verb
  on the entry button. **No-support zones** is the zone mode's name; "Paint" is its tool.
- One term per concept per language (glossary): 支撐 / サポート, 免支撐區 / サポート禁止エリア, 物件 /
  オブジェクト, 移除 vs 刪除 / 削除, 匯出 / 書き出し (never 輸出 / エクスポート).
- Labels fit one row at 11.5 px in all three languages; a long label wraps its value to its own line,
  never clips (mixo-app-style).
- New strings below are **proposed**: add each to `src/locales/zh-Hant.ts` and `src/locales/ja.ts`
  and let `glossary.test.ts` / `i18n.test.ts` check them; zh-Hant should get a native read (Gemini
  bridge "翻成台灣中文") before merge.

### 6.2 Header, left panel, viewport, modes

Locale line numbers: `zh` = `src/locales/zh-Hant.ts`, `ja` = `src/locales/ja.ts`.

| Copy id | en (i18n key) | zh-Hant | ja | Status |
|---|---|---|---|---|
| hdr.subtitle | Resin Support Studio | 樹脂支撐工作室 (zh:6) | レジンサポートスタジオ (ja:5) | today |
| hdr.lang.label | Language | 語言 (zh:7) | 言語 (ja:6) | today |
| hdr.undo | Undo | 復原 (zh:8) | 元に戻す (ja:7) | today |
| hdr.redo | Redo | 重做 (zh:9) | やり直す (ja:8) | today |
| hdr.undo.hint | Undo (Ctrl+Z) | 復原（Ctrl+Z） (zh:10) | 元に戻す（Ctrl+Z） (ja:9) | today |
| hdr.redo.hint | Redo (Ctrl+Shift+Z) | 重做（Ctrl+Shift+Z） (zh:11) | やり直す（Ctrl+Shift+Z） (ja:10) | today |
| hdr.hideModels | Hide models | 隱藏模型 (zh:12) | モデルを隠す (ja:11) | today |
| hdr.showModels | Show models | 顯示模型 (zh:13) | モデルを表示 (ja:12) | today |
| hdr.hideModels.hint | Hide the models to see the supports alone. Export is not affected | 隱藏模型，只看支撐。不影響匯出 (zh:300) | モデルを隠してサポートだけを表示します。書き出しには影響しません (ja:296) | today |
| hdr.showModels.hint | Show the models again | 重新顯示模型 (zh:301) | モデルを再表示します (ja:297) | today |
| hdr.wireframe | Wireframe | 線框 (zh:15) | ワイヤーフレーム (ja:14) | today |
| hdr.solid | Solid | 實體 (zh:14) | ソリッド (ja:13) | today |
| hdr.wireframe.hint | Draw the models as wireframes to see supports behind them | 以線框顯示模型，看得到後方的支撐 (zh:303) | モデルをワイヤーフレームで表示し、奥のサポートを見えるようにします (ja:299) | today |
| hdr.solid.hint | Draw the models solid | 以實體顯示模型 (zh:302) | モデルをソリッドで表示します (ja:298) | today |
| hdr.generateScope | Generate supports for {scope} / Regenerate supports for {scope} / Generating supports | 為{scope}產生支撐 / 為{scope}重新產生支撐 / 正在產生支撐 (zh:17, 18, 16) | {scope}にサポートを生成 / {scope}のサポートを再生成 / サポートを生成中 (ja:16, 17, 15) | removed from the header **[confirm]**; keys stay for the scope wording |
| scope.selected | {n} selected | 已選取的 {n} 個 (zh:20) | 選択中の {n} 個 (ja:19) | today |
| scope.all | all {n} | 全部 {n} 個 (zh:21) | 全 {n} 個 (ja:20) | today |
| imp.title | Import models | 匯入模型 (zh:22) | モデルを読み込む (ja:21) | today |
| imp.help | STL, GLB or glTF. Files stay on this device. | STL、GLB 或 glTF。檔案只留在這台裝置上。 (zh:23) | STL・GLB・glTF に対応。ファイルはこの端末から外に出ません。 (ja:22) | today |
| imp.hint | Choose STL, GLB or glTF files, or drop them on the viewport | 選擇 STL、GLB 或 glTF 檔案，或直接拖放到視圖中 (zh:305) | STL・GLB・glTF ファイルを選ぶか、ビューポートにドロップします (ja:301) | today |
| obj.title | Objects | 物件 (zh:24) | オブジェクト (ja:23) | today |
| obj.empty | Each STL, and each mesh inside a glTF, becomes its own object. | 每個 STL，以及 glTF 裡的每個網格，都會成為獨立的物件。 (zh:25) | STL ごと、glTF 内のメッシュごとに個別のオブジェクトになります。 (ja:24) | today |
| obj.row.hint | Click to select; Shift+click or Ctrl+click adds it to the selection or takes it out | 點擊即可選取；Shift+點擊或 Ctrl+點擊可加入或移出選取 (zh:306) | クリックで選択。Shift+クリックまたは Ctrl+クリックで選択に追加・解除します (ja:302) | today |
| obj.count | 1 support / {n} supports / No supports yet | 1 個支撐 / {n} 個支撐 / 尚無支撐 (zh:27, 26, 28) | サポート 1 本 / サポート {n} 本 / サポートなし (ja:26, 25, 27) | today |
| obj.selectAll | Select all | 全選 (zh:29) | すべて選択 (ja:28) | today |
| obj.selectAll.hint | Select every object | 選取所有物件 (zh:307) | すべてのオブジェクトを選択します (ja:303) | today |
| obj.delete | Delete | 刪除 (zh:30) | 削除 (ja:29) | today |
| obj.delete.hint | Delete the selected objects (Delete key). Undo brings them back | 刪除選取的物件（Delete 鍵）。復原可找回 (zh:308) | 選択したオブジェクトを削除します（Delete キー）。「元に戻す」で復元できます (ja:304) | today |
| tr.title | Transform | 變換 (zh:31) | トランスフォーム (ja:30) | today |
| tr.select / tr.move / tr.rotate | Select / Move / Rotate | 選取 / 移動 / 旋轉 (zh:32–34) | 選択 / 移動 / 回転 (ja:31–33) | today |
| tr.select.hint | Select objects without a gizmo | 選取物件，不顯示操作把手 (zh:309) | ギズモなしでオブジェクトを選択します (ja:305) | today |
| tr.move.hint | Move the active object with the gizmo (G) | 用操作把手移動使用中的物件（G） (zh:310) | ギズモでアクティブなオブジェクトを移動します（G） (ja:306) | today |
| tr.rotate.hint | Rotate the active object with the gizmo (R) | 用操作把手旋轉使用中的物件（R） (zh:311) | ギズモでアクティブなオブジェクトを回転します（R） (ja:307) | today |
| sup.title | Supports for {scope} | {scope}的支撐 (zh:41) | {scope}のサポート (ja:40) | today |
| sup.generate | Generate supports | 產生支撐 (zh:19) | サポートを生成 (ja:18) | today |
| sup.regenerate | Regenerate | 重新產生 (zh:42) | 再生成 (ja:41) | today |
| sup.generate.hint | Place automatic supports on the selected objects, or on every object when none is selected | 為選取的物件自動配置支撐；沒有選取時套用到所有物件 (zh:304) | 選択したオブジェクトに自動でサポートを配置します。何も選択していないときはすべてのオブジェクトが対象です (ja:300) | today |
| sup.clearManual | Clear manual edits | 清除手動編輯 (zh:43) | 手動編集をクリア (ja:42) | today |
| sup.clearManual.hint | Remove manual supports and bring back removed automatic ones, at once. Undo brings the edits back | 立即移除手動支撐並恢復已移除的自動支撐。復原可找回這些編輯 (zh:316) | 手動サポートを削除し、削除した自動サポートをすぐに戻します。「元に戻す」で編集を復元できます (ja:312) | today |
| sup.remove | Remove supports | 移除支撐 (zh:44) | サポートを削除 (ja:43) | today |
| sup.remove.hint | Remove the supports of the selected objects. Models and manual edits are kept | 移除選取物件的支撐。模型與手動編輯會保留 (zh:317) | 選択したオブジェクトのサポートを削除します。モデルと手動編集は残ります (ja:313) | today |
| mode.title | Modes | 模式 | モード | **[new]** |
| mode.edit | Edit supports | 編輯支撐 (zh:35) | サポート編集 (ja:34) | today key, now the button label |
| mode.edit.hint | Add or remove supports by clicking | 點擊以新增或移除支撐 | クリックでサポートを追加・削除 | **[change]** drops "(Tab)" (zh:47, ja:46) |
| mode.exitEdit | Exit Support Edit Mode | 離開支撐編輯模式 (zh:37) | サポート編集モードを終了 (ja:36) | today |
| mode.exitEdit.hint | Finish editing supports (Esc) | 結束支撐編輯（Esc） | サポート編集を終了します（Esc） | **[change]** drops "or Tab" (zh:312, ja:308) |
| mode.zones | No-support zones | 免支撐區 (zh:276) | サポート禁止エリア (ja:272) | today key, now the button label |
| zones.state | Painted / None | 已塗刷 / 無 (zh:277, 160) | 塗装済み / なし (ja:273, 156) | today |
| mode.zones.hint | Paint areas of the model where automatic supports must not grow | 在模型上塗刷不要長出自動支撐的區域 (zh:314) | 自動サポートを付けたくないモデルの領域を塗ります (ja:310) | today |
| mode.exitZones | Exit no-support zones | 離開免支撐區 (zh:38) | サポート禁止エリアの塗装を終了 (ja:37) | today |
| mode.exitZones.hint | Finish painting zones (Esc or Enter) | 結束塗刷區域（Esc 或 Enter） (zh:324) | エリアの塗装を終了します（Esc または Enter） (ja:320) | today |
| sel.first | Select an object first. | 請先選取一個物件。 (zh:40) | 先にオブジェクトを選択してください。 (ja:39) | today |
| chk.title | Check supports | 檢查支撐 (zh:191) | サポートを確認 (ja:187) | today |
| chk.run | Check for unsupported spots | 檢查缺少支撐的地方 (zh:192) | サポートのない箇所を確認 (ja:188) | today |
| chk.help | Finds islands and overhangs no contact reaches, before you print. | 列印前找出接觸點覆蓋不到的孤島與懸空區域。 (zh:198) | 印刷前に、接触点が届かないアイランドとオーバーハングを見つけます。 (ja:194) | today |
| chk.kind | Island / Uncovered overhang | 孤島 / 未支撐的懸空 (zh:193, 194) | アイランド / サポートのないオーバーハング (ja:189, 190) | today |
| chk.inZone | in a no-support zone | 位於免支撐區 (zh:195) | サポート禁止エリア内 (ja:191) | today |
| chk.showMe | Show me | 查看位置 (zh:318) | 場所を表示 (ja:314) | today |
| chk.showMe.hint | Frame the camera on this spot | 把鏡頭對準這個位置 (zh:319) | この位置にカメラを合わせます (ja:315) | today |
| chk.fix | Fix | 修正 (zh:197) | 修正 (ja:193) | today |
| chk.fix.hint | Open Support Edit Mode on this object to add supports here | 在這個物件上開啟支撐編輯模式，於此處加支撐 (zh:320) | このオブジェクトでサポート編集モードを開き、ここにサポートを追加します (ja:316) | today |
| chk.more | and {n} more | 及另外 {n} 個 (zh:56) | ほか {n} 個 (ja:55) | today |
| lock.edit | Finish editing supports first: press Esc or Done. | 請先完成支撐編輯：按 Esc 或「完成」。 (zh:107) | 先にサポート編集を終了してください：Esc か「完了」を押します。 (ja:104) | today string, new use as lock note |
| lock.zones | Finish painting zones first: press Esc or Done. | 請先完成塗刷免支撐區：按 Esc 或「完成」。 (zh:293) | 先にエリアの塗装を終了してください：Esc か「完了」を押します。 (ja:289) | today string, new use as lock note |
| vp.view | View (group label) | 檢視 (zh:141) | 表示 (ja:137) | today |
| vp.tips | Tips only | 僅支撐頭 (zh:138) | 先端のみ (ja:134) | today |
| vp.tips.hint.off | Show only the contact tips: no pillars, braces or raft. Turns on by itself below the plate. Export stays full. | 只顯示接觸點的支撐頭：不顯示支撐柱、加強桿與底筏。鏡頭轉到底板下方時會自動開啟。匯出仍為完整支撐。 (zh:137) | 接触点の先端のみ表示：支柱・補強材・ラフトは非表示。プレートの下から見ると自動でオンになります。書き出しは常にフル。 (ja:133) | today |
| vp.tips.hint.on | Only contact tips show. Turns on by itself below the plate; click to switch off. Export stays full. | 目前只顯示接觸點的支撐頭。鏡頭轉到底板下方時會自動開啟；點一下即可關閉。匯出仍為完整支撐。 (zh:142) | 接触点の先端のみ表示中。プレートの下から見ると自動でオンになります。クリックでオフにできます。書き出しは常にフル。 (ja:138) | today |
| vp.tips.hint.forced | While painting no-support zones only the contact tips show, so the surface stays visible. | 塗刷免支撐區時只顯示接觸點的支撐頭，讓表面保持可見。 (zh:140) | サポート禁止エリアを塗る間は接触点の先端のみ表示し、表面が見えるようにします。 (ja:136) | today |
| vp.fit | Fit view | 符合視圖 (zh:135) | ビューに合わせる (ja:131) | today |
| vp.fit.hint | Frame the selection from the current angle | 以目前角度框住所選物件 (zh:136) | 現在の角度で選択をフレームに収める (ja:132) | today |
| vp.bottom | Bottom view | 底視圖 (zh:134) | 下面図 (ja:130) | today |
| vp.bottom.hint | Look straight up at the selection to check contact points | 從正下方往上看所選物件，檢查接觸點 (zh:143) | 選択したオブジェクトを真下から見上げて接触点を確認 (ja:139) | today |
| vp.nothing | Nothing selected | 未選取任何物件 (zh:46) | 未選択 (ja:45) | today |
| vp.note | Millimetres. Build plate at zero. | 單位為公釐，底板位於零點。 (zh:48) | 単位はミリ。ビルドプレートは高さ 0。 (ja:47) | today |
| vp.drop | Drop to import | 放開即可匯入 (zh:45) | ドロップして読み込む (ja:44) | today |
| job.title | Background work (region label) | 背景工作 (zh:430) | バックグラウンド処理 (ja:426) | today |
| job.cancel | Cancel | 取消 (zh:431) | キャンセル (ja:427) | today |
| job.dismiss | Dismiss | 關閉 (zh:432) | 閉じる (ja:428) | today |
| toast.undo.hint | Undo this action | 復原這個動作 (zh:336) | この操作を元に戻します (ja:332) | today |
| badge.edit | Support Edit Mode | 支撐編輯模式 (zh:49) | サポート編集モード (ja:48) | today |
| badge.add | Click the model to add supports | 點擊模型以新增支撐 (zh:210) | モデルをクリックしてサポートを追加 (ja:206) | today |
| badge.click | Click supports to select or unselect | 點選支撐以選取或取消選取 | サポートをクリックして選択・選択解除 | **[new]** replaces "Click supports to select" (zh:211, ja:207) |
| badge.drag | Drag over supports to select | 在支撐上拖曳以選取 (zh:212) | サポートをなぞって選択 (ja:208) | today |
| badge.dragUnselect | Drag over supports to unselect | 在支撐上拖曳以取消選取 | サポートをなぞって選択解除 | **[new]** (shown while Unselect is effective, switch or Shift) |
| edit.tool | Edit tool (group label) | 編輯工具 (zh:200) | 編集ツール (ja:196) | today |
| edit.add | Add supports | 新增支撐 (zh:201) | サポート追加 (ja:197) | today |
| edit.add.hint | Click the model to add a support; right-click or Ctrl+click a support to remove it | 點擊模型新增支撐；右鍵或 Ctrl+點擊支撐即可移除 (zh:325) | モデルをクリックでサポートを追加。サポートを右クリックまたは Ctrl+クリックで削除します (ja:321) | today |
| edit.select | Select supports | 選取支撐 (zh:202) | サポート選択 (ja:198) | today |
| edit.select.hint | Pick supports to delete several at once | 選取多個支撐，一次刪除 (zh:326) | 複数のサポートを選んで一度に削除します (ja:322) | today |
| rp.eraseRadius | Click reach (was Remove radius) | 點擊範圍 | クリック範囲 | today key, new label and placement **[change]**; zh:411, ja:407 retire |
| rp.eraseRadius.hint | How far from a support a right-click (or Ctrl+click in Add supports) may land and still pick it. Only that one support is removed | 右鍵點擊（或在「新增支撐」中按 Ctrl+點擊）離支撐多遠仍算選中。只會移除那一個支撐 | サポートからどれだけ離れて右クリック（「サポートを追加」では Ctrl+クリック）しても選べるかの距離です。削除されるのはそのサポートだけです | **[change]** (zh:412, ja:408 retire) |
| unit.mm | {n} mm | {n} mm (zh:208) | {n} mm (ja:204) | today |
| edit.how | How to select (group label) | 選取方式 (zh:203) | 選択方法 (ja:199) | today |
| edit.click | Click | 點選 (zh:50) | クリック (ja:49) | today |
| edit.click.hint | Click a support to select it; click it again to unselect | 點擊支撐即可選取，再點一次取消選取 | サポートをクリックで選択、もう一度クリックで選択解除 | **[new]** replaces "Click supports one at a time to select them" (zh:327, ja:323) |
| edit.dragOver | Drag over | 拖曳選取 (zh:204) | なぞって選択 (ja:200) | today |
| edit.dragOver.hint | Drag over supports to select many at once, starting anywhere in the view | 拖曳經過支撐，一次選取多個；可從檢視中任何位置開始 (zh:328) | サポートをなぞって、まとめて選択します。ビューのどこからでも始められます (ja:324) | today |
| edit.dragging | Dragging over supports (group label) | 拖曳經過支撐時 (zh:205) | サポートをなぞったとき (ja:201) | today |
| edit.dragSelect | Select | 選取 (zh:32) | 選択 (ja:31) | today |
| edit.dragSelect.hint | Dragging adds supports to the selection | 拖曳時把支撐加入選取 (zh:329) | なぞったサポートを選択に追加します (ja:325) | today |
| edit.dragUnselect | Unselect | 取消選取 (zh:206) | 選択解除 (ja:202) | today |
| edit.dragUnselect.hint | Dragging takes supports out of the selection | 拖曳時把支撐移出選取 (zh:330) | なぞったサポートを選択から外します (ja:326) | today |
| edit.shift | Hold Shift to unselect | 按住 Shift 可取消選取 | Shift を押している間は選択解除 | **[new]**; while Unselect is the switch value it reads "Hold Shift to select" / 按住 Shift 可選取 / Shift を押している間は選択 **[new]** |
| edit.circle | Circle size | 圓圈大小 (zh:207) | 円のサイズ (ja:203) | today |
| unit.px | {n} px | {n} px (zh:332) | {n} px (ja:328) | today |
| edit.circle.hint | Radius of the circle around the pointer, in screen pixels: supports it passes over are selected | 游標周圍圓圈的半徑（螢幕像素）：圓圈經過的支撐會被選取 (zh:331) | ポインター周りの円の半径（画面のピクセル）：円が通ったサポートが選択されます (ja:327) | today |
| kbd.rightClick | Right-click | 右鍵 (zh:51) | 右クリック (ja:50) | today |
| kbd.remove | remove | 移除 (zh:52) | 削除 (ja:51) | today |
| kbd.undo | undo | 復原 (zh:53) | 元に戻す (ja:52) | today |
| sel.count | {n} selected | 已選取的 {n} 個 (zh:20) | 選択中の {n} 個 (ja:19) | today |
| sel.clear | Clear selection | 清除選取 (zh:209) | 選択をクリア (ja:205) | today |
| sel.clear.hint | Unselect every support at once (Esc). Undo on the notice brings the selection back | 立即取消選取所有支撐（Esc）。按通知上的「復原」可找回選取 (zh:335) | すべてのサポートの選択をすぐに解除します（Esc）。通知の「元に戻す」で選択を復元できます (ja:331) | today |
| sel.delete.hint | Delete the selected supports (Delete key). Undo brings them back | 刪除選取的支撐（Delete 鍵）。復原可找回 (zh:334) | 選択したサポートを削除します（Delete キー）。「元に戻す」で復元できます (ja:330) | today |
| done | Done | 完成 (zh:54) | 完了 (ja:53) | today |
| edit.done.hint | Finish editing supports (Esc or Enter) | 結束支撐編輯（Esc 或 Enter） (zh:313) | サポート編集を終了します（Esc または Enter） (ja:309) | today |
| badge.zones | Painting no-support zones | 正在塗刷免支撐區 (zh:281) | サポート禁止エリアを塗装中 (ja:277) | today (frame and badge fill become red, 7.1) |
| zones.brush | Zone brush (group label) | 區域筆刷 (zh:282) | エリアブラシ (ja:278) | today |
| zones.paint | Paint | 塗刷 (zh:283) | 塗る (ja:279) | today |
| zones.paint.hint | Paint no-support zones on the model | 在模型上塗刷免支撐區 (zh:321) | モデルにサポート禁止エリアを塗ります (ja:317) | today |
| zones.erase | Erase | 擦除 (zh:284) | 消す (ja:280) | today |
| zones.erase.hint | Erase no-support zones from the model | 從模型上擦除免支撐區 (zh:322) | モデルからサポート禁止エリアを消します (ja:318) | today |
| zones.size | Brush size | 筆刷大小 (zh:285) | ブラシサイズ (ja:281) | today |
| zones.size.hint | Radius of the zone brush | 區域筆刷的半徑 (zh:323) | エリアブラシの半径 (ja:319) | today |
| zones.hidden | {n} supports hidden by zones | {n} 個支撐被免支撐區隱藏 | {n} 本のサポートがエリアにより非表示 | **[new]** |
| zones.note | Supports attach underneath: turn the view (Bottom view) to paint where they are. | 支撐多半接在下方：轉動檢視（底視圖）即可在支撐所在處塗刷。 (zh:139) | サポートは主に下側に付きます：ビューを回して（下面図）、サポートのある場所を塗ります。 (ja:135) | today |
| zones.clearAll | Clear all zones | 清除全部區域 (zh:286) | すべてのエリアを消去 (ja:282) | today |
| zones.clearAll.hint | Clear every no-support zone of this object at once. Undo brings them back | 立即清除此物件所有的免支撐區。復原可找回 (zh:315) | このオブジェクトのサポート禁止エリアをすべてすぐに消去します。「元に戻す」で復元できます (ja:311) | today |
| zones.done.hint | Finish painting zones (Esc or Enter) | 結束塗刷區域（Esc 或 Enter） (zh:324) | エリアの塗装を終了します（Esc または Enter） (ja:320) | today |

Strings retired by this document **[change]** (keys can be deleted once unused): the "(Tab)" and "or Tab" parts of the two mode hints, the old Click reach label and hint (zh:411, 412, ja:407, 408), "Enter Support Edit
Mode" (zh:36, ja:35), "Paint zones" (zh:278, ja:274), "Clear" (zh:279, ja:275; compact zones button),
"Add or remove supports by clicking the model. Tab toggles." (zh:39, ja:38), "Paint where supports
must not grow. Manual supports stay." (zh:280, ja:276), "Edit no-support zones →" (zh:287, ja:283),
"Switch to painting no-support zones; Done comes back here" (zh:333, ja:329), "Click supports to
select" (zh:211, ja:207), "Click supports one at a time to select them" (zh:327, ja:323). Glossary
`ZONE_TEXTS` must drop the retired zone strings.

### 6.3 Right panel (inventory, unchanged)

| en | zh-Hant | ja | Source |
|---|---|---|---|
| Support settings | 支撐設定 (zh:55) | サポート設定 (ja:54) | App.tsx:902 |
| and {n} more | 及另外 {n} 個 (zh:56) | ほか {n} 個 (ja:55) | App.tsx:902 |
| Select an object to edit its settings. Changes apply to every selected object. | 選取物件以編輯設定。變更會套用到所有選取的物件。 (zh:57) | オブジェクトを選択すると設定を編集できます。変更は選択中のすべてのオブジェクトに適用されます。 (ja:56) | App.tsx:903 |
| Preset · Light · Middle · Heavy · Custom | 預設組合 · 輕型 · 中型 · 重型 · 自訂 | プリセット · ライト · ミドル · ヘビー · カスタム | SettingsPanel.tsx:152, 174–177 |
| Lift height | 抬升高度 | リフト高さ | SettingsPanel.tsx:180 |
| Roof / cage · Off · Roof · Cage | 屋頂／保護籠 · 關閉 · 屋頂 · 保護籠 | ルーフ／ケージ · オフ · ルーフ · ケージ | SettingsPanel.tsx:153, 182–184 |
| Auto placement: Support spacing, Overhang angle, Downward faces, Islands, Reinforce overhang edges, Ridge angle, Tree supports | 自動配置：支撐間距、懸空角度、朝下的面、孤島、加強懸空邊緣、稜線角度、樹狀支撐 | 自動配置：サポート間隔、オーバーハング角度、下向きの面、アイランド、オーバーハングの縁を補強、稜線角度、ツリーサポート | SettingsPanel.tsx:42–49 |
| Tree supports: Merge distance, Branch descent, Section increment, Safe distance | 樹狀支撐：合併距離、分支下降距離、截面遞增、安全距離 | ツリーサポート：結合距離、枝の下降距離、断面の増分、安全距離 | SettingsPanel.tsx:53–57 |
| Contact tip: Contact shape (None / Sphere), Tip section (Round / Square / Cross), Plate width, Tip profile (Tapered / Straight), Point Ø, Contact Ø, Penetration, Contact depth, Upper Ø, Connection length, Connection angle | 接觸頭：接觸形狀（無／球形）、支撐頭截面（圓形／方形／十字）、板寬、支撐頭外形（漸細／直筒）、尖端直徑、接觸點直徑、嵌入深度、接觸深度、上段直徑、連接長度、連接角度 | 接触先端：接触形状（なし／球）、先端の断面（丸／角／十字）、板の幅、先端の形（テーパー／ストレート）、先端径、接触径、食い込み深さ、接触深さ、上部径、接続長さ、接続角度 | SettingsPanel.tsx:61–72 |
| Pillar: Middle Ø | 支撐柱：中段直徑 | 支柱：中部径 | SettingsPanel.tsx:75 |
| Foot: Bottom Ø, Bottom thickness | 底座：底部直徑、底部厚度 | 基部：下部径、下部の厚さ | SettingsPanel.tsx:77–79 |
| Bracing: Bracing, Bracing Ø, Bracing angle, Bracing spacing, Start height, Top spacing, Distance limit | 加強桿：加強桿、加強桿直徑、加強桿角度、加強桿間距、起始高度、頂部間距、距離上限 | 補強材：補強材、補強材の径、補強材の角度、補強材の間隔、開始高さ、上端の間隔、距離の上限 | SettingsPanel.tsx:83–90 |
| Raft: Raft, Expand width, Floor thickness, Wall height, Wall thickness, Wall angle, Voxel resolution | 底筏：底筏、外擴寬度、底板厚度、圍牆高度、圍牆厚度、圍牆角度、體素解析度 | ラフト：ラフト、拡張幅、床の厚さ、壁の高さ、壁の厚さ、壁の角度、ボクセル解像度 | SettingsPanel.tsx:94–101 |
| Roof: Gap above model, Column count, Column Ø, Cross bars, Cross bar Ø, Roof braces, Brace Ø, Brace angle, Roof thickness, Solid roof | 屋頂：與模型頂部間距、立柱數量、立柱直徑、交叉斜撐、交叉斜撐直徑、屋頂加強桿、加強桿直徑、加強桿角度、屋頂厚度、實心屋頂 | ルーフ：モデル上方の隙間、柱の本数、柱の径、筋交い、筋交いの径、ルーフの補強材、補強材の径、補強材の角度、ルーフの厚さ、閉じたルーフ | SettingsPanel.tsx:105–115 |
| Cage: Gap to model, Height above model, Ring spacing, Ring Ø, Column count, Column Ø, Cross bars, Cross bar Ø | 保護籠：與模型間距、高出模型的高度、橫環間距、橫環直徑、立柱數量、立柱直徑、交叉斜撐、交叉斜撐直徑 | ケージ：モデルとの隙間、モデル上方の高さ、リングの間隔、リングの径、柱の本数、柱の径、筋交い、筋交いの径 | SettingsPanel.tsx:119–127 |
| Letter label: Letter label, Letter (placeholder "auto (A)"), Letter size, Emboss height, Pad margin, Offset X, Offset Y | 字母標籤：字母標籤、字母（自動）、字母大小、浮雕高度、底墊邊距、X 偏移、Y 偏移 | 文字ラベル：文字ラベル、文字（自動）、文字サイズ、浮き出し高さ、台座の余白、X オフセット、Y オフセット | SettingsPanel.tsx:131–138 |
| Advanced: Preview mode (Full / Only tip), Low poly mode, Resolution, Auto snap, Click reach (was Remove radius) | 進階：預覽模式（完整／僅支撐頭）、低面數模式、解析度、自動吸附、點擊範圍 | 詳細：プレビューモード（フル／先端のみ）、ローポリモード、解像度、自動スナップ、クリック範囲 | SettingsPanel.tsx:142–147, 203 |
| Export STL | 匯出 STL (zh:58) | STL を書き出す (ja:57) | App.tsx:913 |
| Active object with model · Active object, supports only · Each object with model · Each object, supports only · Whole plate in one file | 目前物件（含模型）· 目前物件（僅支撐）· 每個物件（含模型）· 每個物件（僅支撐）· 整個底板匯出為單一檔案 (zh:59–63) | アクティブなオブジェクト（モデル付き）· アクティブなオブジェクト（サポートのみ）· オブジェクトごと（モデル付き）· オブジェクトごと（サポートのみ）· プレート全体を 1 ファイルに (ja:58–62) | App.tsx:73–79 |
| Exports match the viewport at full resolution. Source models are never changed. | 匯出內容與檢視畫面一致並使用完整解析度。原始模型不會被修改。 (zh:64) | 書き出しはビューと同じ内容をフル解像度で出力します。元のモデルは変更されません。 (ja:63) | App.tsx:915 |

Field hints (one per field) are unchanged and live next to each field in SettingsPanel.tsx:43–147
(group hints at 173, 181; preset / roof hints at 155–160).

### 6.4 Footer, status line and badge per state

| State | Badge (viewport) | Status line on entry / change | zh-Hant | ja |
|---|---|---|---|---|
| setup | — (object name) | Drop STL, GLB or glTF files to begin. Every mesh becomes an object. (start) | 拖放 STL、GLB 或 glTF 檔案即可開始。每個網格都會成為一個物件。 (zh:87) | STL・GLB・glTF ファイルをドロップして開始します。メッシュごとにオブジェクトになります。 (ja:84) |
| edit / add | Support Edit Mode · {object} · Click the model to add supports | Support Edit Mode: click the model to add, right-click a support to remove. | 支撐編輯模式：點擊模型新增，右鍵點擊支撐移除。 (zh:104) | サポート編集モード：モデルをクリックで追加、サポートを右クリックで削除。 (ja:101) |
| edit / select / click | … · Click supports to select or unselect **[new]** | Support Edit Mode: click supports to select them, right-click a support to remove. | 支撐編輯模式：點擊支撐即可選取，右鍵點擊支撐移除。 (zh:105) | サポート編集モード：サポートをクリックで選択、サポートを右クリックで削除。 (ja:102) |
| edit / select / dragOver | … · Drag over supports to select / to unselect **[new]** | Support Edit Mode: drag the circle over supports to select them. Supports hidden behind the model are skipped. | 支撐編輯模式：拖曳圓圈經過支撐即可選取。被模型擋住的支撐不會選到。 (zh:106) | サポート編集モード：円をサポートの上でなぞって選択。モデルに隠れたサポートは選ばれません。 (ja:103) |
| zones | Painting no-support zones · {object} · {n} supports hidden by zones **[new]** | Paint where supports must not grow; drag on the model. | 在不要長出支撐的地方塗刷：在模型上拖曳。 (zh:288) | サポートを付けたくない場所を塗ります：モデル上をドラッグします。 (ja:284) |
| edit → setup | — | Support edits kept. | 已保留支撐編輯。 (zh:102) | サポートの編集を保持しました。 (ja:99) |
| zones → setup | — | No-support zones kept. | 已保留免支撐區。 (zh:291) | サポート禁止エリアを保持しました。 (ja:287) |
| edit, object has no supports yet | as edit / add | No supports on {object} yet. Click the model to add one, or exit and Generate. **[new]** | {object} 還沒有支撐。點擊模型新增，或離開後按「產生支撐」。 | {object} にサポートはまだありません。モデルをクリックで追加するか、終了して生成してください。 |
| refused entry, no object | — | Select an object to edit its supports. / Select an object first. | 請選取一個物件來編輯它的支撐。 (zh:103) / 請先選取一個物件。 (zh:40) | サポートを編集するオブジェクトを選択してください。 (ja:100) / 先にオブジェクトを選択してください。 (ja:39) |
| refused entry, heavy | — | Too detailed to edit by hand ({n} triangles). Generate and export still use the full model. | 模型過於精細，無法手動編輯（{n} 個三角面）。產生與匯出仍使用完整模型。 (zh:443) | モデルが細かすぎるため手動では編集できません（三角形 {n} 個）。生成と書き出しは完全なモデルで行われます。 (ja:439) |

Footer counts: "1 object / {n} objects" (zh:65, 66; ja:64, 65), "{n} triangles" (zh:67, ja:66),
"{auto} automatic, {manual} manual, {removed} removed" (zh:68, ja:67). Other status lines (import,
placement, check, export, errors) are unchanged: `src/editing/status.ts`, `src/editing/errors.ts`,
App.tsx handlers.

---

## 7. Visual rules (mixo-app-style)

### 7.1 Colours by role

| Role | Token / value | Used for |
|---|---|---|
| Primary | `--red #7f0019`, hover `--red-hover #96102b`, white text | Generate (setup), Done (edit and zones). One per view. |
| Primary, Regenerate | `--blue #1d3461`, hover `#284579` (app token, owner's call) | Generate once every object in scope has supports. |
| Pressed / chosen | ink fill `--ink #3b3631`, paper text | Segment chosen, Tips only on, left-panel Exit buttons, tool buttons. |
| Destructive | `--danger #b3261e` outline + text, transparent fill; hover sunken | Delete (objects, supports), Remove supports, Clear manual edits, Clear all zones. Never filled. |
| Secondary | surface `#fbfaf7`, 1 px `--line #dcd7cd`, hover `--line-strong` + white | Everything else. |
| Surfaces | paper `#f4f2ed`, surface `#fbfaf7`, sunken `#ebe8e1`, viewport `#e9e6df` | App and panels, raised controls, hover and group heading bands. |
| Text | ink `#3b3631`, muted `#8a847a` | Body; captions, counts, units, help lines. |
| Mode chrome (both modes) | frame 1 px `--red`; badge fill `--red`, text surface | Support Edit Mode and No-support zones. mixo-app-style gives every tool mode a red hairline frame; the badge text tells the modes apart, and blue stays the zone layer on the model **[change, confirm]**. |
| Altered-support mark | a ring around the tip marker (shape cue, readable in grey scale), never a new hue | Supports with an override, Support Edit Mode only (11.2 rule 7). |
| 3D marks | behaviour spec §6 (selected supports `#a8243c`, preview `#7f0019` @ 0.45, zone layer `#1d3461` @ 0.7 / 0.3, check markers `#b3261e` / `#d97706`) | Content, not UI accent. |
| Drag over circle | Select: 1.5 px `--red` border, red 8 % fill; Unselect: 1.5 px `--ink` border, ink 8 % fill, plus a "−" badge at the cursor **[new]** | Instant feedback when Shift flips the action. |

### 7.2 Focus-mode dimming (locked regions)

| Property | Value | Why |
|---|---|---|
| `inert` | on each locked section (not on the panel when it holds the live Exit button) | Removes the subtree from tab order, pointer hits and the accessibility tree in one attribute. |
| `opacity` | `.45` on locked sections | Clearly weaker than a disabled button (`.55`), still readable to orient. |
| `transition` | `opacity var(--dur)` (0.15 s); none under `prefers-reduced-motion` | Matches the house duration. |
| `pointer-events` | implied by `inert`; the required click catcher is a transparent `div` with `aria-hidden="true"` | A click on a locked area repeats the lock note in the status line and pulses the note. |
| `aria-disabled` | not used for locked regions (only for Tips only while forced, today) | `inert` already hides them; `aria-disabled` is for a focusable control that explains itself. |
| Lock note | full opacity, `--fs-sm`/11.5 px muted ink, sticky at the panel top, not inert | Says why and how out. |
| Exit button in a locked left panel | full opacity, pressed (ink fill, paper text), never red | Red stays Done alone. |
| Cursor | default over locked regions (no `not-allowed` wall) | `inert` content takes no hover anyway. |

### 7.3 Viewport chrome

- Frame: `position: absolute; inset: 0; border: 1px solid var(--red)`; `pointer-events: none` (both modes).
- Badge: top-left, same height and text size as the bar buttons (13 px, 8 × 12 px padding), red
  fill, `role="status"`; parts: mode name, object name (80 % opacity), what a click does (500).
- Bar: surface background, 1 px `--line-strong`, 2 px radius, no shadow, rows right-aligned:
  row 1 tool, row 2 tool options (stacked under their parent button where the parent owns them),
  row 3 key hints, row 4 actions + Done. Done is always last and right-most.
- Tool choice buttons (Click | Drag over): 40 px tall, 19 px icon, 13 px / 500 text, ink when pressed
  (behaviour spec §7).
- Hit areas ≥ 24 px (sliders 24 px; buttons ≥ 28 px); 40 px on coarse pointers.

### 7.4 Typography and density

Today the app runs a roomier density than `tokens.css` (header 56 px vs 32, panels 268 / 300 vs
220 / 240, buttons 13 px vs 11.5). The brush-up keeps today's sizes (they are what the 1366 × 768
wireframes assume); moving to the Dense tokens is a separate decision.

### 7.5 Group headings

`.panel h3`: ink, 700, tracked .06em, on a sunken band (today). The Modes group uses the same band.

### 7.6 Fit in three languages

The longest labels at 268 px panel width: "Exit no-support zones" ja サポート禁止エリアの塗装を終了 (one
line, full-width button, today), "Check for unsupported spots" ja サポートのない箇所を確認. The edit bar
at 1366 px keeps its rows; the new Select / Unselect + Circle size row and "Hold Shift to unselect"
must be measured in ja before merge.

---

## 8. Accessibility and keyboard

### 8.1 Focus order

Header (language, Undo, Redo, Hide models, Wireframe) → left panel (Import, objects, Select all,
Delete, Transform, Generate, Clear manual edits, Remove supports, Edit supports, No-support zones,
Check, findings) → viewport (view toggles; in a mode: the bar in reading order tool → options →
actions → Done; job list; toast) → right panel → footer has no focusable controls.

### 8.2 Mode entry and exit

- Entering a mode moves focus to the bar's pressed tool button (Add supports / Paint), so a keyboard
  user lands where the next action is; the status line announces the tool line.
- Exiting returns focus to the left Modes button that entered (now reading its entry label again).
- Tab is not a mode key any more **[change]**: `keys.ts:53` calls `preventDefault` on every Tab, which breaks
  focus navigation. Tab and Shift+Tab move focus as the browser does, within live regions only, since
  locked sections are inert.

### 8.3 Inert panels

- Locked sections carry `inert`; screen readers skip them. The lock note is outside the inert
  subtree and readable.
- The live Exit button keeps `aria-pressed="true"` and its hint as `aria-description`.
- Tips only while forced: focusable, `aria-pressed="true"`, `aria-disabled="true"`, hint says why
  (today).

### 8.4 Live regions

| Region | Role | Announces |
|---|---|---|
| Footer status line | `role="status"`, `aria-live="polite"` | Every step result and error (today). |
| Mode badge | `role="status"` | Mode, object and tool wording when it changes (today). |
| Undo toast region | `role="status"`, `aria-live="polite"`, always present | "… cleared · Undo" (today). |
| Job activity | visually hidden polite region | Each job once, each failure once (today). |

### 8.5 Keyboard summary

Key table: behaviour spec §2, plus Shift held in Drag over (5.8). Every key path has a visible
control (P7). Keys typed into text and number fields are ignored by the app (today).

### 8.6 Keyboard rules revised

- Tab is never captured (8.2).
- Esc inside any input, slider, select or textarea only affects that control (revert, blur,
  commit); it never reaches the mode (4.3).
- Range and checkbox inputs do not swallow Delete and Esc: today every INPUT is exempt from the
  editor's keys (keys.ts:47), and a range keeps focus after pointerup (RangeField.tsx:24), so
  Delete and Esc do nothing until the user clicks elsewhere. Exempt only fields that take typed text
  (text, number, search, email, textarea); `KeyTarget` gains `type`. Blur a range after pointerup as well.

---

## 9. What changes vs today, and the Babylon port

### 9.1 Diff list

| # | Change | Code today | Effort |
|---|---|---|---|
| D1 | Left panel order: Import, Objects, Transform, Supports, Modes, Check | App.tsx:815–850 | small |
| D2 | One group "Modes" with two buttons; labels "Edit supports" / "No-support zones"; Exit labels kept; Painted / None as muted state word | ModeEntry.tsx:13–36, modeButtons.ts:17–28 | small |
| D3 | Remove left-panel zones "Clear" | ModeEntry.tsx:32 | small |
| D4 | Remove "Edit no-support zones →"; delete `zonesReturn`, `openZones.from` | EditBar.tsx:66, session.ts:12–13, 56–57, 97–99; modeButtons.ts:28 | small |
| D5 | Remove the viewport "Edit supports" button; view toggles to top 12 px outside a mode | ModeEntry.tsx:39–45, App.tsx:895, styles.css:215–228 | small |
| D6 | Remove the header Generate **[confirm]** | App.tsx:811 | small |
| D7 | Region lock: edit → left locked except Exit; zones → both panels locked except left Exit; lock notes; inert; dimming | new (App.tsx shell + styles) | medium |
| D8 | Refuse file drops in a mode **[confirm]** | App.tsx:779–783, 497 | small |
| D9 | Add tool: Click reach number field (was Click reach) bound to `eraseRadius` | EditBar.tsx (new row), SettingsPanel.tsx:147 kept | small |
| D10 | Select tool: Select / Unselect switch moves directly under Drag over next to Circle size; Shift held flips it; circle and cursor badge follow; badge text per effective action | EditBar.tsx:44–60, CirclePreview.tsx, useScreenBrush.ts, styles.css:538–544 | medium |
| D11 | Click method copy: badge and hint say click toggles; the Shift+click clause is dropped (pick.ts:57 already toggles regardless of modifiers) | EditBar.tsx:15, 45; pick.ts:57 | small |
| D12 | Fix button secondary; Delete objects, Remove supports, Clear manual edits `.danger` | ProblemList.tsx:24, ObjectList.tsx:39, App.tsx:841–842 | small |
| D13 | Command registry + UI state machine as framework-free modules; components render from them | new `src/editing/commands.ts`, `uiMachine.ts` | large |
| D14 | Retire strings (6.2), add new strings (6.2, 11.7), update glossary `ZONE_TEXTS` | locales, glossary.ts:134–140 | small |
| D15 | Behaviour spec §1, §7 and ui-spec heuristics rows 3, 4 updated to the sibling modes | docs | small |
| D16 | Per-support settings and context-sensitive right panel **[feature]**; needs D17, D18 first | section 11.1 to 11.8 | large |
| D17 | Right-click is an exact deletion; retire `suppressed` with a one-time migration; Click reach is a pick tolerance | placement.ts:130-179, App.tsx:617-632, placement.test.ts:159 | medium |
| D18 | Remap automatic ids to unit-local once; drop runtime fuzzy matching | unitSupports.ts:169-193, placement.ts:162-178, jobRunner.ts:87 | medium |
| D19 | Keyboard: Tab no longer toggles a mode; Esc in an input only affects it; range and checkbox do not swallow Delete / Esc | keys.ts:47, 53; RangeField.tsx:24 | small |
| D20 | Zones frame and badge red (mixo-app-style); zones badge shows hidden count; locked-region click feedback required; header lock limited to scene commands; Clear all zones once, with Undo toast; settings edits coalesce | styles.css:215-228, App.tsx:557-559 | medium |

Unchanged: right panel layout and fields, Export STL placement, key and pick tables except the rows
above, stroke behaviour, 3D colours, camera numbers, job list, Undo toasts, number-field rules.

### 9.2 Babylon port (mixomesh)

- **Framework-free core.** `uiMachine.ts` (state + reducer), `commands.ts` (registry records with
  pure `visible` / `enabled` / `pressed` and `run` returning an event or a scene command),
  `status.ts`, `keys.ts`, `pick.ts`, `selection.ts` import neither React nor three.js (the existing
  `core/imports.test.ts` rule extends to the new files).
- **Renderers.** React renders panels and bars from the registry today; mixomesh renders the same
  records with its own DOM panels or Babylon GUI. A renderer maps `surface` to a container and `role`
  to a class (`primary`, `danger`, pressed); it never contains a visibility rule.
- **Lock.** The renderer applies 4.4 per surface (`inert` + `.45` in DOM; in Babylon GUI,
  `isEnabled = false` + alpha `.45` on the panel containers, Exit kept enabled).
- **Pointer.** Shift state comes from the pointer event (`shiftKey`) on each move, so the effective
  drag action is known per stroke step without a global key listener.
- **Parity tests.** Port the registry table (section 5) as a data test: for each state in a fixed
  list, the set of visible and enabled command ids must match in both apps.

---

## 10. Stitch

### 10.1 How this maps to Stitch

Stitch reads a design system from `DESIGN.md` at the repository root or `.stitch/DESIGN.md`
(six sections: visual theme, colours and roles, typography, components, layout, generation notes)
and uploads it with `stitch upload design DESIGN.md`. The root `DESIGN.md` in this repository is that
file, short and token-only, pointing here for structure. A pointer-only file would become the
project's design system, so the root file carries real tokens. Screen prompts below follow the
Stitch prompt shape (purpose, platform, numbered sections) and leave hex codes out, because a bound
design system governs styling; a tokens line is appended only when no design system is bound.

Workflow (owner approval first for binding and batch upload): `stitch status --flow=design --json`
→ owner confirms project → `stitch config set project <id>` → `stitch upload design DESIGN.md` →
`stitch generate screen --device DESKTOP --title "<title>" --prompt "<prompt>" --json` per screen.

### 10.2 Screen prompts

**S1 — Setup (no mode)**

```text
Dense desktop editor for preparing resin 3D prints with support structures, for lay hobby printers. Flat, paper-like, hairline borders, no shadows, 2 px corners, one dark-red primary button per view.

PLATFORM: Web, desktop 1366 × 768.

PAGE STRUCTURE:
1. Header (56 px): wordmark "MIXO SUPPORTS" and caption "Resin Support Studio" on the left; on the right a three-segment language switch "EN | 中文 | 日本語", a button pair "Undo" "Redo", a divider, then "Hide models" and "Wireframe".
2. Left panel (268 px), sections each under a bold heading on a light grey band:
   - "Import models": dashed drop area with "Import models" and the caption "STL, GLB or glTF. Files stay on this device."
   - "Objects  3": three compact rows (letter badge, file name, support count); row A active with a small dark-red letter badge; buttons "Select all" and "Delete" (red outline).
   - "Transform": segmented "Select | Move | Rotate", Move chosen (dark fill).
   - "Supports for all 3": full-width primary "Generate supports", then "Clear manual edits" and "Remove supports" (both red outline).
   - "Modes": two full-width buttons "Edit supports" and "No-support zones" (muted word "None" at its right end).
   - "Check supports": button "Check for unsupported spots", a list of two findings (dot, "Island" / "Uncovered overhang", object name, buttons "Show me" and "Fix").
3. Viewport (centre, light warm grey): a 3D model on a gridded build plate with thin supports under it; object name "bust.stl" top left; three small word buttons "Tips only", "Fit view", "Bottom view" top right; caption "Millimetres. Build plate at zero." bottom right.
4. Right panel (300 px): title "Support settings  bust"; segmented "Preset: Light | Middle | Heavy | Custom"; number field "Lift height 5.0 mm"; segmented "Roof / cage: Off | Roof | Cage"; collapsible groups with left chevrons "Auto placement" (open, four fields), "Contact tip" (open), "Pillar", "Foot", "Bracing", "Raft", "Letter label", "Advanced"; section "Export STL" with five stacked buttons.
5. Footer (32 px): "3 objects", "412,330 triangles", "396 automatic, 16 manual, 2 removed", and a status message right-aligned.
```

**S2 — Support Edit Mode, Add tool**

```text
Same editor as S1 in Support Edit Mode for one object.

PAGE STRUCTURE:
1. Header: unchanged from S1.
2. Left panel: all sections faded to 45 % and not interactive, with a short note at the top "Finish editing supports first: press Esc or Done." In the "Modes" group the first button reads "Exit Support Edit Mode", shown pressed (dark fill, light text) and at full strength; "No-support zones" faded.
3. Viewport: a thin dark-red 1 px frame around the whole viewport; top-left a dark-red badge "SUPPORT EDIT MODE  bust.stl  Click the model to add supports"; top-right a light tool bar with hairline border: row 1 segmented "Add supports | Select supports" (Add chosen); row 2 a small number field "Click reach 1.5 mm"; row 3 key hints "Right-click / Ctrl+Click remove", "Ctrl+Z undo"; row 4 a dark-red primary "Done  Esc". View buttons "Tips only", "Fit view", "Bottom view" move to the bottom right. A translucent ghost support tip follows the cursor on the model.
4. Right panel: unchanged from S1 and fully usable.
5. Footer: status "Support Edit Mode: click the model to add, right-click a support to remove."
```

**S3 — Support Edit Mode, Select → Drag over with a selection**

```text
Same as S2 with the Select tool.

PAGE STRUCTURE:
1. Header and left panel: as S2.
2. Viewport: dark-red frame; badge "SUPPORT EDIT MODE  bust.stl  Drag over supports to select". Tool bar: row 1 "Add supports | Select supports" (Select chosen); row 2 label "How to select" and two large icon buttons "Click" (arrow icon) and "Drag over" (brush icon, chosen); directly under "Drag over" a small segmented "Select | Unselect" (Select chosen) beside a slider "Circle size 24 px", and a muted hint "Hold Shift to unselect"; row 3 "Right-click remove", "Ctrl+Z undo"; row 4 muted "37 selected", button "Clear selection", red-outline "Delete", dark-red primary "Done  Esc". On the model, selected supports are solid dark red; a thin red circle (8 % red fill) follows the pointer.
3. Right panel: title "Support settings  bust", a band "Settings for 37 selected" with a small "Reset to defaults" button and the line "Changes apply to the selected supports only."; object-wide fields (Preset, Lift height, Roof / cage, Auto placement, Tree supports, Bracing, Raft, Letter label, Advanced) faded; "Contact tip", "Pillar" and "Foot" open and usable, one field showing "—" for mixed values; "Export STL" usable.
4. Footer: status "Support Edit Mode: drag the circle over supports to select them. Supports hidden behind the model are skipped."
```

**S4 — No-support zones (focus mode)**

```text
Same editor in No-support zones mode, a focus mode.

PAGE STRUCTURE:
1. Header: unchanged.
2. Left panel: faded to 45 % with the note "Finish painting zones first: press Esc or Done." at the top; only the button "Exit no-support zones" (pressed, dark fill) is at full strength.
3. Right panel: entirely faded to 45 % with the same note at the top; nothing usable.
4. Viewport: thin dark-red 1 px frame; top-left a dark-red badge "PAINTING NO-SUPPORT ZONES  bust.stl  12 supports hidden by zones"; top-right tool bar: row 1 segmented "Paint | Erase" (Paint chosen) and a slider "Brush size 2.0 mm"; row 2 muted note "Supports attach underneath: turn the view (Bottom view) to paint where they are."; row 3 "Ctrl+Z undo", red-outline "Clear all zones", dark-red primary "Done  Esc". The model shows a translucent deep-navy painted patch; only the small support tips are drawn. Bottom right "Tips only" shown pressed, then "Fit view", "Bottom view".
5. Footer: status "Paint where supports must not grow; drag on the model."
```

Tokens line to append only when no design system is bound:
`Colours: paper #f4f2ed, surface #fbfaf7, sunken #ebe8e1, lines #dcd7cd / #c4bdb0, ink #3b3631, muted #8a847a, primary dark red #7f0019, zones deep navy #1d3461, destructive outline #b3261e. Font Zen Kaku Gothic New (zh-Hant: PingFang TC / Noto Sans TC). 2 px radius, no shadows, 1 px hairlines.`

### 10.3 What must not be uploaded

- No project data: no STL / GLB / glTF files, no scene or settings JSON, no customer or owner models,
  no screenshots that show a real model (use the generic placeholder model of the prompts).
- No code, no `src/`, no locales files, no keys or tokens (`~/.config/gemini/api_key` and the like).
- UI only: `DESIGN.md`, generated or captured UI screens with placeholder content.
- Ask the owner before binding a Stitch project (`stitch config set project`) and before any batch
  upload (Stitch skill rule).

---

## 11. Prerequisite bugs, then the feature: context-sensitive right panel and per-support settings

**Status: 11.0 is built first; the feature (11.1 to 11.8) follows the layout work and needs
per-support override data in `PrintUnit` and `SupportJob`.** Owner and controller ruling of
2026-10-22, revised the same day after a four-model review and coordinator rulings (the earlier
"added supports freeze their settings" rule is dropped).

### 11.0 Prerequisite bugs (fix before any per-support work)

Both are confirmed in code at `acd3f98`. Per-support settings hang on the identity of a support,
and today that identity is unreliable.

**(a) Right-click removal is radius-based and also erases manual supports added later.**

- Today: right-click calls `eraseNear`, which removes every contact within `eraseRadius` of the
  pick (App.tsx:624-632). An automatic contact becomes a `suppression/add` marker (App.tsx:617-621).
  `compose` then hides every contact within the radius of a marker, **manual contacts included**
  (placement.ts:139-179, the `manual.filter` at 179), and the test asserts it
  (placement.test.ts:159). So a support added at a removed spot vanishes while the status says
  "Support added." (App.tsx:613), and changing Click reach rewrites past removals.
- Fix: right-click is an exact deletion of the one hit support (the nearest contact within the pick
  tolerance; `manual/remove` for a manual one, a `deleted` id for an automatic one). `suppressed` is
  retired: `suppression/add` is no longer dispatched, and a one-time project migration turns each
  marker into the exact `deleted` ids of the automatic contacts it hides under the unit's saved
  radius, then empties `suppressed`. Manual supports that the old rule was hiding become visible
  again; the migration says so once ("{n} supports hidden by an old removal are back"). Click reach
  becomes the pick tolerance, renamed Click reach (3.3). `compose` loses the marker and radius
  branches; test 159 becomes "a manual support added at a removed spot stays".

**(b) Automatic ids encode turned-frame positions, but stored positions are unit-local.**

- Today: placement runs on the turned model (jobRunner.ts:87) and names each contact
  `auto-x_y_z` from that frame (placement.ts:183). `placementCommands` maps `position` and `normal`
  back to unit-local space but keeps the id (`...point`, unitSupports.ts:169-193). `compose`
  compares `positionFromId(id)` with unit-local positions (placement.ts:141, 166). On a rotated
  object the two frames differ, so radius matching and the nearest-deleted fuzzy match compare
  different frames. Not yet reproduced in the browser: do that first.
- Fix: in `placementCommands`, rewrite each id once from the unit-local position (same grammar) and
  store it exact. Drop the runtime fuzzy matching (the nearest-deleted loop, placement.ts:162-178):
  a stored id either names a contact or is stale. Old projects: `deleted` ids are remapped with the
  orientation of the last placement where it is stored, otherwise dropped and counted in the
  one-time notice. Test on a unit rotated 90 degrees.

Exact, unit-local ids are the key that overrides (11.4) and the Regenerate report (11.2 rule 8) use.

### 11.1 Today (verified)

- One settings object per object: `PrintUnit.settings` (state/project.ts:29). A settings change
  writes `settings/set` to every target object (selected objects, else all) (App.tsx:521-525,
  515-519); placement keys schedule a regeneration (App.tsx:65-67, 432-440, 528).
- Every support of an object, automatic and manual, is built from that one object: `supportJobOf`
  passes `settings: resolveSettings(unit.settings)` and all contacts (`manual` included) in one job
  (unitSupports.ts:109-119, 74-76; `SupportJob.settings` core/jobs.ts:39). A manual contact stores
  only id, region, position, normal, source (core/analysis/types.ts:13-19).
- **So today: changing any right-panel value rebuilds every support of the object, manual supports
  included, from the object's settings.** Bracing is built across all columns of the object at once
  (core/supports/mesh.ts:225, `trussSegments` 456-480, which also reads `pillarDiameter`).
- The Check job reads only contact positions, the overhang angle and the spacing
  (`checkJobOf`, unitSupports.ts:127-136), so it needs no per-support settings.

### 11.2 Rules

1. **One rule.** A support follows the object defaults unless the user explicitly edited it. Adding a
   support creates no override (any freeze-at-add idea is dropped). Editing a field on selected
   supports creates an override for that field.
2. **Sparse overrides.** Stored as a `Partial` of the shape keys, only the keys the user set.
   "Reset to defaults" drops the override. A later change of a default reaches every support that has
   no override for that key.
3. **Overridable keys** are the tip, contact, neck and foot shape keys: contact shape, tip section,
   plate width (Cross), tip profile, point Ø, contact Ø, penetration, contact depth, upper Ø,
   connection length, connection angle, bottom Ø, bottom thickness. **Pillar thickness stays
   object-wide** (trees, braces and raft share it).
4. **Tree merges.** A support with an override stays out of tree merges.
5. **Right panel header, live in every mode.** It always shows how far the defaults reach, for
   example **"Applies to 140 of 150 supports · 10 customised [Select them]"** (objects in scope: the
   selected objects, else the active one). With supports selected in Support Edit Mode it reads
   **"Settings for {n} selected"**, the number customised among them, and **Reset to defaults**.
   Changes then apply to the selected supports only, all get the same value, and a field whose values
   differ shows a dash placeholder until set. **Select them** selects the
   customised supports of the active object; outside Support Edit Mode it enters the mode first **[confirm]**.
6. **Object-wide settings are disabled while supports are selected**, with a hint why: Preset, Lift
   height, Roof / cage, Auto placement, Tree supports, **Pillar** (middle Ø is shared), **Bracing**
   (object-wide in code: braces join neighbouring pillars, mesh.ts:225), Raft, Roof, Cage, Letter
   label, Advanced (preview mode, low poly, resolution, auto snap, Click reach).
7. **The altered mark is a shape cue, not a hue.** In Support Edit Mode a support with an override
   gets a small ring around its tip marker, visible in grey scale. Red stays "selected" and blue
   stays "no-support zone" (mixo-app-style: one meaning per colour).
8. **Regenerate never hides what it did to hand work.** After Regenerate the status line and an Undo
   toast say **"{n} customised kept, {m} reset"**. Kept: the override's contact id still names a
   contact. Reset: the id is gone, so the override is dropped (and counted). Nothing stays stored for
   an id that names no support. The same count covers exact removals whose id is gone.
9. **Export and project file carry overrides; Check does not need them.** Parity requirement: the
   preview and the export are built from the same contacts and the same overrides (`supportJobOf`
   differs between `'preview'` and `'export'` only in resolution). A data test builds both jobs for
   a unit with overrides and compares `contacts` and the resolved per-contact shapes.
10. **Locks.** Support Edit Mode: left panel locked, right panel live. Zones mode: both panels
    locked (4.4).
11. **One undo step per committed value** (11.5).

### 11.3 Wireframes (right panel, 300 px)

```text
+-------------------------+   +-------------------------+
|A: nothing selected      |   |B: Edit, 37 selected     |
|SUPPORT SETTINGS  bust   |   |SUPPORT SETTINGS  bust   |
|Applies to 140 of 150    |   |Settings for 37 selected |
|supports . 10 customised |   |9 customised             |
|[Select them]            |   |[Reset to defaults]      |
|Preset [Lt|=Md=|Hv|Cu]   |   |Changes apply to the     |
|Lift height    5.0 mm    |   |selected supports only.  |
|Roof/cage [=Off=|Rf|Cg]  |   |░Preset [Lt|Md|Hv|Cu]    |
|v Auto placement         |   |░Lift height    5.0 mm   |
|  Support spacing  3.0   |   |░Roof/cage [Off|Rf|Cg]   |
|  Overhang angle   50    |   |░> Auto placement        |
|  [x] Downward faces     |   |░> Tree supports         |
|  [x] Islands            |   |v Contact tip            |
|v Contact tip            |   |  Shape [None|Sphere]    |
|  Shape [=None=|Sphere]  |   |  Point dia.   --  mm    |
|  Point dia.  0.40 mm    |   |  Penetration 0.30 mm    |
|> Pillar                 |   |░> Pillar                |
|> Foot                   |   |v Foot                   |
|> Bracing                |   |  Bottom dia. 3.00 mm    |
|> Raft                   |   |░> Bracing               |
|> Letter label           |   |░> Raft                  |
|> Advanced               |   |░> Letter label          |
|EXPORT STL               |   |░> Advanced              |
|[Active obj + model ]    |   |EXPORT STL               |
|[Active, supports   ]    |   |[Active obj + model ]    |
|[Each obj + model   ]    |   |[Active, supports   ]    |
|[Each, supports     ]    |   |[Each obj + model   ]    |
|[Whole plate, 1 file]    |   |[Each, supports     ]    |
|                         |   |[Whole plate, 1 file]    |
+-------------------------+   +-------------------------+
```

Notes: the header band is the first row under the title in both states and never scrolls away
(sticky). In B, disabled groups stay visible (faded, closed) so the panel does not jump; each carries
the hint "Applies to the whole object. Clear the selection to change it." Export stays live. Reset to
defaults lives in the header band (it acts on the selection, so it lives with the selection's
settings, not in the edit bar); it is disabled with a reason when none of the selected supports is
customised. "Adjust" from the owner's earlier list is this panel, not a button. Outside Support Edit
Mode the band shows state A with the count, so the user learns at once that some supports are not
following the defaults.

### 11.4 Data shape (proposal)

```ts
/** The settings one support may own (11.2 rule 3). Pillar thickness is not here. */
type SupportShapeKey =
  | 'contactShape' | 'tipSection' | 'tipCrossWidth' | 'tipProfile'
  | 'pointDiameter' | 'touchDiameter' | 'pointDepth' | 'touchDepth' | 'neckDiameter'
  | 'neckLength' | 'maxNeckAngle' | 'baseDiameter' | 'baseHeight';
type SupportShapeSettings = Pick<LiveSupportSettings, SupportShapeKey>;

interface PrintUnit {                 // state/project.ts, saved in the project file
  // ...existing fields
  /** Per-support edits by exact contact id (automatic or manual); only the keys the user set. */
  overrides: Record<string, Partial<SupportShapeSettings>>;
}

type SceneCommand =
  | ...
  | { type: 'overrides/set'; unitId: string; contactIds: string[]; patch: Partial<SupportShapeSettings> }
  | { type: 'overrides/reset'; unitId: string; contactIds: string[] };
```

Effective shape of a contact = object defaults, then `overrides[id]`. Nothing is snapshotted at add
time. `SupportJob.contacts` gains `shapes: Record<id, SupportShapeSettings>` (resolved per contact by
`supportJobOf`, so the worker stays dumb, and resolved only for contacts that have an override);
`buildSupportMesh` reads each column's shape instead of `settings` for the shape keys, and the
builders take per-contact radii. `overrides/reset` deletes the entry. The export job and the project
file serialise `overrides`; `checkJobOf` ignores them.

Build rules to settle in the feature's own spec: braces use the object-wide pillar Ø, so unequal
pillars cannot occur; a column with an override stays out of tree merges (11.2 rule 4); the raft
footprint reads each column's own foot Ø.

### 11.5 Undo

`overrides/set` and `overrides/reset` are scene commands, so they go through history like every
edit. **Settings edits coalesce: one undo step per committed value** (number field Enter or blur,
choice click, slider release), and one per Reset. A burst of typing or dragging commits once. This
holds for object-wide settings too, which today may push one step per keystroke. Inside Support Edit
Mode the undo floor applies (Undo stops at the scene the mode was entered with). Undoing a
`manual/add` removes the support and any override on it. Selection is view state and never in
history; ids that stop naming a support after Undo, Redo or Regenerate are pruned from the selection.

### 11.6 Port

The data (`overrides`), commands and the resolve function (`effectiveShape(unit, contact)`) live in
`state/` and `core/`, framework-free; the mixed-value rule (`fieldValue(selection) ->
value | 'mixed'`), the live count (`customisedCount(unit)`) and the disabled-while-selected rule are
registry rules (`enabled` of each setting command reads `sel > 0` and the key's scope). Babylon
renders the same.

### 11.7 Copy (proposed, all **[new]**)

| en | zh-Hant | ja |
|---|---|---|
| Applies to {n} of {m} supports | 套用到 {m} 個支撐中的 {n} 個 | サポート {m} 本中 {n} 本に適用 |
| {k} customised | {k} 個已自訂 | {k} 本は個別設定 |
| Select them | 選取這些支撐 | それらを選択 |
| Settings for {n} selected | 已選取 {n} 個支撐的設定 | 選択中のサポート {n} 本の設定 |
| Changes apply to the selected supports only. | 變更只會套用到選取的支撐。 | 変更は選択中のサポートにだけ適用されます。 |
| - (mixed values; field hint:) Selected supports have different values. Enter a value to set them all. | 選取的支撐數值不同。輸入數值即可全部設為相同。 | 選択中のサポートで値が異なります。値を入力するとすべてに適用されます。 |
| Applies to the whole object. Clear the selection to change it. | 這項設定套用到整個物件。清除選取後即可變更。 | この設定はオブジェクト全体に適用されます。選択をクリアすると変更できます。 |
| Reset to defaults | 恢復預設 | 既定に戻す |
| Give the selected supports the default settings again. Undo brings their own values back | 讓選取的支撐改回預設設定。復原可找回原本的數值 | 選択中のサポートを既定の設定に戻します。「元に戻す」で元の値を復元できます |
| Supports with their own settings carry a ring. (marker legend, edit bar row 3) | 有自訂設定的支撐會加上圓環標記。 | 個別の設定を持つサポートには輪の印が付きます。 |
| {n} customised kept, {m} reset | 保留 {n} 個自訂支撐，重設 {m} 個 | 個別設定 {n} 本を保持、{m} 本をリセット |
| {n} supports hidden by an old removal are back | 有 {n} 個因舊式移除而被隱藏的支撐已恢復顯示 | 旧方式の削除で隠れていたサポート {n} 本が表示に戻りました |

Glossary check: 支撐 / サポート (counted 本), 刪除 vs 移除 unaffected, 復原 / 元に戻す.

### 11.8 Build order

1. 11.0 (b) then (a), each with its migration and test. 2. The `overrides` data, commands, save and
export (with the parity test). 3. Right panel header and count. 4. Per-support fields, Reset, the
ring mark. 5. The Regenerate report. Steps 1 and 2 ship without any UI change.

---

## 12. Owner-confirmable rules and open questions

### 12.1 Rules to confirm

| # | Rule | Default in this document | Status at `05d42c4` |
|---|---|---|---|
| C1 | Remove the header Generate (duplicate, second red button) | removed | Implemented. The header has no Generate (`a55d4ec`). |
| C2 | Left Exit stays live inside the locked panel AND the viewport Done stays; both run `mode.exit` and never disagree (4.4). Two of four reviewers preferred one Exit in the viewport bar. | both, one command | Implemented. The left Exit and the viewport Done both run `mode.exit` (`e01941f`). |
| C3 | Header: the lock blocks scene-changing commands only. Language, Hide models, Wireframe stay live in every mode; Undo / Redo stay live down to the mode's floor | view toggles live | Implemented. Language, Hide models and Wireframe stay live; Undo and Redo stop at the mode floor (`83ccbe1`). |
| C4 | File drop on the viewport is refused while a mode is on (today it ends the mode and imports) | refused | Implemented. A file dropped in a mode is refused, the status line says why and the lock note pulses (`83b85e4`, `54be8c9`). A dropped `.mixosupports` file follows the same rule. |
| C5 | Click reach (was Remove radius): drop the right-panel field once the Add bar has it | keep both for now (one registry control) | Implemented as the default. One registry command, `setting.clickReach`, renders in the Add bar and in the right panel Advanced group (`commands.ts:245`). |
| C6 | Viewport primary keeps the word "Done" (left button says "Exit ...") | "Done": says the work is kept | Implemented. The viewport button says "Done" and the left button says "Exit ..." (`EditBar.tsx:20`). |
| C7 | Supports follow defaults unless explicitly edited; Reset drops the override (replaces the earlier "freeze at add" and "re-snapshot" options) | decided by the coordinator, recorded | Implemented. `contactSettings` holds only edited values; Reset drops them (`8fc7742`). |
| C8 | A support with an override is kept out of tree merges | kept out (decided) | Implemented. A support with its own shape never joins an Auto Tree branch (`autotree.ts:58,62`). |
| C9 | Edit-mode right panel live (owner ruling of 2026-10-22) | live | Implemented, changed in order. The panel is live; Support shape sits first while supports are selected (`cb48f21`). |
| C10 | "Select them" outside Support Edit Mode enters the mode with the customised supports selected | enters | Changed. "Select them" selects the active object's customised supports and gives the count on other selected objects (`commands.ts:261-275`). |
| C11 | Zones frame and badge follow mixo-app-style (red hairline for every tool mode); blue stays the zone layer on the model and the Regenerate button | red frame, zone mode named in the badge | Implemented. Red hairline frame in both modes, the zone mode in the badge, blue kept for the zone layer (`f7dc6d1`). |
| C12 | Clear manual edits also drops per-support overrides (all hand work in one action, with an Undo toast that gives the counts) | drops them | Implemented. The toast reads "Cleared {a} added, {r} removed, {c} customised." with Undo (`toast.ts:44`, `App.tsx:540-551`). |
| C13 | Tab is no longer a mode key (it breaks focus navigation); modes are entered and left with the buttons, Done and Esc | no Tab | Implemented. The editor never takes Tab; it moves focus (`keys.ts:77-92` has no Tab rule; `a55d4ec`). |
| C14 | A click on a support toggles it; Shift+click is no longer documented as a separate action | toggle only | Implemented. A click on a support toggles it whatever Ctrl or Shift says (`pick.ts:58-62`). |

### 12.2 Open questions for the owner

| # | Question | Options | Default until answered | Status at `05d42c4` |
|---|---|---|---|---|
| Q1 | Esc: always exit the mode, or first clear the selection and then exit? Reviewers split (one: Esc always exits; one: Esc cancels the gesture, then clears, and the button exits). | exit always / clear then exit | clear then exit (today) | Implemented, answer 12.5. Esc clears the selection, the next Esc exits. The status line says "Esc again to exit" (`keys.ts:83-84`, `status.ts:34`). |
| Q2 | Should Check findings stay live inside Support Edit Mode, so Fix adds a support without leaving the mode? Today Edit locks the left panel, which also blocks Check and object switching. Related: a Generate button reachable from the edit bar when the object has no supports. | keep locked / findings live in Edit / findings in the viewport | locked | Implemented, answer 12.5. Check is live in Edit, Fix works in place, the edit bar shows Generate when the object is empty (`e51fc50`). |
| Q3 | Strict mode isolation (exit one mode before entering the other, four clicks and no shared undo floor) or a "Switch to zones" button in the mode bar that keeps one undo floor for the whole editing session? | strict / Switch button | strict | Implemented, answer 12.5. Strict isolation, with no switch button (`e01941f`). |
| Q4 | Right panel split: "Object: {scope}" always live, plus a context region "Support shape: defaults or n selected". And in Edit mode, label placement settings "applies on next Generate". | split / one list | one list with the 11.2 header | Implemented, changed in order. Object and Support shape regions; Support shape first while supports are selected. Placement in Edit says "Applies on next Generate." and "Placement changed. Regenerate to apply." (`SettingsPanel.tsx:214,264`). |
| Q5 | Registry form: a typed descriptor table with tests and a `disabledReason` per command, no generic renderer. | table + tests / generic renderer | table + tests | Implemented. A typed table in `commands.ts`, tests in `commands.test.ts`, a `disabledReason` per command, no generic renderer. |
| Q6 | Touch: Add has no touch equivalent of right-click removal (Select, then Delete works). Add an Add / Remove switch to the Add tool? | switch / leave | leave | Implemented, answer 12.5. The Add tool has an Add | Remove switch (`commands.ts:240-241`). |
| Q7 | Does Tips only change what Drag over can pick? To verify in the browser before the Select work. | n/a | unchanged | Answered from the code: no. Tips only changes what Drag over can pick. Evidence below the table. |
| Q8 | Width of the new Drag over row in ja (7.6). | n/a | measure before merge | Verified by the implementer (12.5). Not re-measured for this update. |

**Q7 answer, from the code.** Tips only does change what Drag over can pick.

- `UnitObject.tsx:50-51` swaps the built supports for `tipsOf(props.supports)` while the tips view is on.
- `UnitObject.tsx:121-123` hands that same `supports` mesh to `useScreenBrush`.
- `useScreenBrush.ts:161` builds the pickable bodies with `bodySegments(options.supports)`, so the circle tests the mesh on screen.
- `screenBrush.ts:39-44` takes one segment per support from its components. In the tips view those are the tip and neck only.
- `meshQuery.ts:22-40` keeps tip and neck components with their `contactId`, and keeps a stub at the landing end of a landing pillar (line 27).
- `view.ts:117-123` sets when the view is on. Drag over takes no part in that decision.

Every support stays pickable, because its contact id is kept. The hit area shrinks to the tip and neck,
so a circle that only grazes a pillar selects nothing in the tips view. Tests are `mesh.test.ts:239`
(tips still pick their contact) and `mesh.test.ts:138` (a support's own shape).

### 12.3 Gap list (14 gaps from the plan) and where each is answered

| # | Gap | Answer |
|---|---|---|
| 1 | Switching objects in Edit mode with the left panel locked | Refused with the busy line (4.3). Relaxing it is Q2 and Q3. |
| 2 | Empty state before Generate | Edit and Add stay available on an object without supports; entry status "No supports on {object} yet. Click the model to add one, or exit and Generate." (6.4). Generate from the edit bar is part of Q2. |
| 3 | Esc order | Today's order stays (clear selection, then exit). Q1. |
| 4 | Selection lifetime vs Undo | Selection is view state, empties on mode and object change, and is pruned of ids that no longer name a support (11.5). |
| 5 | Two removal paths, naming | Right-click removes exactly one support, Delete deletes the selection, both exact after 11.0 (6.1). |
| 6 | Tablets, no Shift | No drag needs a key (P7). Shift only flips Drag over; Click toggles (5.8). Touch removal in Add is Q6. |
| 7 | Overrides surviving Regenerate | Exact unit-local ids (11.0 b); kept or reset with a visible count (11.2 rule 8). |
| 8 | A zone removing selected supports | Dismissed: entering Zones empties the selection (4.1). |
| 9 | Mixed-selection undo granularity | One step per committed value for all selected supports (11.5). |
| 10 | "Select changed" action | "Select them" in the header count (11.2 rule 5). |
| 11 | Check and export use per-support settings | Export and the project file carry overrides; Check needs none (11.1, 11.2 rule 9). |
| 12 | Header controls locked in modes except Undo / Redo | Header lock blocks scene-changing commands only (4.4, C3). |
| 13 | Heavy model, disabled mode buttons with a reason | Help line under Modes (3.2 row 8) plus the button hint; `disabledReason` in the registry (Q5). |
| 14 | Tips only and Drag over interplay | Answered, Q7: Tips only changes what Drag over picks (12.2). |

### 12.4 Review dissent kept on record

- Two reviewers (A, B) wanted one Exit, in the viewport bar only, with the left mode buttons showing
  state only. The coordinator kept the document's choice (a live left Exit) and the viewport Done,
  on one command (C2).
- Two reviewers (C, D) said Check must use per-support settings. Dismissed: `checkJobOf` reads
  positions, angle and spacing only (11.1).

### 12.5 Owner answers (2026-10-22)

- C1 to C14: confirmed as written.
- Q1: Esc clears the selection first, then exits. While a selection exists the status line says "Esc again to exit".
- Q2: Check findings stay live inside Support Edit Mode. Fix frames the spot and adds a support without leaving the mode. The edit bar offers Generate when the object has no supports.
- Q3: strict isolation. No "Switch to zones" button. The owner prefers the peace of mind of separate modes.
- Q4: the right panel splits into "Object: {scope}" (always live) and "Support shape: defaults or n selected". In Edit mode placement settings say "applies on next Generate".
- Q5: the registry is a typed descriptor table with tests and a `disabledReason`; no generic renderer.
- Q6: the Add tool gets an Add | Remove switch.
- Q7, Q8: verified by the implementer in the browser.
- Audit item "Drag over on empty space": a drag that starts on the model or a support selects; a drag on empty space orbits.

---

## 13. UI behaviour audit

Method. Each control in the registry tables (5.2 to 5.8) is walked against the ten NN/g heuristics
(H1 visibility of status, H2 match with the real world, H3 user control and freedom, H4
consistency, H5 error prevention, H6 recognition over recall, H7 flexibility, H8 minimal design,
H9 error recovery, H10 help) and against a closed loop per action: **(1)** before the click, the scope
is explained; **(2)** immediate feedback; **(3)** progress for anything slow; **(4)** success or
failure is visible where the eye is; **(5)** a way to recheck or undo. Controls that pass every step
are left out (language, Select all, Transform, Fit view, Paint / Erase, Brush size, Circle size, tool
and method choices, view toggles in zones). Severity: high = hand work or trust can be lost silently;
medium = the user is unsure what happened; low = polish.

| Control | Problem | Fix | Severity | Status at `05d42c4` |
|---|---|---|---|---|
| check.run, check.showMe, check.fix | Findings go stale after any support edit and nothing says so; no recheck prompt (H1, step 5). A finding fixed in Edit mode stays listed. | Mark the list "Out of date, check again" after any support change; remove a finding when a support lands on its spot; Fix leaves a status naming the spot to click. | high | Done. The list is marked "Out of date, check again."; a finding goes when a support covers it (`dae2674`, `258520b`). |
| setting.* (placement keys) | A placement setting silently schedules a regeneration (App.tsx:432-440); the user cannot tell that hand work is touched (H5, steps 1 and 4). | Status "Placement changed: regenerating {scope}" while it runs, then the "{n} customised kept, {m} reset" report with Undo. | high | Done, changed. Outside a mode a regeneration is announced and reported; in Edit the change waits and the panel says "Placement changed. Regenerate to apply." (`33dbd0a`, `7d2b612`). |
| supports.generate (Regenerate) | The hint does not say what a regeneration keeps or replaces (H2, step 1). | Hint: "Replaces automatic supports. Your added supports and customised settings are kept where they still fit." | medium | Done. The hint names what is kept (`b44da0d`). |
| supports.clearManual | Scope unclear once overrides exist; Undo toast gives no counts (H5, H9). | Clear manual edits also drops overrides (C12); toast "Cleared {a} added, {r} removed, {c} customised. Undo". | medium | Done. It drops overrides; the toast gives the three counts (`toast.ts:44`). |
| supports.remove | Destructive, no Undo toast, hint silent about Undo (H3, H9). | Toast "Removed supports of {scope}. Undo". | medium | Done. Undo toast (`fd7e66c`). |
| check.fix | The loop does not finish: Fix enters Edit mode, the user must find the spot, and the Check list is locked away inside the mode (step 4, Q2). | Frame the spot, show a ghost marker, status "Click here to add a support"; on add, say "Spot covered". | medium | Done, changed. It frames the spot and says "Click the framed spot to add a support."; no ghost marker. The re-check says "Spot covered." (`e51fc50`). |
| edit.method (Drag over) | The hint says "starting anywhere in the view" but mixo-app-style says a drag on empty space orbits; the user cannot tell which one a drag will do (H4, step 1). | Follow the skill: a drag that starts on the object selects, on empty space orbits; show the ring only over the object. Or record the deviation as an owner decision. | medium | Done. A drag starts on the model or a support, else it orbits (`807c7f7`). |
| edit.add (click) | Feedback for "Support added." is only the footer line, 11.5 px, far from the click (H1, step 2). | Flash a ring at the new tip for 400 ms; keep the status line. | medium | Done. A ring flashes at the new tip for 400 ms (`44315ae`, `f8d25fd`). |
| edit.keys.add (right-click) | After 11.0 a right-click removes exactly one support, but the old hint still says "every support within this distance" (H2). | New copy for Click reach and for the Add hint (6.2). | medium | Done. New Click reach and Add / Remove copy (`b8c8f34`). |
| Footer status line | Every success and failure of every action lands in one small live line at the bottom (H1, step 4). Long actions (Generate, export, Check) finish out of sight. | Long actions also end with an Undo toast or a job-list entry that stays until dismissed; the status line keeps the text. | medium | Done. Undo toasts, and a job list entry that stays until dismissed (`fd7e66c`, `1748ef5`). |
| export.kind[5] | Success says little: no file name, count or size; a failed build can look like a slow one (H1, step 4). | Status "Exported {file} ({n} supports)"; on failure the job list shows the error until dismissed. | medium | Done. Names the file and support count; a failed job stays listed (`1748ef5`). |
| zones.badge, zones.* | Painting a zone gives no number for its effect (step 4). | Badge shows "{n} supports hidden by zones" from the shown build's `dropped` contacts (App.tsx:206). | medium | Done. "{n} supports hidden by zones" (`f7dc6d1`, `2b494b7`). |
| mode.edit, mode.zones | With several objects selected the button does not say which object the mode will edit (H2, step 1). | Hint "Edit supports of {object}"; the badge repeats the name. | low | Done. The hint names the active object (`b44da0d`). |
| Locked panels (4.5) | A click on a locked section does nothing visible if the catcher is optional (H1). | Make the catcher required: any click on a locked section repeats "Finish ... first" in the status line and pulses the lock note. | medium | Done. The click catcher repeats the lock note and pulses it (`83ccbe1`, `54be8c9`). |
| history.undo, history.redo | At the mode floor the buttons go grey with no reason (H1, H9). | Hint at the floor: "Nothing more to undo inside this mode. Exit to go further back." Hints name the last action. | low | Done, changed wording. Hints name the step (`e9ccce2`); the floor reason reads "Nothing to undo here: leave the mode to undo earlier steps." |
| view.models | With models hidden, an Add click has no surface to land on and does nothing (H5). To verify. | Disable Add with a note while models are hidden, or keep picking on the hidden mesh. | medium | Done, no change needed. A browser walk on f8d25fd showed an Add click with models hidden still lands on the hidden mesh, so Add keeps working. |
| Keyboard: Tab | Tab toggles the mode and calls preventDefault (keys.ts:53), so keyboard users cannot move focus (H7, accessibility). | Drop Tab as a mode key (C13). | high | Done. The editor never takes Tab (`a55d4ec`). |
| Keyboard: Esc in a field | Esc and Delete typed in a number field are ignored by the app (keys.ts:47), but a range or checkbox keeps focus after pointerup, so Esc and Delete then do nothing in the mode (H7). | Fields keep their own Esc (revert, blur). Range and checkbox inputs are exempt from the form-field rule, so Delete and Esc reach the mode after pointerup (8.6). | medium | Done. Only text-taking fields are exempt, so range and checkbox focus no longer blocks Esc and Delete (`a55d4ec`, `1b1b46e`). |
| objects.delete | Destructive with no toast; hint only mentions Undo (H3). | Toast "Deleted {n} objects. Undo". | low | Done. Undo toast (`fd7e66c`). |
| import.files | A drop refused in a mode is announced only in the status line (H1). | Pulse the lock note as well (C4). | low | Done. The refusal pulses the lock note (`54be8c9`). |
| jobs.cancel | After Cancel nothing says the old supports are untouched (H9, step 4). | Status "Cancelled. Supports unchanged." | low | Done. "{label}: cancelled. Supports unchanged." (`1748ef5`). |
| setting.preset | A preset overwrites many fields at once without listing them (H2). | Hint lists the fields it sets; one undo step. | low | Done in part. The hint lists the groups a preset sets and says Undo takes them back, not each field (`54be8c9`). |
| Footer counts | "removed" means nothing to a layperson (H2). | Hint on the count: "Automatic supports you removed. Clear manual edits brings them back." | low | Done. The hint explains "removed" (`54be8c9`). |
| edit.removeRadius (Click reach) | The field changes how a right-click lands but shows nothing (H1). | Show a hover ring of the reach in Add. | low | Done. `EditPreview` draws a ring of Click reach at the pointer in Add (`src/components/viewport/supportLayers.tsx:35-43`), and highlights the support a remove click would take. |
| zones.clearAll, edit.deleteSelection | Disabled or inert without saying why (H6). | `disabledReason` hint (Q5): "No zones painted", "Nothing selected". | low | Done. `disabledReason` on every disabled command; Delete is always shown (`b44da0d`). |

Top gaps to fix first: stale Check findings, silent regeneration of hand work, Tab focus trap,
the half-finished Fix loop, Drag over on empty space versus orbit. All five are done.

No audit rows are open at `05d42c4`.
No row is marked won't do.

## 14. Project files (Save and Open)

Not in the original design. Shipped in `05d42c4`.

Save project writes the plate as one `.mixosupports` file. Open project reads it back.

- **Where.** An Open / Save row sits under Import models in the left panel (`App.tsx:867-870`). Both are registry commands, `project.open` and `project.save` (`commands.ts:168-175`).
- **Enabled.** Open needs no mode on, and in a mode its reason is the busy line. Save needs at least one object, and its reason is the no-model line. The row is inert with the Import section when a mode locks it.
- **Format.** Version 1. JSON with a header `{ app: "mixo-supports", version: 1, scene }`, gzip-compressed where the browser has `CompressionStream`, else plain JSON. Open reads both by the gzip magic bytes (`state/projectFile.ts:5-7,36-62`).
- **Contents.** The scene's units. Each holds its model mesh, transform, settings, manual supports, removals, per-support settings and zones. Selection and the active object are not saved.
- **File name.** The first object's name without its extension, plus `.mixosupports`. Characters a file name cannot hold become `_`.
- **Saving.** A native save dialog opens where the browser offers one, else the file downloads. A cancelled dialog says "Save cancelled; no file was written." A failure says nothing was written.
- **Opening.** Open replaces the plate as one history step. When objects were on the plate, an Undo toast brings them back. Dropping a `.mixosupports` file on the viewport opens it the same way (`App.tsx:785-791`).
- **Refusals.** Open waits while a mode is on, as an import does. It refuses a file with no header, a newer version, a damaged file, and a project over this device's triangle limit. Each message names the file, says what to do, and leaves the plate unchanged.
- **Progress.** A job entry shows "Opening {name}" or "Saving {name}".
- **Leave guard.** After a change since the last save or open, the page asks before it closes (`beforeunload`, `useProjectFile.ts:36-46`). A selection change alone does not arm it.
- **Port.** The format and the messages in `src/editing/project.ts` hold no React. `useProjectFile.ts` is the only React part.

---

## Appendix A. Verified against the code

Paths under `src/` unless noted. Re-checked at `05d42c4`. `App.tsx` is 987 lines and most of its
logic moved into hooks (`useExport`, `useFixSpot`, `useRegenerate`, `useProjectFile`). A row marked
"moved" kept its meaning and now points at the new place.

| Item | Location at `05d42c4` |
|---|---|
| Header: brand, subtitle | App.tsx:845-846 |
| Language switch | App.tsx:848; i18n.ts |
| Undo / Redo buttons and hints | App.tsx:849-852; commands.ts:123-135 |
| Hide / Show models, Wireframe / Solid | App.tsx:853-856 |
| Header Generate | removed (`a55d4ec`) |
| Left panel container | App.tsx:860 |
| Import drop zone, picker, help | App.tsx:862-866 |
| Open / Save project row | App.tsx:867-870; styles.css:117 |
| Objects list, rows, Select all, Delete | ObjectList.tsx:13; App.tsx:871 |
| Transform Select / Move / Rotate, disabled in a mode | App.tsx:881-887 |
| Supports group: Generate / Regenerate, Clear manual edits, Remove supports | App.tsx:888-893; commands.ts:176-190 |
| Modes group (Support Edit Mode, No-support zones), now after Supports | App.tsx:894; ModeEntry.tsx:11-24; commands.ts:197-216 |
| Mode button labels, hints, enabled rules | commands.ts:197-216 (`editing/modeButtons.ts` is gone) |
| Zones state label, Clear all zones | ModeEntry.tsx:23-24; ZonesBar.tsx:15; App.tsx:566 (`clearActiveZones`) |
| Remove supports and Clear manual edits, with Undo toasts | App.tsx:533-551 |
| Check supports, findings, help | App.tsx:895-899; ProblemList.tsx:9 |
| Stale Check label | ProblemList.tsx:20 |
| Fix: frames the spot, enters or stays in the mode; refused in zones | useFixSpot.ts:34-68 |
| Import in a mode | moved: refused instead of ending the mode (App.tsx:430-434; status.ts:82) |
| Viewport classes per gesture | App.tsx:90 (`VIEWPORT_CLASS`), 903 |
| View group Tips only / Fit view / Bottom view | App.tsx:935-940; editing/view.ts:81-136 |
| Circle size preview | App.tsx:941; viewport/CirclePreview.tsx |
| Drop overlay, job activity, toast region | App.tsx:942-946; JobActivity.tsx:46; UndoToast.tsx:10 |
| Setup overlays: object name, unit note | App.tsx:948-949 (the viewport Edit supports button is gone) |
| Zones bar | App.tsx:951; ZonesBar.tsx:15 |
| Edit bar | App.tsx:952; EditBar.tsx:38 (bar), 26 (badge texts), 20 (Done), 59-76 (tools, Shift hint), 86-89 (key hints), 101 (Select / Unselect switch), 108 (Click reach field) |
| Right panel: Object and Support shape regions, defer note, pending note | App.tsx:954-971; SettingsPanel.tsx:173 (region type), 214 (defer note), 219-275 (264 pending note) |
| Export section | App.tsx:972-978; App.tsx:86 (`EXPORT_IDS`); useExport.ts |
| Click reach setting (limits 0.1 to 50, default 1.5) | SettingsPanel.tsx:153; core/supports/settings.ts:251, 315 |
| Footer counts and status line | App.tsx:979-984 |
| Session state, events, reducer | editing/session.ts:10, 62, 99 |
| Command registry: ids, `resolve`, rows | editing/commands.ts:1-30 (ids), 123-275 (rows) |
| Keyboard rules | editing/keys.ts:69-92 (`keyAction` 69, Esc 77-84), `takesText` 20; App.tsx:823 (listener) |
| Range input keeps focus after pointerup | components/RangeField.tsx:27 |
| Gesture kinds | editing/gesture.ts:11-33 |
| Status lines per gesture, building, busy | editing/status.ts:9-31, 77-82 |
| "Esc again to exit" | editing/status.ts:33-44 |
| Pick: click toggles regardless of Ctrl / Shift | editing/pick.ts:49-62 |
| Undo toasts | editing/toast.ts:11-61 |
| Selection clear / delete handlers | App.tsx:667, 696 |
| Busy refusal on object click in a mode | App.tsx:578 |
| Right-click removal: eraseNear, removeContact | App.tsx:614-647 |
| "Support added." status | App.tsx:611 |
| Placement compose: exact-id removals, marker hide, remap, re-key | core/analysis/placement.ts:96 (`composeContacts`), 102 (`hidingRemovals`), 112 (`contactsHiddenByMarkers`), 126 (`remapDeleted`), 149 (`rekeyHandWork`), 212 (`positionFromId`) |
| Exact-removal tests | core/analysis/placement.test.ts:159 (exact), 170 (remap), 178 (no match), 217 (marker) |
| Placement runs in the turned frame | supports/unitSupports.ts:143-166 (`orientationOf`, `placementJobOf`); supports/jobRunner.ts:88-93 |
| Check job reads positions, angle, spacing only | supports/unitSupports.ts:167 (`checkJobOf`) |
| Zoned contacts of the shown build | supports/unitSupports.ts:100-114 (`hiddenByZones`); App.tsx:215 |
| Placement pending, regenerate hook | supports/unitSupports.ts:37; components/useRegenerate.ts:21; App.tsx:278, 804 |
| Regeneration report | editing/regenerate.ts:23-69 |
| Per-support settings: data, commands, keys | state/project.ts:43, 74-80; core/supports/settings.ts:112 (`SHAPE_KEYS`); editing/shapeEdit.ts:18-58 |
| Own-shape and manual supports kept out of tree merges | core/supports/autotree.ts:58, 62 |
| One settings object per unit; manual contacts | state/project.ts:25-43 |
| Support job: one settings object, all contacts | supports/unitSupports.ts:75-125; core/jobs.ts:75 |
| Bracing across all columns | core/supports/mesh.ts:227 (`addBraces`) |
| Tips view of a support mesh | core/supports/meshQuery.ts:22-40; components/viewport/UnitObject.tsx:50-51 |
| Drag over: bodies, circle, strokes | components/viewport/useScreenBrush.ts:161; editing/screenBrush.ts:39; editing/dragOver.ts:40 |
| Project file format, Save, Open | state/projectFile.ts:5-62; components/useProjectFile.ts:36-46; editing/project.ts |
| Browser walk | scripts/walk.mjs (`npm run walk`) |
| Glossary, zone-only words, zone texts | glossary.ts:19-55; docs/migration/glossary.md |
| Styles: primary, danger, regen | styles.css:54-57 |
| Styles: header, workspace 268 / 1fr / 300, footer | styles.css:60, 83, 406-419 |
| Styles: edit frame, badge, bar, view group move | styles.css:232-261, 461 |
| Styles: Tips only forced look | styles.css:454 |
| House tokens | `~/.claude/skills/mixo-app-style/tokens.css`, `base.css`, `SKILL.md` |
| Stitch DESIGN.md location and sections | `~/.claude/skills/stitch/references/design-md.md`, `flows/design.md` |
