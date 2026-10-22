# mixosupports UI structure

Date: 2026-10-22. Status: design, owner decisions of 2026-10-22 encoded. Code baseline for every
"today" statement: commit `acd3f98` (branch `refactor/app-shell`, which contains
`refactor/selection-pipeline`); file:line references are in the appendix. Behaviour details that
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
11. Feature: context-sensitive right panel and per-support settings (after the layout work)
12. Owner-confirmable rules and open questions
- Appendix A: verified against the code (file:line)

Markers used below: **[today]** = shipped at `acd3f98`; **[change]** = this document changes it;
**[new]** = new control or string; **[feature]** = section 11, built after the layout work;
**[confirm]** = rule the owner should confirm (listed again in section 12).

---

## 1. Purpose, audience, principles

**Purpose.** One reference for what is on screen, where, when, and why, for three readers: the
React implementer of the layout brush-up, the Babylon.js porter (mixomesh), and Stitch (UI mockups,
section 10). It defines the structure; the behaviour spec defines the gestures.

**Audience of the app.** Lay resin printers: they know "supports", "raft", "overhang" from their
slicer (Chitubox, Lychee), not 3D-editor jargon. They print one or a few models, want automatic
supports, then fix a few spots by hand. They must never be unsure which mode they are in or how to
get out.

**Principles.**

