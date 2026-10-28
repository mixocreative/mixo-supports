# Roadmap after the ship (from 2026-10-28)

The plan for what comes next. [SHIP-PLAN.md](SHIP-PLAN.md) records what was built. This file holds the decisions and, for each step, its specification. **Rule: a step is built only from a written specification here.** A step marked *spec before start* gets its specification written (and reviewed) before an agent starts it; the implementer does not make design decisions that are not written down.

Reviewed 2026-10-28 by three EGM reviewers (implementation readiness, scope, code accuracy); their findings are folded in.

## Principles (owner)

1. All 3D work in Rust; TypeScript only hosts. Everything reusable by generic (non-dental) mode and by a future host app.
2. Every decision about size or spacing is in millimetres, never in counts of faces, edges or pixels.
3. Everything the user changes shows live.
4. A stable print comes first; keeping tips off the fitting (tooth-facing) surface comes second.
5. Results reasonably close to the owner's example (`dentalwork/fixtures/case-001/ideal-supported.stl`), not identical.
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
| D6 | Results reasonably close to the owner's example, not identical. | all |
| D7 | Blocked verdict marks real crossings only; the automatic repair re-aims or leaves out crossing necks (built: 09c81be, 836d445). | built |
| D8 | Low points outside the support area are information only (lead decision, reversible). | built |
| D9 | The mesh check stays strict; a separate "repair mesh" step only if real files need it. | evidence |
| D10 | Generate time limit stays 120 s. | built |
| D11 | A lift change keeps the generated tips, necks and landings exactly and only moves what reaches the plate (lead decision, reversible). Two fresh generates at different lifts differ (the landing remesh grid follows the build frame: tips up to 2.1 mm apart), so "equal to a fresh generate" holds only on the exact surface. | L |

Open (owner):

| # | Question | Blocks |
|---|---|---|
| Q1 | Merge pull request #2 to `main` (deploys) now, with dental labelled preview, or later? Merging early keeps the branch small and removes migration work for unreleased dental data. | release |
| Q2 | Synthetic aligners from public teeth scans as test files: yes or no (licence to check). | V |
| Q3 | Dental landings without the remesh (P3b): only if a measurement shows the remesh is a problem. | P3b |
| Q4 | Switch the reference type to a curvature contour detector: only if a real file defeats the current one. | P2 |

`dentalwork/open-decisions.md` explains D7–D10 in plain language for the owner.

## State at d28ffd3 (sources)

- Reference aligner at default settings, folder review (`dentalwork/batch-review`, run 2026-10-28 by the unit D agent): 94 tips built, 0 left out, 0 crossings, opening gap 4 mm, outer gap 6 mm.
- Step 2 slider to tip preview 330–339 ms; Step 3 change to preview 1.6–3.0 s (E1 bench `scripts/perf/live-bench.mjs`, headless Chromium, median of 3, machine shared with another job). Most of a rebuild is the repair loop: about 5 trials of 0.19 s build + 0.07 s check.
- `dentalwork/perf-baseline.json` is the **pre-port** comparison (dental Generate 12.2 s, 117 contacts) and stays as history; current numbers go to a new file (step R).
- Pull request #2 (`codex/dental-rework` → `main`) is open; merging it deploys.

## Verification tiers

