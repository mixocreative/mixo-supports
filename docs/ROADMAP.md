# Roadmap after the ship (from 2026-10-28)

The plan for what comes next. [SHIP-PLAN.md](SHIP-PLAN.md) records what was built. This file holds the decisions and, for each step, its specification. **Rule: a step is built only from a written specification here.** A step marked *spec before start* gets its specification written (and reviewed) before an agent starts it; the implementer does not make design decisions that are not written down.

Reviewed 2026-10-28 by three EGM reviewers (implementation readiness, scope, code accuracy), twice (the second round with V1, R, F and S3 rewritten); their findings are folded in.

## Principles (owner)

1. All 3D work in Rust; TypeScript only hosts. Everything reusable by generic (non-dental) mode and by a future host app.
2. Every decision about size or spacing is in millimetres, never in counts of faces, edges or pixels.
3. Everything the user changes shows live.
4. A stable print comes first; keeping tips off the fitting (tooth-facing) surface comes second.
5. The owner's example (`dentalwork/fixtures/case-001/ideal-supported.stl`) guides only where tips go, the support and contact sizes and the print angle. The structure (Tree, Brace) is ours and is meant to be better than the example, so it differs (owner, 2026-10-28).
6. Evidence before optimisation: a performance or accuracy step starts only when a measurement shows the problem.

## Decision log

Decided (by the owner unless noted):