| # | Principle | What it means here |
|---|---|---|
| P1 | One primary per view | Exactly one red-filled button visible at a time: the left-panel Generate outside a mode, the viewport Done inside a mode. Check findings' Fix stops being red **[change]**. |
| P2 | Progressive disclosure | Mode → Tool → Tool options → Actions. Each level is shown only while its parent is active (Remove radius only under Add; Click / Drag over only under Select; Select / Unselect switch and Circle size only under Drag over; selection actions only with a selection). |
| P3 | No repeated controls | Every control exists once in the registry and is rendered in one place. Removed duplicates: header Generate **[change, confirm]**, viewport "Edit supports" button **[change]**, left-panel "Clear" zones button **[change]**, "Edit no-support zones →" **[change]**. One accepted exception: Remove radius (section 3.3). |
| P4 | Layperson words | Printing words, one term per concept (glossary), the badge says in words what a click does. Paint / Erase / Brush only for zones; Select / Drag over / Circle size only for picking supports. |
| P5 | Modes are siblings and isolated | Support Edit Mode and No-support zones never nest: exit one before entering the other. A mode belongs to the active object. |
| P6 | Always a visible way out | Each mode has two visible exits (left-panel Exit button, viewport Done) plus Esc. No exit needs a key. |
| P7 | No required key + drag | Every drag works without a key held. Keys (Shift, Ctrl, Delete, Esc, Tab, G, R) are optional accelerators with a visible equivalent. |
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
group, `b` chosen · `░` dimmed and locked (`inert`) · `#` red 1 px edit frame · `%` blue 1 px zones
frame · `|A|` the active object's letter badge (red) · `v` / `>` open / closed group. Panel content is
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
|░[ Import models    ] |#                    | Remove radius [ 1.5 ] mm                 | #|   Support spacing  3.0  |
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
section 11 comes later). The bar reads top to bottom: tool, tool option (Remove radius), key hints,
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
| Finish painting zones|%=================================================================%| Finish painting zones   |
| first: press Esc or  |%[PAINTING NO-SUPPORT ZONES  bust.stl]                            %| first: press Esc or     |
| Done.                |%                                                                 %| Done.                   |
|                      |%            +---------------------------------------------------+%|                         |
|░IMPORT MODELS        |%            | [=Paint=|Erase]  Brush size [-----o-----] 2.0 mm  |%|░SUPPORT SETTINGS  bust  |
|░[ Import models    ] |%            | Supports attach underneath: turn the view (Bottom |%|░Preset [Lt|=Md=|Hv|Cu]  |
|░ STL, GLB or glTF.   |%            | view) to paint where they are.          Ctrl+Z    |%|░Lift height    5.0 mm   |
|░OBJECTS           3  |%            |            [! Clear all zones !]  [* Done  Esc *] |%|░Roof/cage [=Off=|Rf|Cg] |
|░|A| bust.stl    412  |%            +---------------------------------------------------+%|░v Auto placement        |
|░ B  base.stl     88  |%                         .----------.                            %|░  Support spacing  3.0  |
|░ C  ring.stl      -  |%                        (  /////     )   //// = blue zone layer  %|░  Overhang angle   50   |
|░[Select all][Delete] |%                         '--..-..--'     (tips only, forced)     %|░  [x] Downward faces    |
|░TRANSFORM            |%                     ======================                      %|░  [x] Islands           |
|░[Select|=Move=|Rot.] |%                                                                 %|░v Contact tip           |
|░SUPPORTS FOR ALL 3   |%                                                                 %|░  Shape [=None=|Sphere] |
|░[*Regenerate      *] |%                                                                 %|░  Point dia.  0.40 mm   |
|░[Clear manual edits] |%                                                                 %|░> Pillar                |
|░[! Remove supports!] |%                                                                 %|░> Foot                  |
| MODES                |%                                                                 %|░> Bracing               |
| [=Exit no-support z=]|%                                                                 %|░> Raft                  |
|   (live, ink fill)   |%                                                                 %|░> Letter label          |
|░[ Edit supports    ] |%                                                                 %|░> Advanced              |
|░CHECK SUPPORTS       |%                                                                 %|░EXPORT STL              |
|░[Check for unsupp. ] |%                                                                 %|░[Active obj + model ]   |
|░ o Island  A    [Fix]|%                                                                 %|░[Active, supports   ]   |
|░ o Overhang A   [Fix]|%                                                                 %|░[Each obj + model   ]   |
|                      |%                             [=Tips only=][Fit view][Bottom view]%|░[Each, supports     ]   |
|                      |%=================================================================%|░[Whole plate, 1 file]   |
+----------------------+-------------------------------------------------------------------+-------------------------+
| 3 objects   412,330 triangles   396 automatic, 16 manual, 2 removed  Paint where supports must not grow; drag on...|
+--------------------------------------------------------------------------------------------------------------------+
```

Notes: both side panels are dimmed and locked; the only live panel control is the left Exit button
(4.4). Tips only shows pressed and does nothing (forced, today). Clear all zones lives only here
**[change]**. The camera-above-plate note shows only while the camera is above the plate (today).

---

## 3. Left panel brush-up

### 3.1 Proposed order and why

1. **Import models** — first step, always at the top.
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
| 4 | Section "Edit supports": button Enter Support Edit Mode / Exit Support Edit Mode, help "Add or remove supports by clicking the model. Tab toggles." | Moved into group **Modes** (position 5) as button **Edit supports** / **Exit Support Edit Mode** **[change]** | One group for both modes; label as owner named it. |
| 5 | Section "No-support zones" with count (Painted / None): button Paint zones / Exit no-support zones; **Clear** (danger, compact); help "Paint where supports must not grow. Manual supports stay." | Group **Modes**: button **No-support zones** / **Exit no-support zones**, with the muted state word Painted / None at the button's right end **[change]**. **Clear removed** (lives in the zones bar). | One button per mode, no other mode controls in the left panel. The state word is information, not a control: it tells the user zones exist (they change generation). |
| 6 | Supports for {scope}: Generate supports / Regenerate (red / blue), Clear manual edits, Remove supports | Same controls, position 4; Clear manual edits and Remove supports restyled `.danger` **[change]** | Work order; destructive role. |
| 7 | Check supports: Check for unsupported spots, findings (Show me, Fix in red), help line | Same, position 6; **Fix becomes secondary** **[change]** | P1: one primary per view (up to 12 red Fix buttons today). |
| 8 | Help lines under the two mode sections | One help line under the Modes group, shown only when both buttons are disabled: "Select an object first." or the heavy-model line | Says why, only when needed. |
| — | (viewport) "Edit supports" button top-right outside a mode | Removed **[change]** | Duplicate of the Modes button (P3); breaks sibling symmetry (zones has none). Tab stays as the shortcut. |
| — | (header) Generate supports for {scope} | Removed **[change, confirm]** | Duplicate of the Supports group button (P3) and a second red button (P1). |

### 3.3 The Remove radius exception

Owner: Remove radius is an option of the Add tool. Today it is a per-object setting in the right
panel (Advanced → Remove radius, setting `eraseRadius`, 0.1–50 mm, default 1.5). The right panel stays
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
                ENTER_EDIT  (Edit supports button, Tab, check finding Fix)   guard: editable
      ┌───────┐ ─────────────────────────────────────────────────────────▶ ┌──────────────┐
      │       │ ◀───────────────────────────────────────────────────────── │ edit         │
      │ setup │   EXIT (Done, Exit button, Esc*, Enter†, Tab)              │  add         │
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
   † Enter exits only when focus is not on a button, link, summary or tabindex element (today).
```

### 4.3 Transitions

| From | Event (sources) | Guard | To | Effects |
|---|---|---|---|---|
| setup | ENTER_EDIT (Modes → Edit supports; Tab; check Fix on a finding) | editable | edit | Undo floor = scene now; selection empty; status = tool line (6.4); focus → mode bar's pressed tool button (8.2). Fix selects the finding's object first, then enters (today). |
| setup | ENTER_EDIT / ENTER_ZONES | no active object | setup | Status "Select an object to edit its supports." / "Select an object first." (today). The buttons are disabled in this state, so only Tab reaches this row. |
| setup | ENTER_EDIT / ENTER_ZONES | heavy | setup | Status: the heavy-model line (today). |
| setup | ENTER_ZONES (Modes → No-support zones) | editable | zones | Undo floor; Tips only forced; focus → Paint / Erase group. |
| edit | EXIT (Done; left Exit Support Edit Mode; Esc with no selection; Enter†; Tab) | — | setup | Status "Support edits kept."; focus → left Modes button. |
| edit | Esc | selection > 0 | edit | Clear selection, Undo toast (today). |
| edit | Delete / Backspace | selection > 0 | edit | Delete selected, one undo step (today). |
| edit | ENTER_ZONES | — | — | Not reachable: the zones button is locked in edit (4.4), no shortcut exists. |
| zones | EXIT (Done; left Exit no-support zones; Esc; Enter†) | — | setup | Status "No-support zones kept."; Tips only returns to its previous state; focus → left Modes button. |
| zones | Tab / ENTER_EDIT | — | zones | Swallowed (today). |
| edit, zones | click on another object in the viewport | — | same | Refused, status "Finish … first: press Esc or Done." (today). |
| edit, zones | file dropped on the viewport | — | same | Refused with the same busy line **[change, confirm]** (today an import ends the mode). |
| edit, zones | the active object leaves the scene | — | setup | Forced exit (today). |
| edit (sub) | Tool Add ↔ Select; Click ↔ Drag over; switch Select ↔ Unselect | — | edit | Status line updates to the new tool line (today); badge text follows (6.4). |
| edit (sub) | Shift down / up during Drag over | method = dragOver | edit | `shiftHeld` flips the effective drag action; the circle, cursor badge and badge text follow at once; a running stroke applies it to later steps (stroke queue keeps per-step mode, today) **[new]**. |

Removed transitions **[change]**: edit → zones ("Edit no-support zones →", `openZones from: 'edit'`),
zones → edit (`closeZones` with `zonesReturn = 'edit'`), and "Remove supports ends the mode" (Remove
supports is in the locked left panel, so it cannot be pressed in a mode).

### 4.4 What each region does per state

| Region | setup | edit (Support Edit Mode) | zones (No-support zones, focus mode) |
|---|---|---|---|
| Header | live | live: language, Undo / Redo (stop at the mode's floor), Hide models, Wireframe | live (same set) **[confirm]** |
| Left panel | live | dimmed + locked; **Exit Support Edit Mode** stays live (pressed, ink) | dimmed + locked; **Exit no-support zones** stays live (pressed, ink) |
| Viewport | object name, view toggles top-right, unit note | red frame, red badge, edit bar top-right, view toggles bottom-right | blue frame, blue badge, zones bar top-right, view toggles bottom-right, Tips only forced |
| Right panel | live | **live** (owner ruling): settings and Export | dimmed + locked, no exception |
| Footer | live | live | live |
| Keyboard | Tab, Delete (objects), G, R, Ctrl+Z / Y | Tab, Esc, Enter, Delete / Backspace (supports), Shift (Drag over), Ctrl+Z / Y | Esc, Enter, Ctrl+Z / Y (Tab swallowed) |

**Decision: the Exit button stays live inside the locked left panel, in both modes.** Reasons: (1)
the button that took the user in takes them out, in the same spot, as shipped; (2) a visible
"Exit …" label on a dead button would be a dead control (the user clicks, nothing happens); (3) one
rule for both modes, so the user learns it once; (4) focus mode exists to stop scene changes from the
panels while painting, and leaving the mode is not a scene change. The viewport Done and Esc remain;
in zones the viewport Done is the primary exit, the left Exit the secondary one. Implementation: put
`inert` on every left-panel section and on the other mode's button, not on the panel element
(an `inert` ancestor cannot have a live child).

### 4.5 Lock behaviour details

- A locked region gets the lock note at its top, at full opacity, not inert: edit → "Finish editing
  supports first: press Esc or Done."; zones → "Finish painting zones first: press Esc or Done."
  (existing strings, today used as the busy status).
- A click on a locked region repeats the note in the status line (a transparent, non-focusable
  catcher over the inert sections; optional, keeps clicks from vanishing silently).
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

### 5.3 Left panel

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| import.files | imp.title, imp.help | — | imp.hint | drop on viewport | always | mode = setup | secondary (drop zone) | today; viewport drop refused in a mode **[change]** |
| objects.row[i] | object letter, name, support count | — | obj.row.hint | Shift / Ctrl+click adds or removes | units > 0 | mode = setup | choice | today |
| objects.selectAll | obj.selectAll | — | obj.selectAll.hint | — | always | units > 0 | secondary | today |
| objects.delete | obj.delete | — | obj.delete.hint | Delete (setup) | always | selObj > 0 | destructive | role **[change]** |
| transform.mode | tr.select / tr.move / tr.rotate | — | tr.*.hint | G (Move), R (Rotate) | always | mode = setup | choice | today |
| supports.generate | sup.generate / sup.regenerate | — | sup.generate.hint | — | always | units > 0 | primary (blue when Regenerate) | today |
| supports.clearManual | sup.clearManual | — | sup.clearManual.hint | — | always | units > 0 | destructive (Undo toast) | role **[change]** |
| supports.remove | sup.remove | — | sup.remove.hint | — | always | units > 0 | destructive | role **[change]** |
| mode.edit | mode.edit / mode.exitEdit | — | mode.edit.hint / mode.exitEdit.hint | Tab | always | setup: editable; edit: true (**lock-exempt**); zones: false | secondary; pressed (ink) in edit | label **[change]** |
| mode.zones | mode.zones (+ zones.state Painted / None) / mode.exitZones | — | mode.zones.hint / mode.exitZones.hint | — | always | setup: editable; zones: true (**lock-exempt**); edit: false | secondary; pressed (ink) in zones | label **[change]** |
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
| setting.eraseRadius | Advanced → Remove radius | rp.eraseRadius.hint | always | active | field | today; also rendered in the Add bar (3.3) |
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
| vp.editToggle | mode.edit | — | — | Tab | — | — | secondary | **removed [change]** |
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
| edit.done | done + kbd Esc | — | edit.done.hint | Esc (no selection), Enter† | mode = edit | always | primary | today |
| edit.openZones | Edit no-support zones → | — | — | — | — | — | — | **removed [change]** |

### 5.7 No-support zones (zones bar, badge)

| id | Label (copy) | Icon | Hint (copy) | Shortcut | Visible | Enabled | Role | Status |
|---|---|---|---|---|---|---|---|---|
| zones.badge | badge.zones + object name | — | — | — | mode = zones | — | info (`role="status"`) | today |
| zones.tool | zones.paint / zones.erase (group label zones.brush) | — | zones.paint.hint / zones.erase.hint | — | mode = zones | always | choice | today |
| zones.brushSize | zones.size + "{n} mm" (0.5–10, step 0.5) | — | zones.size.hint | — | mode = zones | always | field (slider) | today |
| zones.keys | kbd Ctrl+Z "undo" | — | — | — | mode = zones | — | info | today |
| zones.note | zones.note | — | — | — | camera above the plate | — | info (`role="note"`) | today |
| zones.clearAll | zones.clearAll | — | zones.clearAll.hint | — | mode = zones | hasZones | destructive (Undo toast) | today; only place now **[change]** |
| zones.done | done + kbd Esc | — | zones.done.hint | Esc, Enter† | mode = zones | always | primary | today |
| zones.clearLeft | Clear (left panel, compact) | — | — | — | — | — | — | **removed [change]** |

### 5.8 Keyboard-only bindings

| Key | State | Command | Visible equivalent |
|---|---|---|---|
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | any (not in a text field) | history.undo / history.redo | header Undo / Redo |
| Tab | setup ↔ edit; swallowed in zones | mode.edit | Modes → Edit supports / Exit Support Edit Mode |
| Esc | edit with selection → edit.clearSelection; edit without → edit.done; zones → zones.done | as named | Clear selection, Done |
| Enter† | edit, zones | edit.done / zones.done | Done |
| Delete, Backspace | edit with selection | edit.deleteSelection | Delete |
| Delete | setup | objects.delete | Objects → Delete |
| G / R | setup | transform.mode Move / Rotate | Transform group |
| Shift (held) | edit, method = dragOver | flips edit.dragAction while held **[new]** | the Select / Unselect switch |
| Shift+click, Ctrl+click | edit, method = click | toggle one support (same as a plain click; never clears the rest) | plain click |
| Right-click, Ctrl+click | edit, tool = add | remove within Remove radius | (Select → Delete for exact removal) |

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
- **Delete** = exactly the selected items. **Remove** = within Remove radius, or all supports of an
  object. **Clear** = empty a list (selection, zones, manual edits) with an Undo toast.
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
| mode.edit.hint | Add or remove supports by clicking (Tab) | 點擊以新增或移除支撐（Tab） (zh:47) | クリックでサポートを追加・削除（Tab） (ja:46) | today |
| mode.exitEdit | Exit Support Edit Mode | 離開支撐編輯模式 (zh:37) | サポート編集モードを終了 (ja:36) | today |
| mode.exitEdit.hint | Finish editing supports (Esc or Tab) | 結束支撐編輯（Esc 或 Tab） (zh:312) | サポート編集を終了します（Esc または Tab） (ja:308) | today |
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
| rp.eraseRadius | Remove radius | 移除半徑 (zh:411) | 削除半径 (ja:407) | today key, new placement |
| rp.eraseRadius.hint | Right-click (or Ctrl+click in Add supports) removes every support whose contact is within this distance of the click | 右鍵點擊（或在「新增支撐」中按 Ctrl+點擊）時，移除接觸點在此距離內的所有支撐 (zh:412) | 右クリック（「サポートを追加」では Ctrl+クリック）で、接触点がこの距離内にあるサポートをすべて削除します (ja:408) | today |
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
| badge.zones | Painting no-support zones | 正在塗刷免支撐區 (zh:281) | サポート禁止エリアを塗装中 (ja:277) | today |
| zones.brush | Zone brush (group label) | 區域筆刷 (zh:282) | エリアブラシ (ja:278) | today |
| zones.paint | Paint | 塗刷 (zh:283) | 塗る (ja:279) | today |
| zones.paint.hint | Paint no-support zones on the model | 在模型上塗刷免支撐區 (zh:321) | モデルにサポート禁止エリアを塗ります (ja:317) | today |
| zones.erase | Erase | 擦除 (zh:284) | 消す (ja:280) | today |
| zones.erase.hint | Erase no-support zones from the model | 從模型上擦除免支撐區 (zh:322) | モデルからサポート禁止エリアを消します (ja:318) | today |
| zones.size | Brush size | 筆刷大小 (zh:285) | ブラシサイズ (ja:281) | today |
| zones.size.hint | Radius of the zone brush | 區域筆刷的半徑 (zh:323) | エリアブラシの半径 (ja:319) | today |
| zones.note | Supports attach underneath: turn the view (Bottom view) to paint where they are. | 支撐多半接在下方：轉動檢視（底視圖）即可在支撐所在處塗刷。 (zh:139) | サポートは主に下側に付きます：ビューを回して（下面図）、サポートのある場所を塗ります。 (ja:135) | today |
| zones.clearAll | Clear all zones | 清除全部區域 (zh:286) | すべてのエリアを消去 (ja:282) | today |
| zones.clearAll.hint | Clear every no-support zone of this object at once. Undo brings them back | 立即清除此物件所有的免支撐區。復原可找回 (zh:315) | このオブジェクトのサポート禁止エリアをすべてすぐに消去します。「元に戻す」で復元できます (ja:311) | today |
| zones.done.hint | Finish painting zones (Esc or Enter) | 結束塗刷區域（Esc 或 Enter） (zh:324) | エリアの塗装を終了します（Esc または Enter） (ja:320) | today |

Strings retired by this document **[change]** (keys can be deleted once unused): "Enter Support Edit
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
| Advanced: Preview mode (Full / Only tip), Low poly mode, Resolution, Auto snap, Remove radius | 進階：預覽模式（完整／僅支撐頭）、低面數模式、解析度、自動吸附、移除半徑 | 詳細：プレビューモード（フル／先端のみ）、ローポリモード、解像度、自動スナップ、削除半径 | SettingsPanel.tsx:142–147, 203 |
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
| zones | Painting no-support zones · {object} | Paint where supports must not grow; drag on the model. | 在不要長出支撐的地方塗刷：在模型上拖曳。 (zh:288) | サポートを付けたくない場所を塗ります：モデル上をドラッグします。 (ja:284) |
| edit → setup | — | Support edits kept. | 已保留支撐編輯。 (zh:102) | サポートの編集を保持しました。 (ja:99) |
| zones → setup | — | No-support zones kept. | 已保留免支撐區。 (zh:291) | サポート禁止エリアを保持しました。 (ja:287) |
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
| Edit mode chrome | frame 1 px `--red`; badge fill `--red`, text surface | Support Edit Mode only. |
| Zones mode chrome | frame 1 px `--blue #1d3461`; badge fill `--blue`, text surface | No-support zones only. |
| 3D marks | behaviour spec §6 (selected supports `#a8243c`, preview `#7f0019` @ 0.45, zone layer `#1d3461` @ 0.7 / 0.3, check markers `#b3261e` / `#d97706`) | Content, not UI accent. |
| Drag over circle | Select: 1.5 px `--red` border, red 8 % fill; Unselect: 1.5 px `--ink` border, ink 8 % fill, plus a "−" badge at the cursor **[new]** | Instant feedback when Shift flips the action. |

### 7.2 Focus-mode dimming (locked regions)

| Property | Value | Why |
|---|---|---|
| `inert` | on each locked section (not on the panel when it holds the live Exit button) | Removes the subtree from tab order, pointer hits and the accessibility tree in one attribute. |
| `opacity` | `.45` on locked sections | Clearly weaker than a disabled button (`.55`), still readable to orient. |
| `transition` | `opacity var(--dur)` (0.15 s); none under `prefers-reduced-motion` | Matches the house duration. |
| `pointer-events` | implied by `inert`; the optional click catcher is a transparent `div` with `aria-hidden="true"` | A click on a locked area repeats the lock note in the status line. |
| `aria-disabled` | not used for locked regions (only for Tips only while forced, today) | `inert` already hides them; `aria-disabled` is for a focusable control that explains itself. |
| Lock note | full opacity, `--fs-sm`/11.5 px muted ink, sticky at the panel top, not inert | Says why and how out. |
| Exit button in a locked left panel | full opacity, pressed (ink fill, paper text), never red | Red stays Done alone. |
| Cursor | default over locked regions (no `not-allowed` wall) | `inert` content takes no hover anyway. |

### 7.3 Viewport chrome

- Frame: `position: absolute; inset: 0; border: 1px solid` mode colour; `pointer-events: none`.
- Badge: top-left, same height and text size as the bar buttons (13 px, 8 × 12 px padding), mode
  colour fill, `role="status"`; parts: mode name, object name (80 % opacity), what a click does (500).
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
- In a mode, Tab still toggles Support Edit Mode (today) and is swallowed in zones (today); keyboard
  users move with Shift+Tab / the browser's focus keys only within live regions, since locked
  sections are inert.

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
control (P7). Keys typed into inputs are ignored (today).

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
| D9 | Add tool: Remove radius number field bound to `eraseRadius` | EditBar.tsx (new row), SettingsPanel.tsx:147 kept | small |
| D10 | Select tool: Select / Unselect switch moves directly under Drag over next to Circle size; Shift held flips it; circle and cursor badge follow; badge text per effective action | EditBar.tsx:44–60, CirclePreview.tsx, useScreenBrush.ts, styles.css:538–544 | medium |
| D11 | Click method copy: badge and hint say click toggles; Shift+click / Ctrl+click toggle the same | EditBar.tsx:15, 45; pick.ts:57 already toggles regardless of modifiers | small |
| D12 | Fix button secondary; Delete objects, Remove supports, Clear manual edits `.danger` | ProblemList.tsx:24, ObjectList.tsx:39, App.tsx:841–842 | small |
| D13 | Command registry + UI state machine as framework-free modules; components render from them | new `src/editing/commands.ts`, `uiMachine.ts` | large |
| D14 | Retire strings (6.2), add new strings (6.2, 11.7), update glossary `ZONE_TEXTS` | locales, glossary.ts:134–140 | small |
| D15 | Behaviour spec §1, §7 and ui-spec heuristics rows 3, 4 updated to the sibling modes | docs | small |
| D16 | Per-support settings and context-sensitive right panel **[feature]** | section 11 | large |

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
3. Viewport: a thin dark-red 1 px frame around the whole viewport; top-left a dark-red badge "SUPPORT EDIT MODE  bust.stl  Click the model to add supports"; top-right a light tool bar with hairline border: row 1 segmented "Add supports | Select supports" (Add chosen); row 2 a small number field "Remove radius 1.5 mm"; row 3 key hints "Right-click / Ctrl+Click remove", "Ctrl+Z undo"; row 4 a dark-red primary "Done  Esc". View buttons "Tips only", "Fit view", "Bottom view" move to the bottom right. A translucent ghost support tip follows the cursor on the model.
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
4. Viewport: thin deep-navy 1 px frame; top-left a deep-navy badge "PAINTING NO-SUPPORT ZONES  bust.stl"; top-right tool bar: row 1 segmented "Paint | Erase" (Paint chosen) and a slider "Brush size 2.0 mm"; row 2 muted note "Supports attach underneath: turn the view (Bottom view) to paint where they are."; row 3 "Ctrl+Z undo", red-outline "Clear all zones", dark-red primary "Done  Esc". The model shows a translucent deep-navy painted patch; only the small support tips are drawn. Bottom right "Tips only" shown pressed, then "Fit view", "Bottom view".
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

## 11. Feature: context-sensitive right panel and per-support settings

**Status: feature, to build after the layout work — needs per-support override data in `PrintUnit`
and `SupportJob`.** Owner + controller ruling of 2026-10-22, owner agreed in principle.

### 11.1 Today (verified)

- One settings object per object: `PrintUnit.settings` (state/project.ts:29). A settings change
  writes `settings/set` to every target object (selected objects, else all) (App.tsx:521–525,
  515–519); placement keys schedule a regeneration (App.tsx:65–67, 432–440, 528).
- Every support of an object, automatic and manual, is built from that one object: `supportJobOf`
  passes `settings: resolveSettings(unit.settings)` and all contacts (`manual` included) in one job
  (unitSupports.ts:109–119, 74–76; `SupportJob.settings` core/jobs.ts:39). A manual contact stores
  only id, region, position, normal, source (core/analysis/types.ts:13–19).
- **So today: changing any right-panel value rebuilds every support of the object, manual supports
  included, from the object's settings.** Bracing is built across all columns of the object at once
  (core/supports/mesh.ts:225, `trussSegments` 456–480, which also reads `pillarDiameter`).

### 11.2 Rules (owner)

1. The right panel has an always-visible context header:
   - No support selected, or outside Support Edit Mode → **"Default settings · untouched supports"**:
     changes apply only to automatic supports the user has not altered.
   - Support Edit Mode with a selection → **"Settings for {n} selected"**: changes apply to the
     selected supports only; all get the same value; a field whose values differ shows **"—"**
     until set.
2. Added (manual) supports freeze the settings in force when they were added. Supports whose
   settings were edited keep their own values. Later default changes and Regenerate never touch
   either. To change them: select in Support Edit Mode and edit.
3. Selection action **"Reset to defaults"** clears per-support settings of the selected supports
   (they follow the defaults again).
4. Per-support settings are the support's own shape only: contact shape, tip section, plate width
   (Cross), tip profile, point Ø, contact Ø, penetration, contact depth, upper Ø, connection length,
   connection angle (Contact tip group), middle Ø (Pillar), bottom Ø and bottom thickness (Foot).
5. Object-wide settings are disabled while supports are selected, with a hint why: Preset, Lift
   height, Roof / cage, Auto placement (spacing, overhang angle, downward faces, islands, reinforce
   overhang edges, ridge angle, tree supports), Tree supports group, **Bracing (object-wide in code:
   braces join neighbouring pillars, mesh.ts:225)**, Raft, Roof, Cage, Letter label, Advanced
   (preview mode, low poly, resolution, auto snap, Remove radius).
6. Altered and added supports get a subtle marker in Support Edit Mode.
7. Support Edit Mode: left panel locked, right panel live (it edits the selection or the defaults);
   zones mode: both panels locked (4.4).

### 11.3 Wireframes (right panel, 300 px)

```text
+-------------------------+   +-------------------------+
| A: no support selected  |   | B: Edit, 37 selected    |
+-------------------------+   +-------------------------+
| SUPPORT SETTINGS  bust  |   | SUPPORT SETTINGS  bust  |
| Default settings .      |   | Settings for 37         |
| untouched supports      |   | selected  [Reset to     |
| Changes apply only to   |   |            defaults]    |
| automatic supports you  |   | Changes apply to the    |
| have not changed.       |   | selected supports only. |
| Preset [Lt|=Md=|Hv|Cu]  |   |░Preset [Lt|Md|Hv|Cu]    |
| Lift height    5.0 mm   |   |░Lift height    5.0 mm   |
| Roof/cage [=Off=|Rf|Cg] |   |░Roof/cage [Off|Rf|Cg]   |
| v Auto placement        |   |░> Auto placement        |
|   Support spacing  3.0  |   |░> Tree supports         |
|   Overhang angle   50   |   | v Contact tip           |
|   [x] Downward faces    |   |   Shape [None|Sphere]   |
|   [x] Islands           |   |   Point dia.   --  mm   |
| v Contact tip           |   |   Penetration 0.30 mm   |
|   Shape [=None=|Sphere] |   | v Pillar                |
|   Point dia.  0.40 mm   |   |   Middle dia. 1.20 mm   |
| > Pillar                |   | v Foot                  |
| > Foot                  |   |   Bottom dia. 3.00 mm   |
| > Bracing               |   |░> Bracing               |
| > Raft                  |   |░> Raft                  |
| > Letter label          |   |░> Letter label          |
| > Advanced              |   |░> Advanced              |
| EXPORT STL              |   | EXPORT STL              |
| [Active obj + model ]   |   | [Active obj + model ]   |
| [Active, supports   ]   |   | [Active, supports   ]   |
| [Each obj + model   ]   |   | [Each obj + model   ]   |
| [Each, supports     ]   |   | [Each, supports     ]   |
| [Whole plate, 1 file]   |   | [Whole plate, 1 file]   |
+-------------------------+   +-------------------------+
```

Notes: the header band is the first row under the title in both states, never scrolls away
(sticky). In B, disabled groups stay visible (faded, closed) so the panel does not jump; each carries
the hint "Applies to the whole object. Clear the selection to change it." Export stays live. Reset to
defaults is a secondary button in the header band (it acts on the selection, so it lives with the
selection's settings, not in the edit bar). "Adjust" from the owner's earlier list is this panel,
not a button.

### 11.4 Data shape (proposal)

```ts
/** The settings one support may own (11.2 rule 4). */
type SupportShapeKey =
  | 'contactShape' | 'tipSection' | 'tipCrossWidth' | 'tipProfile'
  | 'pointDiameter' | 'touchDiameter' | 'pointDepth' | 'touchDepth' | 'neckDiameter'
  | 'neckLength' | 'maxNeckAngle' | 'pillarDiameter' | 'baseDiameter' | 'baseHeight';
type SupportShapeSettings = Pick<LiveSupportSettings, SupportShapeKey>;

interface SupportPoint {             // core/analysis/types.ts, manual contacts
  // …existing fields
  /** Manual only: the shape in force when it was added (frozen snapshot, all keys). */
  shape?: SupportShapeSettings;
}

interface PrintUnit {                 // state/project.ts
  // …existing fields
  /** Per-support edits by contact id (automatic or manual); only the keys the user set. */
  overrides: Record<string, Partial<SupportShapeSettings>>;
}

type SceneCommand =
  | …
  | { type: 'overrides/set'; unitId: string; contactIds: string[]; patch: Partial<SupportShapeSettings> }
  | { type: 'overrides/reset'; unitId: string; contactIds: string[] };
```

Effective shape of a contact = object defaults ← manual snapshot (`shape`) ← `overrides[id]`.
"Reset to defaults" removes `overrides[id]` and, for a manual contact, replaces its snapshot with the
current defaults (so it follows them from then on is **[confirm]**: alternatively a manual support
keeps a snapshot and Reset re-snapshots the defaults of that moment). `SupportJob.contacts` gains
`shapes: Record<id, SupportShapeSettings>` (resolved per contact by `supportJobOf`, so the worker stays
dumb); `buildSupportMesh` reads each column's shape instead of `settings` for the shape keys.

Build rules to settle in the feature's own spec: braces between pillars of different Ø (use each
pillar's own Ø at its end; `trussSegments` uses `settings.pillarDiameter` for its distance test
today); tree merging (a support with its own shape is kept out of tree merges, proposal); automatic
contact ids across Regenerate (overrides on an automatic contact whose id no longer exists stay
stored and inert, like `deleted` ids today, unitSupports.ts:80–92).

### 11.5 Undo

`overrides/set` and `overrides/reset` are scene commands, so they go through history like every
edit: one undo step per field commit (number field Enter / blur, choice click), and one per Reset.
A burst of typing in a number field commits once (today's field rule). Inside Support Edit Mode the
undo floor applies (Undo stops at the scene the mode was entered with). The manual snapshot is part
of `manual/add`, so undoing an add removes it with its snapshot. Selection is view state and never in
history (today).

### 11.6 Port

The data (`overrides`, `shape`), commands and the resolve function (`effectiveShape(unit, contact)`)
live in `state/` and `core/`, framework-free; the mixed-value rule (`fieldValue(selection) →
value | 'mixed'`) and the disabled-while-selected rule are registry rules (`enabled` of each setting
command reads `sel > 0` and the key's scope). Babylon renders the same.

### 11.7 Copy (proposed, all **[new]**)

| en | zh-Hant | ja |
|---|---|---|
| Default settings · untouched supports | 預設設定 · 未調整的支撐 | 既定の設定 · 未変更のサポート |
| Changes apply only to automatic supports you have not changed. | 變更只會套用到你尚未調整過的自動支撐。 | 変更は、まだ手を加えていない自動サポートにだけ適用されます。 |
| Settings for {n} selected | 已選取 {n} 個支撐的設定 | 選択中のサポート {n} 本の設定 |
| Changes apply to the selected supports only. | 變更只會套用到選取的支撐。 | 変更は選択中のサポートにだけ適用されます。 |
| — (mixed values; field hint:) Selected supports have different values. Enter a value to set them all. | 選取的支撐數值不同。輸入數值即可全部設為相同。 | 選択中のサポートで値が異なります。値を入力するとすべてに適用されます。 |
| Applies to the whole object. Clear the selection to change it. | 這項設定套用到整個物件。清除選取後即可變更。 | この設定はオブジェクト全体に適用されます。選択をクリアすると変更できます。 |
| Reset to defaults | 恢復預設 | 既定に戻す |
| Give the selected supports the default settings again. Undo brings their own values back | 讓選取的支撐改回預設設定。復原可找回原本的數值 | 選択中のサポートを既定の設定に戻します。「元に戻す」で元の値を復元できます |
| Supports with their own settings are marked. (marker legend, edit bar row 3) | 有自訂設定的支撐會加上標記。 | 個別の設定を持つサポートには印が付きます。 |

Glossary check: 支撐 / サポート (counted 本), 刪除 vs 移除 unaffected, 復原 / 元に戻す.

---

## 12. Owner-confirmable rules and open questions

| # | Rule | Default in this document |
|---|---|---|
| C1 | Remove the header Generate (duplicate, second red button) | removed |
| C2 | Exit button stays live inside the locked left panel in both modes | live |
| C3 | Header stays live in zones focus mode (language, Undo / Redo, Hide models, Wireframe) | live |
| C4 | File drop on the viewport is refused while a mode is on (today it ends the mode and imports) | refused |
| C5 | Remove radius: drop the right-panel field once the Add bar has it | keep both for now (one registry control) |
| C6 | Viewport primary keeps the word "Done" (left button says "Exit …") | "Done": says the work is kept |
| C7 | Reset to defaults on a manual support: follow defaults from then on, or re-snapshot | follow defaults |
| C8 | A support with its own shape is kept out of tree merges | kept out |
| C9 | Edit-mode right panel live (owner ruling of 2026-10-22, recorded for completeness) | live |

Open questions: how automatic contact ids behave across Regenerate (11.4); ja width of the new Drag
over row (7.6).

---

## Appendix A. Verified against the code (`acd3f98`)

Paths under `src/` unless noted.

| Item | Location |
|---|---|
| Header: brand, subtitle | App.tsx:800 |
| Language switch | App.tsx:802; i18n.ts:14–18 |
| Undo / Redo buttons and hints | App.tsx:804–805 |
| Hide / Show models, Wireframe / Solid | App.tsx:808–809 |
| Header Generate (shared button) | App.tsx:796, 811 |
| Left panel container | App.tsx:815–850 |
| Import drop zone, picker, help | App.tsx:816–820 |
| Objects list, rows, Select all, Delete | ObjectList.tsx:22–41 (row 28–33, Select all 38, Delete 39); App.tsx:821–828 |
| Transform Select / Move / Rotate, disabled in a mode | App.tsx:829–836 |
| Mode sections (order before Supports) | App.tsx:837; ModeEntry.tsx:13–36 |
| Edit supports section, button, help | ModeEntry.tsx:23–27 |
| No-support zones section, Painted / None, button, Clear, help | ModeEntry.tsx:28–34; ZonesBar.tsx:12–14 |
| Mode button labels, hints, enabled rules | editing/modeButtons.ts:17–28 |
| Supports group: Generate / Regenerate, Clear manual edits, Remove supports | App.tsx:838–843 |
| Remove supports ends the mode | App.tsx:531–536 (leave at 532) |
| Check supports, findings, help | App.tsx:844–849; ProblemList.tsx:9–28 (Fix primary at 24) |
| Fix ends / enters the mode; refused in zones | App.tsx:562–575 (565, 567) |
| Import ends the mode | App.tsx:497 |
| Viewport classes per gesture | App.tsx:82–88 |
| View group Tips only / Fit view / Bottom view | App.tsx:881–886; editing/view.ts:117–136 |
| Circle size preview | App.tsx:887; viewport/CirclePreview.tsx:11–28 |
| Drop overlay, job activity, toast region | App.tsx:888–892; JobActivity.tsx:46–101; UndoToast.tsx:10–36 |
| Setup overlays: object name, viewport Edit supports button, unit note | App.tsx:893–896; ModeEntry.tsx:39–45 |
| Zones bar | App.tsx:898; ZonesBar.tsx:20–49 |
| Edit bar: badge texts, tools, Click / Drag over, Circle size, Select / Unselect, key hints, Edit no-support zones →, selection actions, Done | App.tsx:899; EditBar.tsx:13–17, 33–37, 40–43, 44–56, 57–60, 64–65, 66, 67–71, 72 |
| Right panel title, help, settings, export | App.tsx:901–917; SettingsPanel.tsx:171–209, 40–150 |
| Remove radius setting (limits 0.1–50, default 1.5) | SettingsPanel.tsx:147; core/supports/settings.ts:208, 272 |
| Export kinds | App.tsx:73–79, 912–916 |
| Footer counts and status line | App.tsx:919–925 |
| Session state, events, reducer (zonesReturn, openZones from edit) | editing/session.ts:10–47, 54–72, 89–125 |
| Keyboard rules | editing/keys.ts:46–63; App.tsx:752–777 |
| Gesture kinds | editing/gesture.ts:10–28 |
| Status lines per gesture, busy, heavy | editing/status.ts:9–15, 21–27, 40–64 |
| Pick: click toggles regardless of Ctrl / Shift | editing/pick.ts:49–70 (57) |
| Undo toasts | editing/toast.ts:11–41 |
| Selection clear / delete handlers | App.tsx:666–671, 695–704 |
| Busy refusal on object click in a mode | App.tsx:577–583 |
| Settings change applies to target objects, regeneration | App.tsx:65–67, 432–440, 515–529 |
| One settings object per unit; manual contacts | state/project.ts:23–37; core/analysis/types.ts:13–19 |
| Support job: one settings object, all contacts | supports/unitSupports.ts:74–76, 109–119; core/jobs.ts:35–44 |
| Bracing across all columns | core/supports/mesh.ts:225, 456–480 |
| Glossary, zone-only words, zone texts | glossary.ts:103–140; docs/migration/glossary.md |
| Styles: primary, danger, regen, disabled | styles.css:46, 51–57 |
| Styles: header 56 px, workspace 268 / 1fr / 300, footer 32 px | styles.css:60–79, 80–86, 406–419 |
| Styles: edit frame, badge, bar, zones colours, view group move | styles.css:215–228, 232–279, 461–464 |
| Styles: Tips only forced look | styles.css:454 |
| Styles: Drag over circle | styles.css:285, 538–544 |
| House tokens | `~/.claude/skills/mixo-app-style/tokens.css`, `base.css`, `SKILL.md` |
| Stitch DESIGN.md location and sections | `~/.claude/skills/stitch/references/design-md.md`, `flows/design.md` |
