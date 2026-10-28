# Folder review

Check a whole folder of aligner STLs on your own computer, without the app and without AI. Every STL goes through the same steps the app runs in dental mode, and a viewer then shows each result in 3D next to its numbers.

**Review only.** Dental mode is not clinically validated. A result that looks right still needs a person to check it before printing.

## Run it

1. Once per computer: install Node.js 22 and run `npm ci` in the project folder. The first run also builds the geometry engine (a minute or two).
2. Double-click `run-batch-review.bat` and choose the folder in the window that opens, or drag one or more folders onto it in File Explorer. Subfolders are included. If you close the window without choosing, it asks for a folder path to paste instead.
3. The window prints one line per file. When it ends, the viewer opens in your browser. Keep the window open while you look; close it when you are done.

To look at an earlier run again, double-click `view-batch-review.bat` (it opens the newest run) or drop a `batch-...` folder from `dentalwork/output` onto it.

Command line, from the project folder:

```powershell
npx vite-node --script dentalwork/batch-review/batch.ts --out dentalwork/output/batch-test "D:\aligners\week-42"
node dentalwork/batch-review/serve.mjs dentalwork/output/batch-test
```

## What you get

`dentalwork/output/batch-<date>-<time>/` holds:

- `case-001.glb`, `case-002.glb`, ...: one 3D review per file that could be built. The files are numbered, so a patient name in an STL file name never ends up in a GLB.
- `summary.csv`: one row per file, for a spreadsheet. `summary.json`: the same rows for the viewer.

`dentalwork/output` is ignored by Git: the GLBs are patient geometry and the summary lists the original file paths. Do not commit or share them without the owner's approval.

## Reading the viewer

Turn the view below the floor (or press Bottom view) to see the aligner and its support tips only: the rest of the supports and the raft hide while the camera is under them.

The left list starts with **Needs a look**: every file that was not built, whose safety check is not `clear`, that has a low point with no support, or whose edge coverage has a gap to review. **All** shows every file. Arrow keys or Previous / Next step through them.

The right panel gives the numbers for the selected file:

| Line | Meaning |
|---|---|
| Result | `built`; `inconclusive` (the detector or the build could not decide, with the reason); `error` (the file could not be read) |
| Safety check | `clear`, `blocked` (a support cuts through the aligner) or `inconclusive` (could not decide) |
| Supports crossing the aligner | Places where a support cuts through: red markers |
| Crossings not judged | Crossings that had no face to judge against: amber markers |
| Low points with no support | Low points inside the support area that no support reaches: purple markers |
| Low points outside the area | Low points outside the support area, for information: blue-grey markers, off by default (see [open decisions](../open-decisions.md)) |
| Print angle | The tilt the app's Step 1 picks (degrees), its stable band, and whether the confirm build at that tilt passed |
| Structures left out | `brace` or `tree` when the repair switched them off because they crossed the aligner; `none` otherwise. New aligners start with Brace on and Tree off |
| Tips placed / left out | Automatic tips built, and tips left out by the repair |
| Largest gap, outer edge / opening | The longest stretch of each rim without a tip, in mm |
| Edge coverage needs review | A gap longer than twice the normal spacing |

Layers you can switch on and off:

- **Support area** (teal): where tips may go. **Rest of the aligner** (white).
- **Outer edge, detected** (blue), **joining paths** (green), **Inner opening edge** (red): the edges the detector found. Check that they follow the real trim line and the opening.
- **Supports** (gold) and **Support tips** (orange).
- **Markers** (red, amber, purple; blue-grey for low points outside the area, off by default), drawn on top of everything so they show through the supports.
- **Diagnostic** layers, off by default: the strips on each side of the detected edges and the sample points used to find them.

Views: **Fit view**, **Top view** (look down on the support area), **Bottom view** (the raft side) and **Side view**. Drag to turn, scroll to zoom, right-drag or Shift-drag to pan.

## What to record

For each file, write down whether the edges and the support area are right, wrong or unclear, and whether any marker is a real problem. Send the case numbers and your notes, not the STLs, unless the owner has approved sharing the files.

## Files

| File | Role |
|---|---|
| `run-batch-review.bat` | Runs a folder, then opens the viewer |
| `view-batch-review.bat` | Reopens a finished run |
| `batch.ts` | Runs each STL through `scripts/dental-region-review/build.ts` (the app's detector, placement and Rust `generate`) and writes the GLBs and the summary |
| `serve.mjs` | Serves the viewer, three.js and the run's files on 127.0.0.1 only |
| `viewer.html` | The viewer |
| `tokens.css`, `base.css` | Mixo app style, copied unchanged from the `mixo-app-style` skill |