| # | Decision | Where it applies |
|---|---|---|
| D1 | Tips may sit on the fitting side within `tipMoveMaxMm` (1 mm) of the area when the outer side cannot be reached from below. Forbidding it is infeasible at every tilt 24–68° on the reference (analysis 2026-10-28). | unit D (built), F |
| D2 | Print angle: per aligner type a start tilt and a tilt range; reference type 46° ± 22°. No side-roll search. | F |
| D3 | Tree and Brace on by default for dental (reverses the unit C preset). | S3 |
| D4 | Step 3 is the live adjust step: its controls rebuild live; no separate Adjust screen (lead, from the scope review; matches the owner's intent). | S3 |
| D5 | Step 2: hidden suggested tips over all reachable overhangs, revealed by paint; tools Paint, Erase, Add, Select (delete only); belt sliders re-space evenly; density only in Step 2. | B2, B3 |
| D6 | The example guides tip placement, support and contact sizes and the print angle only; the structure (Tree, Brace on by default) differs on purpose (owner, 2026-10-28; replaces "close to the example"). | all |
| D7 | Blocked verdict marks real crossings only; the automatic repair re-aims or leaves out crossing necks (built: 09c81be, 836d445). | built |
| D8 | Low points outside the support area are information only (lead decision, reversible). | built |
| D9 | The mesh check stays strict; a separate "repair mesh" step only if real files need it. | evidence |
| D10 | Generate time limit stays 120 s. | built |
| D11 | A lift change keeps the generated tips, necks and landings exactly and only moves what reaches the plate (lead decision, reversible). Two fresh generates at different lifts differ (the landing remesh grid follows the build frame: tips up to 2.1 mm apart), so "equal to a fresh generate" holds only on the exact surface. | L |
| D12 | No synthetic test aligners: the generated shapes are too unrealistic to use (owner, 2026-10-28). The V1 generator (f717d61) was removed. Its one finding, kept for P2 and real files: the outer-ridge detector needs a trim that is sharp along part of its length; a trim that is sharp all the way round (two closed sharp loops) is refused with `outer-ridge-not-closed`. | V |
| D13 | Folder review: with the camera below the floor (the bottom of the supports and raft) the viewer shows only the aligner and its support tips (owner, 2026-10-28; built). | review |
| D14 | F is built in full: scan, stable band, slider and the automatic pick with its confirm and retries, slenderness limits 20/35 (owner, 2026-10-28, Q6). | F |
| D15 | F's criteria are the measured reference band (braced 26.46–44.46°, pick 44.46°), not the earlier 35–46° estimate; the example's 46.46° passes but is not robust (cups from 48.46°). Scan once per file off the UI thread, ≤ 5 s; gap rule = `needs_review`; slenderness from the plate at the host's lift, braced per the host's settings (Fable, lead, reversible; prints in V are the real check). | F |
| D16 | Target split (owner, 2026-10-28): mixosupports becomes dental-only; mixomesh becomes the generic 3D tool with auto supports. Electron stays (it provides automation, batch jobs, a 4 GB heap, file opening and publishing; WASM runs inside it). Shared: the WASM engine, the framework-free editing logic and the style tokens, not UI components (Fable, EGM-reviewed). | After H |
| D17 | No real aligners besides the reference for now: step V is skipped and the remaining steps go on best guesses from the reference alone (owner, 2026-10-28). O moves to deferred until a no-opening file exists (lead: nothing to test it on). | V, O |
| D18 | The app starts on a full-screen start: choose the task, then the aligner type, then the file; built right after S3, before B2 (owner, 2026-10-28; replaces A2's timing). | ST |

Open (owner; Q1, release timing, was answered: pull request #2 merged to `main` as fbac47f on 2026-10-28):

| # | Question | Blocks |
|---|---|---|
| Q2 | Shells from public teeth scans (Teeth3DS+) as extra test files: the data licence is "Other, see license.txt" on OSF. Read it and say whether derived local-only files are allowed.  | V (optional) |
| Q3 | Dental landings without the remesh (P3b): only if a measurement shows the remesh is a problem. | P3b |
| Q4 | Switch the reference type to a curvature contour detector: only if a real file defeats the current one. | P2 |

`dentalwork/open-decisions.md` explains D7–D10 in plain language for the owner.

## State at d28ffd3 (sources)

- Reference aligner at default settings, folder review (`dentalwork/batch-review`, run 2026-10-28 by the unit D agent): 94 tips built, 0 left out, 0 crossings, opening gap 4 mm, outer gap 6 mm.
- Step 2 slider to tip preview 330–339 ms; Step 3 change to preview 1.6–3.0 s, lift 1.25 s after L (E1 bench `scripts/perf/live-bench.mjs`, headless Chromium, median of 3, machine shared with another job). Most of a rebuild is the repair loop: about 5 trials of 0.19 s build + 0.07 s check.
- `dentalwork/perf-baseline.json` is the **pre-port** comparison (dental Generate 12.2 s, 117 contacts) and stays as history; current numbers go to a new file (step R).
- Pull request #2 merged to `main` (fbac47f, deployed 2026-10-28). Merges to `main` deploy.

## Verification tiers

- **Engine or ABI step**: `~/.cargo/bin/cargo test --workspace`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run walk`, the locale walk, a folder review of `dentalwork/fixtures/case-001`.
- **UI-only step**: `npx tsc --noEmit`, `npx vitest run`, `npm run walk`, the locale walk when strings change.
- **Docs-only step**: none.
- Every step: docs updated, one line in the SHIP-PLAN progress table (unit, status, commit, one-sentence summary; details in the commit message), commit and push to `codex/dental-rework`.
- **Goldens**: a step says up front whether goldens may change. A re-record is allowed only when the step says so; the commit message lists each changed golden and why, and the lead checks the diff before pushing.

## Steps in order

### V. Validation on real aligners (owner, in parallel, starts now)
Owner runs `dentalwork/batch-review/run-batch-review.bat` on 10–20 real aligners (upper and lower, with and without a central opening, attachments, different trim styles, files from more than one design program) and prints 3–5 at the default settings on the owner's printer and resin, checking that supports hold and the parts fit. Sends case numbers and notes. Outcome decides whether O, P2 and the F thresholds need work. 

### L. Lift as a plate offset (done)
Lift moves the plate, not the model, so a lift change keeps the model-space caches. Goldens must not change. Done when: a lift change through the offset equals a fresh generate at that lift (within 1e-5 mm; same components, contact ids and verdicts); the session keeps the same mesh handles across the change (handle count asserted); lift-change time before and after with `scripts/perf/live-bench.mjs`. Time-box: if not done within the unit, stop and report.

### R. Repair loop cost (done)
Result: the reference spends 1 trial at the Step 3 defaults and 3 at the default settings (the earlier "about 5" came from another pose and rim); no no-op trial found; dental generate about 1200 -> 1060 ms; goldens unchanged. `step2SliderMs` is one Area width step (region proposal + placement, no build); the Step 3 keys are `step3PillarDiameterMs`, `step3TipSizeMs`, `step3LiftHeightMs`, `step3RaftToggleMs`. Not covered by the new test: the Tree, Brace and structure fallbacks (no fixture).

Specification as built:
The repair loop (`supports/generate/repair.rs`) spends a trial only after a check finds a crossing (`spend` follows a positive check), so a clean first build costs no trials; the about 5 trials on the reference mean its first build has crossings that the repair then resolves. (1) **Measure**: on the reference at the Step 3 defaults, log per trial which step spent it (Tree fallback, Brace fallback, re-aim normal, re-aim down, alternates round, leave-out, all-manual, structure fallback), how many contacts it touched and its build and check time; record `Outcome.trials`. (2) **Remove repeated work with identical inputs, nothing else**: `review_components` and the collision views are rebuilt for every crossing query on the same `built` (`crossing_necks`, `crossing_structures`), and `crossing_auto` re-runs the neck query that `crossing_necks` already ran on the same `built`; compute each once per `built` (a small per-build memo inside `run`). No change to which trials run, their order or their inputs. (3) **Timings**: `scripts/perf-baseline.mjs` gains `--out <file>` (default unchanged, so `perf-baseline.json` stays as history) and `--check <file>`; `--out dentalwork/perf-current.json` records dental generate, Step 2 slider and Step 3 change times (median of 3, keys `dentalGenerateMs`, `step2SliderMs`, `step3<Control>Ms`); `--check` exits non-zero when any median is over 2x the file's value. Run locally only (not in CI: the machine is shared). Done when: goldens byte-identical; a test asserts the repaired result on the reference and on a blocked fixture is identical before and after; the trial log and generate time before and after are in the commit message. If the log shows a trial whose input is a no-op (for example a re-aim that changes nothing still rebuilding), report it to the lead rather than changing the order.

### F. Print-angle search (done)
Result on the reference (neck 2, pillar 1.4, lift 3.5): braced band 26.46–44.46°, pick 44.46°; unbraced band 26.46–36.46°, pick 36.46° (today's preset, until S3); first crossing 47.46°, first resin trap 48.46°. Browser scan 4.4 s (`tiltScanMs`), Node 3.0–3.5 s. Implementer choices: the WASM call takes an optional progress callback; the scan uses the settings the aligner will be built with; a hand-chosen tilt's one generate is the normal Step 3 generate; if all three confirm builds fail the angle stays at the pick; Next is disabled while scanning or confirming.

Specification as built:
- **Profile** (`dental/profiles/mod.rs`, every struct `deny_unknown_fields`): `pose.tiltRangeDeg` (22), `pose.tiltStepDeg` (1), `pose.tiltMarginDeg` (2); a new required `Stability` struct as `AlignerProfile.stability`: `maxSlendernessUnbraced` (20), `maxSlendernessBraced` (35), `cupProminenceMm` (1.5). Update `reference-aligner.json`, `testdata/second-aligner.json` and the profile parse tests. The start tilt is the existing `pose.tiltDeg`; `headingDeg` and `rollDeg` stay fixed. Fitting-side tips stay allowed (D1); no switch.
- **Tilt**: each scanned pose is the existing target frame (`dental/pose.rs`) with `tilt_deg` replaced; no second rotation formula. Tilts from start - range to start + range in steps of `tiltStepDeg`, start included.
- **Per tilt** (reuse `dental/sampling.rs`, `pose.rs`, `orient.rs`; detection and distance field are pose-independent, so they are cached once): run the real tip sampler with that tilt's up vector, then evaluate four hard rules: (1) **cup**: a vertex that is a local minimum along up (no edge neighbour lower) whose prominence ≥ `cupProminenceMm` and that lies outside the permitted area (the dental policy's allowed area at that tilt); prominence = the smallest rise along up needed to reach, through mesh edges, a vertex lower than it (a global minimum has infinite prominence); (2) **gap**: any rim gap ≥ twice that rim's spacing (`safety/rings.rs` arclength rule; also the folder review's gap trigger); (3) **crossing** (a cheap pre-build test; built supports are still judged by the existing predicates): for each tip, a segment from the tip along its face normal for the neck length, then 5 rays straight down from its end (centre and 4 at pillar radius, 90° apart, the first along the tilt axis) with `core::spatial::Bvh::raycast_first`; any hit on the model, ignoring hits within 0.05 mm of a start and hits on the tip's own source face, is a crossing. Neck length and pillar diameter are scan arguments the host passes from its current support settings; (4) **slenderness**: (tip height above the plate) / pillar diameter above the braced or unbraced limit, braced = profile `supports.tree` or `supports.brace`. Also record the fitting-side tip count, the largest layer cross-section (slices perpendicular to up every 1 mm from the lowest vertex; area = sum of the slice polygons' areas, mm²) and the print height (mm along up, model only).
- **Readings fixed (Fable, after the first build)**: a vertex is permitted if any face touching it is; the permitted area is the strip plus the tip faces; layer area is the sum of |signed area| per slice polygon; **gap** fails exactly when `RingCoverage.needs_review` does (`supports/safety/rings.rs`: max gap > 2 × spacing + 1e-6), no second threshold; **slenderness** height is measured along up from the plate at the host's current lift to the tip, limit braced when the host's current support settings have Tree or Brace on. Scan arguments from the host: `neck_length_mm`, `pillar_diameter_mm`, `lift_mm`, `braced`.
- **Pick**: a tilt is *robust* if it and both tilts at ± `tiltMarginDeg` pass every hard rule. Among robust tilts: fewest fitting-side tips, then smallest |tilt − start|, then smallest largest-layer area, then lowest print height; exact ties go to the lower tilt. No robust tilt: same order over passing tilts. No passing tilt: fewest failed rules, then the same order; a problem-list entry names the failed rules and, per rule, the tilt and the first failing vertex or tip id. The **stable band** is the continuous run of robust tilts that contains the pick (none when no tilt is robust); its ends are its first and last tilts. A tilt whose ± margin neighbour lies outside the range is not robust, so the band cannot reach the range ends.
- **Confirm**: runs on Next from Step 1 (the moment the pose becomes fixed), with the automatic tips at that tilt and the host's support settings. Automatic pick: on blocked, unresolved island or `needs_review` gap, next tilt in pick order, at most two retries; the slider moves to the confirmed tilt and the problem list says "Print angle moved to {n}°". Hand-chosen tilt: one generate, no retries; its verdict shows as usual.
- **ABI**: a `GeometrySession` method `dental_tilt_scan(handle, profile_id, neck_length_mm, pillar_diameter_mm, lift_mm, braced)` in `crates/geometry-wasm/src/dental.rs`, host wrapper in `src/core/analysis/dentalEngine.ts`, returning per tilt (tilt, rule flags, fitting-side count, largest gap mm, largest slenderness, largest layer mm², height mm, and the rotation `dental/pose.rs` produces for that tilt, same fields as the orient result) and the pick with its reason; `engine_version` 6 (L took 5): the Rust test in `geometry-core/src/lib.rs` and `src/workers/geometryVersion.ts` change together.
- **Flow**: the scan runs once per file, after detection, off the UI thread; Step 1 (`src/components/DentalBar.tsx`) shows "Scanning print angles {i}/{n}" until done, then "Print angle {n}° (stable {a}–{b}°)" or "Print angle {n}° (no stable angle)" with a `RangeField` limited to start ± range, step `tiltStepDeg`, the stable band drawn as a track highlight. Moving the slider rotates the preview to that row's pose and shows that row's rule flags under the label; no tip preview in Step 1. Tips appear in Step 2 at the chosen tilt. Problem-list rule names: "resin trap", "gap in the rim supports", "support crossing the aligner", "support too thin for its height". Strings in en, ja, zh-Hant (Taiwan wording through Gemini).
- **Done when**: on the reference (neck 2 mm, pillar 1.4 mm, lift 3.5) the scan reports, braced: band 26.46–44.46°, pick 44.46°; unbraced: band 26.46–36.46°, pick 36.46°; first crossing failure at 47.46°, first cup at 48.46°, no failure below 35°. These are recorded measurements, not targets: a threshold change needs a written reason in the decision log; the lower band end is the margin floor, not a failure. Browser scan ≤ 5 s on the development machine, recorded as `tiltScanMs` in `perf-current.json`; the native breakdown in the commit message. Unit tests on synthetic shapes for each hard rule, the robust rule and the tie rule; the problem-list entry tested.

### S3. Step 3 as the live adjust step (done)
Result: Tree and Brace on by default; braced scan picks 44.46° (band 26.46–44.46°); in the app (centred import) the confirm build finds a rim gap there and moves to 43.5°, as F's rule says. The folder review now centres each mesh as the import does, so it shows the same result: reference clear, 93 tips, 1 left out, gaps outer 6 / opening 8 mm. Goldens unchanged (none is built with the profile preset).

Specification as built:
- **Pillar size**: a `RangeField` in `src/components/DentalSupports.tsx` after "Tip size": label "Pillar size", unit "{n} mm", hint "Diameter of each support pillar", min 0.8, max 2.5, step 0.1, value `settings.pillarDiameter`, `onChange={(v) => onSetting('pillarDiameter', v, 'dental-pillarDiameter')}` (the same path as Tip size). Strings in en, ja, zh-Hant.
- **D3**: `"tree": true, "brace": true` in the `supports` block of `reference-aligner.json` and `testdata/second-aligner.json`; `src/dental/supportPreset.ts` applies them unchanged.
- **Greyed verdict while dragging**: every Step 3 `RangeField` passes `onAdjust`; while adjusting, the Problems section gets `aria-busy="true"` and the class `is-stale` (opacity from the disabled token in the Mixo app style `tokens.css`); the rebuild follows the existing debounce; `is-stale` clears when the new verdict arrives.
- **Goldens**: the dental goldens built with the profile preset re-record once; the commit lists each and its change (Tree/Brace on). Generic goldens unchanged.
- **Done when**: the walk drags each Step 3 control (Tip size, Pillar size, Support density, Lift height; toggles Raft, Tree branches, Cross-braces) and checks a new verdict arrives and `is-stale` clears; change-to-preview time for each recorded in `perf-current.json` (step R's keys); the folder review of case-001 with the new defaults is in the commit message (tips, left out, crossings, structure fallbacks).

### ST. Full-screen start (0.5–1 unit, UI only; goldens unchanged)
Today the generic editor opens first; the dental flow is the command `supports.dentalAuto` ("Aligner Support Production", `src/editing/commands.ts`), whose Step 0 is `DentalTypeStep` (`src/components/DentalSteps.tsx`, one card per `ALIGNER_PROFILES` entry).
- **Screen 1, task**: shown on launch with no model loaded and after closing the last model. Full-screen, two large buttons: "Aligner supports" (primary) and "Any model". A smaller link "Open a saved project" runs the existing open-project command. Any model leads to today's empty generic editor, unchanged.
- **Screen 2, aligner type**: the `DentalTypeStep` cards, full-screen, with a Back button to screen 1.
- **Screen 3, file**: "Open the aligner STL", a file button and a drop zone, with Back to screen 2. A loaded file enters the dental flow at Step 1 with the chosen profile (as `supports.dentalAuto` does, skipping Step 0).
- **Drops**: an STL dropped on screen 1 or 2 is held; the type step follows (from screen 1, as if "Aligner supports" was pressed); choosing the type with a held file goes straight to Step 1.
- **Back from Step 1** returns to screen 2 (the loaded aligner stays until a new file is chosen or the task screen is reached; reaching screen 1 closes it).
- **Keys**: Escape on screen 2 or 3 is Back. Buttons are real buttons (Tab, Enter, Space).
- **Style**: Mixo app style tokens; cards as in Step 0. Strings in en, ja, zh-Hant (Taiwan wording through Gemini).
- **Walk**: new scenarios: screen 1 → Aligner supports → type → load the reference → Step 1 reached; screen 1 → Any model → empty generic editor; a drop on screen 1 → type → Step 1; Back and Escape on each screen. Existing scenarios that load a model keep their assertions; only their entry steps may change. Locale walk: screens 1–3 in each language.
- **Done when**: walk and locale walk green; goldens unchanged; one screenshot per start screen in the commit message.
- **Pinned (review)**:
  - State: `startScreen: 'task' | 'type' | 'file' | null` as `useState` in `App.tsx` (null = editor); a `StartScreen` component (`src/components/StartScreen.tsx`) renders instead of the whole workspace while it is non-null; initial value `'task'`; it returns to `'task'` when `scene.units.length` goes from > 0 to 0 (a `useEffect`).
  - Hand-off: a new session event `startDental {profile: string, file?: File}` sets the gesture to `dental-aligner` for that profile and, with a file, imports it through the same path as the Step 1 upload (`DentalAlignerPrompt.onFiles`). The held file is `useState<File | undefined>` in `StartScreen`. `ALIGNER_PROFILES` is in `src/dental/alignerProfiles.ts`.
  - Back at Step 1 sets `startScreen = 'type'` and leaves the scene untouched; reaching `'task'` removes all units through the existing delete-all path with no undo toast.
  - Drops: `StartScreen` has its own drop handler (the app's `dropImport` is not used while it is mounted): the first `.stl` only, others ignored; other types show the existing unsupported-file toast; a project file goes to `openProject`.
  - Any model sets `startScreen = null`; a successful `project.open` sets it to null; a cancelled picker changes nothing.
  - Escape: `onKeyDown` in `StartScreen` while mounted; screen 1 ignores it.
  - Screen 2 after Back keeps the chosen profile `aria-pressed`.
  - Strings: "Aligner supports", "Any model", "Open a saved project", "Open the aligner STL", "Back", "Drop the aligner STL here"; reuse "Choose the aligner type".

### B2. Suggested tips and even belt spacing (1 unit, engine; dental goldens re-record once)
Known parts: candidates over every face that passes the reachable-from-below rule (`defaults.tipMinFromUpDeg`) in the print pose, at outer spacing × density, in face-index order, ids `dental-fill-K`; `dental-fill-K` **replaces** `dental-paint-K` (`paint_id`, `paint_contacts` and the `PaintFill` call in `contacts_of` are deleted; the fill is the superset). Specified by Fable after an EGM review (2026-10-28):
- **Where**: `crates/geometry-core/src/dental/paint.rs` gains `pub fn fill_candidates(mesh, up: V3, spacing: f64, tip_min_from_up_deg: f64) -> Vec<ContourContact>`: every face whose normal is ≥ `tip_min_from_up_deg` from `up` is sampled with `face_samples` at `spacing`, kept `spacing` apart by `Spacer`, in face-index order; K is the index in this list. `contacts_of` (`policy.rs`) calls it for `DentalArea::TwoContour` only (ManualArea and Legacy unchanged) with `spacing = footprint_settings(tuning, profile).outer_spacing` (already density-scaled; density is `tuning.density`, `tuning[2]` in the wasm ABI) and `up = plate_up(frame)`.
- **Cache**: `cache.rs` gains `KEPT_FILLS` (same `KEPT = 2` and eviction as `detection`) keyed by `FillKey { base: Key (mesh digest + profile id), up_q: [i32; 2], density_q: i32 }`, `up_q = [round(acos(up·Y)/0.25°), round(atan2(up·X, up·Z)/0.25°)]`, `density_q = round(density × 1000)`. The cached list depends only on mesh, up and density: stamps, setback and width never change K.
- **Filter per policy run** (ids kept, gaps allowed): drop a cached candidate that (a) lies on a strip face (`region.contact_faces == 1`), (b) is within `outer_spacing / 2` straight-line 3D (`distance`) of a kept belt tip, (c) is within `min_tip_separation_mm` of any point in the new field `DentalPolicyInput.keep_clear_of: &[[f64; 3]]` (unit-local manual tips; wasm `dental_policy` gains `manual_positions: &[f64]`, the host passes `unit.manual`), or (d) is not **explicitly painted**: `AreaStamp::resolve(stamps, point, Some(normal)) == Some(true)`. `area_allows` (unpainted = allowed) stays for belt contacts only.
- **Belt spacing** (`sampling.rs`): per closed rim, `L = contour_length`, `N = max(3, round(L / s))` with `s = outer_spacing` on the outer rim and `inner_spacing` on the opening rim; primaries at arc `k·L/N`, alternates at `(k+½)·L/N`, from the vertex lowest along `plate_up` (ties: lower vertex index; `ordered_vertices` changes from lowest id to this).
- **Deletions and manual tips**: nothing new in the policy. `compose_contacts` keeps running where it does today: `generic_policy_contacts` (`crates/geometry-wasm/src/generic.rs`) ← `jobContacts` (`src/supports/genericPolicy.ts`) ← `unitContacts` (`src/supports/unitSupports.ts`) with `unit.deleted` and `unit.manual`; the host copies `PolicyResult.candidates` (belt + fill) into `unit.contacts.points` after each rebuild as now. Manual contacts (`manual-*`, `Origin::Manual`) pass `AutomaticRule::MatchCandidates` untested in `generate/permit.rs` (add that branch if absent).
- **Tilt or density change**: `src/dental/flow.ts` gains `dropFillDeletions(deleted) = deleted.filter(id => !id.startsWith('dental-fill-'))`, applied in `confirmTilt.ts` and in the density change path of `useDentalTuning` before `remapDeleted`. Saved `dental-paint-*` deletions are dropped the same way once (migration note in the commit). A manual tip where a fill tip used to be stays and suppresses the new fill candidate by rule (c).
- **Goldens**: the dental goldens re-record once; generic goldens unchanged; the commit lists each changed golden and its tip-count change.
- **Done when**: `dental_reference.rs`: unpainted at defaults → candidates are belt only, 0 crossings, **0 left out**; a second test painting every reachable face → fill count > 0 and left out ≤ 5 % of the fill count, each listed; belt spacing per rim within ±10 % of its `s`; Rust unit tests for N, phase, lowest-vertex tie and skips (a)–(d); walk: paint reveals fill tips within one rebuild, erase hides them.

### B3. Step 2 tools (1.5 units, UI + small engine)
Known parts: Step 2 offers Paint, Erase, Add and Select; Step 3 keeps `EditTools` (`EditBar.tsx`, used by `DentalSupports.tsx`) and loses Paint, Erase and density (D5). Delete stays the existing `edit.deleteSelection` command (`editing/commands.ts`, handler `deleteSelected` in `App.tsx`). Specified by Fable after an EGM review (2026-10-28):
- **Tool model**: `EditTool = 'add' | 'select' | 'paint' | 'erase'`; `DentalKind`, `dentalKind` and `setDentalKind` are removed; `gesture.ts` maps `tool === 'paint'` → stamp `allow: true`, `'erase'` → `allow: false`, radius `dentalRadius`. Select in Step 2 honours `selectStyle` (Click | Drag over) and `brushMode`; `addAction` is forced to `'add'` in Step 2. Entering stage `'area'` sets `tool: 'paint'`; entering `'review'` with paint or erase active sets `'select'`.
- **Commands** (`commands.ts`): `dental.tool.paint|erase|add|select`, enabled when `mode === 'dental' && dentalStage === 'area' && !heavy`.
- **Keys** (`keys.ts`): `const area = mode === 'dental' && ui.dentalStage === 'area'`; P/E/A/S (no Ctrl) run the four commands when `area`; Delete/Backspace → `edit.deleteSelection` when `(area || reviewing) && hasSelection`; Escape: first `edit.clearSelection` when `(area || reviewing) && hasSelection`, else `dental.exit`.
- **Add**: `clickReach` is the setting `setting.clickReach` (`activeSettings.eraseRadius`, mm; `ClickReachField` in `EditBar.tsx`). Snapping always applies: the nearest candidate (belt or fill, shown or hidden) within `clickReach` of the hit gives the manual tip its point and normal, and that candidate's id is added to `deleted` in the same scene command; otherwise the exact hit. Warning when angle(hit normal, plate up) < `profile.defaults.tipMinFromUpDeg` (`src/dental/alignerProfiles.ts`, reference 110°): a status line (`setStatus`, not a toast), key `dental.add.facesUp`, en "This spot faces up, so a tip here may not hold." plus ja and zh-Hant.
- **Select**: click or drag over tips selects them; only delete acts on a selection (D5).
- **History**: Add → `'addSupport'`; Delete → `'deleteSupports'`; a paint or erase stroke → new `StepKind 'dentalArea'` ("Support area", three languages), detected in `unitStep` by `before.dental !== after.dental` before the `supports` test.
- **Step 3 controls**: Add, Select (Click | Drag over, Circle size, Click reach), Delete, Tip size, Pillar size, Lift height, Raft, Tree, Brace, the review verdict, Back, Finish. Setback, width and density stay in Step 2.
- **Walk**: Step 2 shows the four tools; P/E/A/S switch them; paint reveals tips, erase hides them; Add on the outer side places a manual tip that survives a density change; Add on an up-facing spot shows the status line; Add within `clickReach` of a hidden fill tip lands on it and never doubles it; Select a tip and Delete removes it and it stays removed after the next rebuild; Step 3 shows no Paint, Erase or density.
- **Done when**: walk and locale walk green (the status line in en, ja, zh-Hant); generic goldens unchanged; dental goldens unchanged unless B2 changed them first.

### O. Aligners without a central opening (deferred, D17) — *spec before start*
Today a profile with `"opening": "yes"` refuses an aligner without an opening (`central-opening-absent`, `dental/region.rs`), and nothing places tips on the outer rim alone. Build the outer-rim-only path (region cut, belt, rings, policy) behind a profile value accepted by `profiles/mod.rs`. Test meshes: real files from V. Starts when V shows such files, or earlier if the owner confirms they exist.

### H. Host deliverable (0.5 unit)
A Node script that drives orient, region, policy, generate and diagnose on an STL through the browser package's ABI with no React (start from `scripts/geometry-wasm-smoke.mjs`). Proves the "future host app" principle and becomes its example.

## After H: dental-only mixosupports, generic supports in mixomesh (D16)

Not started before H is merged. Each step gets a specification and review first. Units are approximate.

| # | Step | Units | Owner |
|---|---|---|---|
| A0 | Licence audit: per-file provenance of `supports/`, `core/`, `generic/` (several files cite Blender nodes or follow OpenVDB); set `license` in `Cargo.toml`; rewrite or gate what cannot ship under mixomesh's EULA | 0.5 + rewrites | ruling on derived vs re-implemented (possibly counsel) |
| A1 | Package the WASM engine: built `.wasm`, glue, `.d.ts`, `VERSION` (engine_version, wasm-bindgen version, hash); mixomesh vendors it like `manifold.wasm` and asserts the version at load | 1 | — |
| A2 | Superseded by ST (D18): the full-screen start is built before B2 | — | — |
| A3 | mixomesh spike: engine in a worker, supports on one selected mesh, tips shown in Babylon (right-handed adapter, one parity fixture); checks size, CSP, memory | 1 | go / no-go |
| A4 | Support UX in mixomesh on selected models, no orientation: paint and erase the support area, select by paint, edit each tip, via the shared framework-free editing logic and a one-page UX contract (modes, keys, brush, cursors, strings) | 2 | sign the UX contract |
| A5 | Tips preview and export in mixomesh through the engine | 1 | export as merged or separate parts |
| A6 | Remove the generic UI from mixosupports (dental-only); the generic engine tests and goldens stay as UI-free Rust/TS tests | 0.5–1 | confirm after A5 |
| A7 | Other mixomesh geometry to WASM only where a benchmark shows ≥ 2× (Manifold and MeshFix stay) | per case | only if it touches those engines |

Users of generic mode on the website move to mixomesh (desktop) at A6.

## Deferred until evidence

Each starts only when its trigger is met, and then gets a specification first.

| Step | Trigger | Note |
|---|---|---|
| P1 Fast-marching distance field | A test on a plane and a cylinder shows the current centroid distance (`dental/field.rs`) off by more than 5 % at the 0.5 mm band (the test itself is 0.5 unit and can run any time) | 2 units; masks and tips re-record |
| E3 Incremental generate | After R and S3, a Step 3 change still takes over 1 s | 3 units; risk of a stale verdict, so it needs a sequence-equivalence test (random edit sequences equal a fresh generate) |
| P3a Fixed landing voxel | A pillar-diameter change measured slow after S3 | `profile.supports` gains `landingVoxelMm`; extend `remesh/cache.rs` (keyed by digest, voxel, adaptivity) |
| P3b Exact landings | Q3 and a measurement | 2 units |
| P4a Surface nearest point | A measured build cost in `Model::closest_point` (`supports/parts/model.rs`, brute force, one caller `autotree.rs`) | Add `Bvh::closest_point` in `core/spatial.rs`; merge the two `closest_on_triangle` copies (`parts/model.rs`, `remesh/sdf.rs`); `core/nearest.rs` is the Blender-parity point-set search and stays separate |
| P2 Curvature detector | Q4: a real file defeats the current detector | 3.5 units |
| B4 Suggestion markers | After B2, if the owner wants them | 0.5 unit |
| C1 One topology module | Maintenance window | Fold `dental/topology.rs`, `bands.rs` `FaceGraph`, `region.rs` and `raft_outline.rs` union-find, `core/overlay.rs` `edge_table`, `safety/index.rs` vertex table; keep the existing edge order (goldens) |
| C2 Retire legacy | After painting an area from scratch no longer uses the legacy fill | Removes `dental/legacy.rs`, `DentalArea::Legacy`/`ManualArea`, WASM `dental_legacy_fill`/`dental_allowed_vertices`, TS `legacyArea.ts`/`manualArea.ts`, `rim.rs` loop and raster (keep `stable_tangent`); older saves then permit nothing, as `dental_policy` already documents |

## Cross-cutting

- **Saved projects**: generic projects get a migration and a load test for every saved-data change. Dental saved data gets migrations from now on (the first release containing it is fbac47f).
- **CI time**: keep the walk under the 30-minute job limit; split it into parallel jobs if it passes about 20 minutes.
- **Release**: squash-merge `codex/dental-rework` to `main` after F + S3 and after H, only with CI green.