- **Engine or ABI step**: `~/.cargo/bin/cargo test --workspace`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run walk`, the locale walk, a folder review of `dentalwork/fixtures/case-001`.
- **UI-only step**: `npx tsc --noEmit`, `npx vitest run`, `npm run walk`, the locale walk when strings change.
- **Docs-only step**: none.
- Every step: docs updated, one line in the SHIP-PLAN progress table (unit, status, commit, one-sentence summary; details in the commit message), commit and push to `codex/dental-rework`.
- **Goldens**: a step says up front whether goldens may change. A re-record is allowed only when the step says so; the commit message lists each changed golden and why, and the lead checks the diff before pushing.

## Steps in order

### V. Validation on real aligners (owner, in parallel, starts now)
Owner runs `dentalwork/batch-review/run-batch-review.bat` on 10–20 real aligners (upper and lower, with and without a central opening, attachments, different trim styles, files from more than one design program) and prints 3–5 at the default settings on the owner's printer and resin, checking that supports hold and the parts fit. Sends case numbers and notes. Outcome decides whether O, P2 and the F thresholds need work. Synthetic aligners only if Q2 is yes.

### L. Lift as a plate offset (done)
Lift moves the plate, not the model, so a lift change keeps the model-space caches. Goldens must not change. Done when: a lift change through the offset equals a fresh generate at that lift (within 1e-5 mm; same components, contact ids and verdicts); the session keeps the same mesh handles across the change (handle count asserted); lift-change time before and after with `scripts/perf/live-bench.mjs`. Time-box: if not done within the unit, stop and report.

### R. Repair loop on a clean pass (0.5 unit, engine; goldens must not change)
Measure why a dental generate with 0 crossings runs several repair trials (`supports/generate/repair.rs`), then skip the trials that cannot change the result when the first full check is clean. Record current timings (dental generate, Step 2 slider, Step 3 changes) in a new `dentalwork/perf-current.json` written by `scripts/perf-baseline.mjs` (extend it; keep `perf-baseline.json` untouched), and add a check that fails only on a 2× regression. Done when: goldens unchanged; trial count and generate time on the reference before and after.

### F. Print-angle search (1.5 units, engine + UI; goldens: only new ones)
- **Profile** (`dental/profiles/mod.rs`, `deny_unknown_fields`; both JSON files): `pose.tiltRangeDeg` (22), `pose.tiltStepDeg` (1), `pose.tiltMarginDeg` (2); `defaults.allowFittingSideTips` (true; D1); `stability.maxSlendernessUnbraced` (20), `stability.maxSlendernessBraced` (35), `stability.cupProminenceMm` (1.5). The start tilt is the existing `pose.tiltDeg`.
- **Tilt axis**: rotation of the target pose about the fixed horizontal axis `across = [cos h, 0, sin h]` (h = `pose.headingDeg`); heading and roll fixed.
- **Per tilt** (reuse `dental/sampling.rs`, `pose.rs`, `orient.rs`; detection and distance field are pose-independent, so they are cached once): run the real tip sampler with that tilt's up vector, then evaluate four hard rules: (1) **cup**: a vertex that is a local minimum along up with prominence ≥ `cupProminenceMm` and lies outside the permitted area; (2) **gap**: any rim gap ≥ twice that rim's spacing (`safety/rings.rs` arclength rule); (3) **crossing**: for each tip, a ray from tip + neck length along the face normal, then 5 rays straight down (centre and 4 at pillar radius) with `core::spatial` ray casts, hitting the model = crossing; (4) **slenderness**: (tip height above the plate) / pillar diameter above the braced or unbraced limit, braced = Tree or Brace on in the profile preset. Also record the fitting-side tip count, the largest layer cross-section (slices every 1 mm) and the print height.
- **Pick**: a tilt is *robust* if it and both tilts at ± `tiltMarginDeg` pass every hard rule. Among robust tilts: fewest fitting-side tips, then smallest |tilt − start|, then smallest largest-layer area, then lowest print height; exact ties go to the lower tilt. No robust tilt: same order over passing tilts. No passing tilt: the one with the fewest failed rules, and a problem-list entry naming the failed rules and where.
- **Confirm**: one real generate at the pick; if it is blocked, has an unresolved island or a gap at or above the review trigger, try the next tilt in pick order, at most two times.
- **ABI**: `GeometrySession.dental_tilt_scan(handle, profile_id)` returning per tilt (tilt, rule flags, fitting-side count, largest gap mm, largest slenderness, largest layer mm², height mm) and the pick with its reason; `engine_version` 5.
- **Flow**: detection runs in Step 1 after orientation (it already runs on the oriented mesh); the scan follows; Step 2 opens with the picked pose fixed. Step 1 shows "Print angle 44° (stable 35–46°)" with a slider limited to the range and the stable band drawn; moving it re-runs the sampler preview. Strings in en, ja, zh-Hant (Taiwan wording through Gemini).
- **Done when**: on the reference the stable band is reported with its ends within ±1° of 35° and 46° and the pick lies in 41–45°; the scan takes ≤ 1 s in Node on the development machine (`scripts/perf`); unit tests on synthetic shapes for each hard rule, the robust rule and the tie rule; the problem-list entry tested.

### S3. Step 3 as the live adjust step (1 unit, UI + profile; goldens: dental ones re-record for D3)
Add pillar diameter to the Step 3 controls; Tree and Brace on in the dental profile preset (D3); while a slider is dragged, show the last verdict greyed and rebuild on release (existing preview plumbing). Done when: walk checks each Step 3 control; change-to-preview time for each recorded in `perf-current.json`; the Tree/Brace default change and its goldens explained in the commit.

### B2. Suggested tips and even belt spacing (1 unit, engine; dental goldens re-record once) — *spec before start*
Known parts: candidates over every face that passes the existing reachable-from-below rule (`defaults.tip_min_from_up_deg`) in the print pose, at outer spacing × density, in face-index order, ids `dental-fill-K`, cached by mesh digest, profile, up vector (quantised to 0.25°) and density; paint reveals, erase hides; candidates inside the belt or within half a spacing of a belt tip are skipped; belt tips spaced N = round(L / spacing) per closed rim, phase from the lowest vertex (lowest index on ties). Deleting automatic tips reuses `supports/edits.rs` `compose_contacts` and `src/supports/contactEdits.ts` (`remapDeleted`, `rekeyHandWork`) as generic mode does (`generic/policy.rs` `GenericInput.deleted`), not a new dental field. To write first: the `dental_policy` input change, what happens to painted tips when the tilt or density changes, and the golden list.

### B3. Step 2 tools (1.5 units, UI + small engine) — *spec before start*
Known parts: extend `EditTool` (`src/editing/types.ts`, today `'add' | 'select'`) and the session (`session.ts`, `pick.ts`) so Step 2 offers Paint and Erase (today `DentalKind 'allow' | 'erase'`) plus Add and Select; Step 3 keeps `EditTools` (`EditBar.tsx`, already used by `DentalSupports.tsx`) and loses Paint, Erase and density (D5). Delete stays the existing `edit.deleteSelection` command (`editing/commands.ts`, handler `deleteSelected` in `App.tsx`). Add places a manual contact at the exact hit (snap to a candidate within `clickReach` mm if B2 is done), warns when the face points up; manual contacts are kept by `compose_contacts`. To write first: the key bindings (check `editing/keys.ts`), the warning text and the walk scenarios.

### O. Aligners without a central opening (1 unit, engine) — *spec before start*
Today a profile with `"opening": "yes"` refuses an aligner without an opening, and nothing places tips on the outer rim alone. Build the outer-rim-only path (region cut, belt, rings, policy) behind a profile value accepted by `profiles/mod.rs`. Needs a no-opening test mesh (synthetic, made by a script under `scripts/`, or a real file from V). Starts when V shows such files, or earlier if the owner confirms they exist.

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

- **Saved projects**: generic projects get a migration and a load test for every saved-data change. Dental saved data gets migrations only after the first release that contains it (Q1).
- **CI time**: keep the walk under the 30-minute job limit; split it into parallel jobs if it passes about 20 minutes.
- **Release**: per Q1.
