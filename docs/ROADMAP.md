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

Open (owner; Q1, release timing, was answered: pull request #2 merged to `main` as fbac47f on 2026-10-28):

| # | Question | Blocks |
|---|---|---|
| Q2 | Shells from public teeth scans (Teeth3DS+) as extra test files: the data licence is "Other, see license.txt" on OSF. Read it and say whether derived local-only files are allowed.  | V (optional) |
| Q3 | Dental landings without the remesh (P3b): only if a measurement shows the remesh is a problem. | P3b |
| Q4 | Switch the reference type to a curvature contour detector: only if a real file defeats the current one. | P2 |
| Q6 | Split F: build the angle scan, the stable band and the slider now (F1), and defer the automatic pick, its retry and the slenderness limits until prints show the start tilt failing? The scope review's case: those thresholds are guesses until V's prints (principle 6). Today F builds all of it. | F |

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

### F. Print-angle search (1.5 units, engine + UI; goldens: only new ones)
- **Profile** (`dental/profiles/mod.rs`, every struct `deny_unknown_fields`): `pose.tiltRangeDeg` (22), `pose.tiltStepDeg` (1), `pose.tiltMarginDeg` (2); a new required `Stability` struct as `AlignerProfile.stability`: `maxSlendernessUnbraced` (20), `maxSlendernessBraced` (35), `cupProminenceMm` (1.5). Update `reference-aligner.json`, `testdata/second-aligner.json` and the profile parse tests. The start tilt is the existing `pose.tiltDeg`; `headingDeg` and `rollDeg` stay fixed. Fitting-side tips stay allowed (D1); no switch.
- **Tilt**: each scanned pose is the existing target frame (`dental/pose.rs`) with `tilt_deg` replaced; no second rotation formula. Tilts from start - range to start + range in steps of `tiltStepDeg`, start included.
- **Per tilt** (reuse `dental/sampling.rs`, `pose.rs`, `orient.rs`; detection and distance field are pose-independent, so they are cached once): run the real tip sampler with that tilt's up vector, then evaluate four hard rules: (1) **cup**: a vertex that is a local minimum along up (no edge neighbour lower) whose prominence ≥ `cupProminenceMm` and that lies outside the permitted area (the dental policy's allowed area at that tilt); prominence = the smallest rise along up needed to reach, through mesh edges, a vertex lower than it (a global minimum has infinite prominence); (2) **gap**: any rim gap ≥ twice that rim's spacing (`safety/rings.rs` arclength rule; also the folder review's gap trigger); (3) **crossing** (a cheap pre-build test; built supports are still judged by the existing predicates): for each tip, a segment from the tip along its face normal for the neck length, then 5 rays straight down from its end (centre and 4 at pillar radius, 90° apart, the first along the tilt axis) with `core::spatial::Bvh::raycast_first`; any hit on the model, ignoring hits within 0.05 mm of a start and hits on the tip's own source face, is a crossing. Neck length and pillar diameter are scan arguments the host passes from its current support settings; (4) **slenderness**: (tip height above the plate) / pillar diameter above the braced or unbraced limit, braced = profile `supports.tree` or `supports.brace`. Also record the fitting-side tip count, the largest layer cross-section (slices perpendicular to up every 1 mm from the lowest vertex; area = sum of the slice polygons' areas, mm²) and the print height (mm along up, model only).
- **Pick**: a tilt is *robust* if it and both tilts at ± `tiltMarginDeg` pass every hard rule. Among robust tilts: fewest fitting-side tips, then smallest |tilt − start|, then smallest largest-layer area, then lowest print height; exact ties go to the lower tilt. No robust tilt: same order over passing tilts. No passing tilt: fewest failed rules, then the same order; a problem-list entry names the failed rules and, per rule, the tilt and the first failing vertex or tip id. The **stable band** is the continuous run of robust tilts that contains the pick (none when no tilt is robust); its ends are its first and last tilts.
- **Confirm**: one real generate at the pick; if it is blocked, has an unresolved island or a gap at or above twice the rim's spacing, try the next tilt in pick order, at most two times.
- **ABI**: a `GeometrySession` method `dental_tilt_scan(handle, profile_id, neck_length_mm, pillar_diameter_mm)` in `crates/geometry-wasm/src/dental.rs`, host wrapper in `src/core/analysis/dentalEngine.ts`, returning per tilt (tilt, rule flags, fitting-side count, largest gap mm, largest slenderness, largest layer mm², height mm) and the pick with its reason; `engine_version` 6 (L took 5): the Rust test in `geometry-core/src/lib.rs` and `src/workers/geometryVersion.ts` change together.
- **Flow**: detection runs in Step 1 after orientation (it already runs on the oriented mesh); the scan follows; Step 2 opens with the picked pose fixed. Step 1 (`src/components/DentalBar.tsx`) shows "Print angle {n}° (stable {a}–{b}°)" or "Print angle {n}° (no stable angle)" with a `RangeField` limited to start ± range, step `tiltStepDeg`, the stable band drawn as a track highlight; moving it re-runs the sampler preview at that tilt, and Step 2 opens with the chosen tilt. Problem-list rule names: "resin trap", "gap in the rim supports", "support crossing the aligner", "support too thin for its height". Strings in en, ja, zh-Hant (Taiwan wording through Gemini).
- **Done when**: on the reference the stable band is reported with its ends within ±1° of 35° and 46° and the pick lies in 41–45°; the scan takes ≤ 1 s in Node on the development machine (`scripts/perf`); unit tests on synthetic shapes for each hard rule, the robust rule and the tie rule; the problem-list entry tested.

