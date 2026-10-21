# UI spec and NN/g heuristics check (Release 2)

The UI spec for re-implementing the support editor (state diagram, key / pick / stroke tables,
status keys in three languages, colours, numbers, conventions, Babylon adapter, and the Task 12
feedback rules) is `docs/superpowers/specs/2026-10-21-support-editing-ui-spec.md`. Terms:
`docs/migration/glossary.md`. This page maps Nielsen's 10 usability heuristics to what the UI
does, for the final review.

| # | Heuristic | How the UI meets it | Where |
|---|---|---|---|
| 1 | Visibility of system status | Status line for every step (tool in use, what a click did, counts); mode frame + badge naming mode and tool; progress bar per worker job; Tips only shows pressed (and why it is disabled) below the plate; selected count in the edit bar | spec §5, §6; `editing/status.ts` |
| 2 | Match between system and the real world | Printing words from slicers (Chitubox/Lychee names in hints), millimetres, "build plate", one glossary term per concept in en / zh-Hant / ja, add-on wording | `docs/migration/glossary.md`, settings hints |
| 3 | User control and freedom | Undo / Redo everywhere (Ctrl+Z, buttons), undo floor per mode, Esc / Done leaves a mode, destructive clears run at once with an Undo toast, Esc first drops a selection | spec §1, §2, §11 |
| 4 | Consistency and standards | One stroke machine for Drag over and zones; Paint / Erase / Brush only for zones, Select / Drag over / Size for picking; same Done + Esc in both modes; red = selected / about to go, blue = zones | spec §3, §4, §6; glossary test |
| 5 | Error prevention | Zones mode blocks edits to supports; Enter on a focused control is not Done; number fields clamp to limits instead of accepting bad values; a press only strokes from the object; actions disabled when they cannot apply | spec §2, §11; `editing/numberInput.ts` |
| 6 | Recognition rather than recall | Hints on every tool button, slider and setting; shortcut keys shown on the buttons (`Esc`, `Ctrl+Z`, Right-click); the badge names the tool; contextual actions only when they apply | `hints.test.ts`, spec §11 |
| 7 | Flexibility and efficiency of use | Keyboard shortcuts (Tab, Esc, Enter, Delete, G, R, Ctrl+Z/Y); Drag over with gap fill for many supports; forgiving number input with Arrow Up / Down; presets | spec §2, §4, §11 |
| 8 | Aesthetic and minimalist design | mixo-app-style: paper, hairlines, one red; tool options appear only for the current tool; dense rows | mixo-app-style skill |
| 9 | Help users recognise, diagnose and recover from errors | Every failure says what happened and what to do next, translated by error code; "No support here: right-click a support, or the model within … mm"; check findings with Show me and Fix | spec §11; `editing/errors.ts` |
| 10 | Help and documentation | Hover hints and the help lines under each panel section; the UI spec and glossary for re-implementers. Deferred by the owner: first-run tour, shortcut list, presets / basic-advanced split | spec; plan Task 12 |