### S3. Step 3 as the live adjust step (1 unit, UI + profile; goldens: dental ones re-record for D3)
- **Pillar size**: a `RangeField` in `src/components/DentalSupports.tsx` after "Tip size": label "Pillar size", unit "{n} mm", hint "Diameter of each support pillar", min 0.8, max 2.5, step 0.1, value `settings.pillarDiameter`, `onChange={(v) => onSetting('pillarDiameter', v, 'dental-pillarDiameter')}` (the same path as Tip size). Strings in en, ja, zh-Hant.
- **D3**: `"tree": true, "brace": true` in the `supports` block of `reference-aligner.json` and `testdata/second-aligner.json`; `src/dental/supportPreset.ts` applies them unchanged.
- **Greyed verdict while dragging**: every Step 3 `RangeField` passes `onAdjust`; while adjusting, the Problems section gets `aria-busy="true"` and the class `is-stale` (opacity from the disabled token in the Mixo app style `tokens.css`); the rebuild follows the existing debounce; `is-stale` clears when the new verdict arrives.
- **Goldens**: the dental goldens built with the profile preset re-record once; the commit lists each and its change (Tree/Brace on). Generic goldens unchanged.
- **Done when**: the walk drags each Step 3 control (Tip size, Pillar size, Support density, Lift height; toggles Raft, Tree branches, Cross-braces) and checks a new verdict arrives and `is-stale` clears; change-to-preview time for each recorded in `perf-current.json` (step R's keys); the folder review of case-001 with the new defaults is in the commit message (tips, left out, crossings, structure fallbacks).

### B2. Suggested tips and even belt spacing (1 unit, engine; dental goldens re-record once) — *spec before start*
Known parts: candidates over every face that passes the existing reachable-from-below rule (`defaults.tip_min_from_up_deg`) in the print pose, at outer spacing × density, in face-index order, ids `dental-fill-K`, cached by mesh digest, profile, up vector (quantised to 0.25°) and density; paint reveals, erase hides; candidates inside the belt or within half a spacing of a belt tip are skipped; belt tips spaced N = round(L / spacing) per closed rim, phase from the lowest vertex (lowest index on ties). Deleting automatic tips reuses `supports/edits.rs` `compose_contacts` and `src/supports/contactEdits.ts` (`remapDeleted`, `rekeyHandWork`) as generic mode does (`generic/policy.rs` `GenericInput.deleted`), not a new dental field. To write first: the `dental_policy` input change, what happens to painted tips when the tilt or density changes, and the golden list.

### B3. Step 2 tools (1.5 units, UI + small engine) — *spec before start*
Known parts: extend `EditTool` (`src/editing/types.ts`, today `'add' | 'select'`) and the session (`session.ts`, `pick.ts`) so Step 2 offers Paint and Erase (today `DentalKind 'allow' | 'erase'`) plus Add and Select; Step 3 keeps `EditTools` (`EditBar.tsx`, already used by `DentalSupports.tsx`) and loses Paint, Erase and density (D5). Delete stays the existing `edit.deleteSelection` command (`editing/commands.ts`, handler `deleteSelected` in `App.tsx`). Add places a manual contact at the exact hit (snap to a candidate within `clickReach` mm if B2 is done), warns when the face points up; manual contacts are kept by `compose_contacts`. To write first: the key bindings (check `editing/keys.ts`), the warning text and the walk scenarios.

### O. Aligners without a central opening (1 unit, engine) — *spec before start*
Today a profile with `"opening": "yes"` refuses an aligner without an opening (`central-opening-absent`, `dental/region.rs`), and nothing places tips on the outer rim alone. Build the outer-rim-only path (region cut, belt, rings, policy) behind a profile value accepted by `profiles/mod.rs`. Test meshes: real files from V. Starts when V shows such files, or earlier if the owner confirms they exist.

### H. Host deliverable (0.5 unit)
A Node script that drives orient, region, policy, generate and diagnose on an STL through the browser package's ABI with no React (start from `scripts/geometry-wasm-smoke.mjs`). Proves the "future host app" principle and becomes its example.

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
