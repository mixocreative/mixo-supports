# Ship plan — one Rust geometry core, generic engine, dental as policy data

Status: owner-approved direction (2026-10-27); revised after two independent reviews (scope + implementation readiness). This is the **single working plan** for branch `codex/dental-rework`. Progress is tracked here only. `docs/dental-rework-handoff.md` is the dated evidence log. Older plans are reference material (see end).

## Goal

Ship Mixo Supports with **every 3D calculation in one Rust/WASM core**, modular so generic (non-dental) use has every capability and dental mode only supplies policy data. Keep the stack minimal: Rust core + thin TypeScript host + Vite + Vitest + one browser walk.

"Ship" = every **software gate** below passes on one revision, then the owner approves merge and deploy. **Clinical/print validation** (more patient STLs, physical prints) is a separate track that decides how dental mode is labelled, not whether the code ships.

## Architecture rules (every unit)

1. **Layers, one-way:** `core` (mesh, math, transform, spatial, pick, brush, topology, import) → `supports` (placement, all parts, manual edits, collision/clearance, islands, bounded repair, verdict) → policies `generic` and `dental`. **No collision, landing, repair or mesh-building code may live in a policy.**
2. **A policy is data, not callbacks.** Each policy produces a `PolicyResult` that the engine consumes (contract below). A future mode = a new producer of this struct.
3. **TypeScript is host only:** UI, React, Three.js buffer copies, camera/gizmo, files, worker lifecycle, settings + project serialization (presets stay TS and are sent as validated numbers), i18n. Any TS vector math beyond render/camera is a defect, enforced by the guard (U9).
4. **Coarse ABI**, versioned, typed arrays in/out, typed errors incl. `OVER_CAPACITY`, never a partial result on error/cancel. One `generate` call runs the whole pipeline in Rust; TS never runs a retry loop.
5. **Port stable, write unfinished once.** Shipping code is ported against the TS oracle. Unfinished safety work (the TS modules listed in U7, incl. uncommitted `genericBodyClearance.ts`) is **frozen** as reference and written once in Rust; nothing is finished in TS.
6. **Oracle rule (single rule for every unit):** when a unit cuts over, its old TS moves to `scripts/test-support/ts-oracle/` (tests only, no production import). U9 converts the remaining oracle comparisons into recorded golden files and deletes the folder. Production never has two engines for one operation.
7. **Parity tolerance:** contact IDs, component IDs/tags, triangle indices, omitted counts and verdicts **identical**; vertex positions within **1e-5 mm** (JS and Rust trig differ in the last bit). Any larger difference needs a fixture, rationale and owner-visible note, never a blanket widening.
8. **Small modules:** Rust files ≤ ~400 lines, split by responsibility.
9. **Per-unit process:** red test → green → focused + full checks → commit → `graphify update .` (keeps the code graph current; free) → update Progress table → append evidence to the handoff using its *Continuity protocol* (date; files/commit; exact command + result; finding; risk; next action). Cheapest capable agent; one review per unit. Keep `dentalwork/technical-algorithm.md` and `support-module-boundaries.md` in sync when behavior/ownership changes.

## Contracts

**PolicyResult** (Rust struct, also the ABI shape; finalised as U4's first commit):
```
PolicyResult {
  permitted_faces: FaceMask,            // bitset over source faces; painting may only narrow/extend inside what geometry gates allow
  candidates: Vec<Candidate>,           // primary contacts: id, source_face, point, normal, origin {auto|manual}
  alternates: Vec<(CandidateId, Vec<Candidate>)>, // ordered repair options per contact
  structures: AllowedStructures,        // pillar/tree/brace/roof/cage/raft flags (dental: roof/cage off)
  repair_budget: u32,                   // max trials; manual contacts are never moved or deleted
}
Verdict per component/contact: clear | blocked{face, evidence} | inconclusive{reason}; timeout => inconclusive, never clear.
```

**ABI** (one list; replaces the names in the old design doc):

| Call | In | Out | Added in |
|---|---|---|---|
| `engine_version` | — | u32 schema | done |
| `GeometrySession` load/bounds/release | positions f32, indices u32 | handle / bounds / `OVER_CAPACITY` | done |
| `BinaryStlSession` / `AsciiStlSession` / `weld_positions_in_place` / `center_positions_in_place` / `decimate_display` | chunks / arrays | welded arrays | done |
| `transform` | handle, matrix f64[16], handedness | arrays | U2 |
| `pick` / `project_brush` | handle, camera matrices, ray/stroke batch | face ids, points | U2 |
| `orient_dental` | handle | rotation, confidence, ambiguous? | U6a |
| `propose_dental_region` / `retune_dental_region` | handle, tuning | contours, strip mask, `PolicyResult` | U6a |
| `generic_policy` | handle, settings, zones, manual edits | `PolicyResult` | U5 |
| `generate` | handle, `PolicyResult`, settings, revision u32 | support mesh arrays + tags, verdicts, omitted, islands, revision | U7/U8 |
| `diagnose` | handle, revision | review GLB data (colors per role) | U8 |

**Canonical fixtures:** aligner = `docs/dental-reference/reference-aligner.stl` (only this one; root `Aligner.stl` and `dentalwork/fixtures/` are not gates). Generic = `src/goldens/fixtures.ts` (cube-overhang, knot, thin-slab, v-ridge; STANDARD + low-poly variants). Face labels (allowed/forbidden) are extracted by U6a to `docs/dental-reference/face-labels.json`.

**Baseline commands:** `cargo test --workspace`; `npm run wasm:build && npm run wasm:test`; `npx vitest run --maxWorkers=1 --testTimeout=60000`; `npx tsc --noEmit`; `npm run build`; `npm run walk`; browser smoke via `npx vite --host 127.0.0.1 --port 5173` + `python scripts/geometry_wasm_browser_smoke.py`.

**Performance (owner 2026-10-27):** no hard target. Measure with the U0 script; act only on an obvious regression.

**Aligner profiles (owner 2026-10-27):** dental behavior is parameterised by an `AlignerProfile` data file (id, display name + one-line description per locale, card SVG, detector thresholds, default strip width/density/setback, opening expected yes/no/either, reference fixture path). Profile #1 = `reference-aligner`. Adding or tuning an aligner type = new profile + fixture + its U6 checks, not new pipeline code. Profiles live in `crates/geometry-core/src/dental/profiles/` and are selectable in the host.

## Dental UX flow (owner spec, 2026-10-27)

Dental mode is a visible feature. Entering it dims the rest of the editor.
0. **Step 0 · Aligner type:** large clickable cards, one per `AlignerProfile`, each with a top-view line-art SVG, name and one-line description (all carried by the profile data, so a new type gets a card with no UI code). One click selects and advances. Shown even with a single profile so the flow never changes (owner confirmed 2026-10-27: one card, click → Step 1); last choice is highlighted.
1. **Step 1 · Aligner:** prompt to drop/upload an aligner STL. If detection disagrees with the chosen type (e.g. no central opening on an opening type), offer "This looks like a different aligner type. Switch?" instead of silently continuing; switching re-runs detection with that profile. On drop: loading → automatic orientation (in a worker). User may rotate with the gizmo, then Next. Uncertain/failed orientation: say so, keep the dropped pose, manual rotate + Next. Wrong/broken/too-large file: clear message, stay in Step 1.
2. **Step 2 · Support area:** detected area highlighted; Add area / Remove area paint, strip/density sliders; Next. No area detected: message + empty area to paint; Next disabled until something is painted.
3. **Step 3 · Supports:** supports generated on default settings. Key settings: tip size, density, **lift height, raft on/off**, Tree/Brace toggles; changes regenerate and keep manual edits (kept/reset report). Add / delete selected supports. Problem list (rim gaps, unresolved islands, omitted crossings) with Show + add-support fix. **Label** field, clearly titled, default `X`, max 8 characters, A–Z 0–9 and `-` only (input filters others, uppercase), embossed on the support base. Two finish buttons: **OK** and **Add another aligner** (keeps this aligner finished, returns to Step 1 with the same type).
4. **After OK:** all finished aligners + supports stay on the plate as normal objects; hint to Export STL / Save project.
- **Mesh check on drop** (Step 1): warn about holes / non-manifold / broken geometry before detection; detection result is marked unreliable.
- **Auto-arrange:** every drop in a session re-arranges all aligners on the plate without overlap.
- Back is allowed (3→2→1); confirm before discarding manual Step 3 edits. Exit leaves the current aligner on the plate with no supports; previously finished aligners are kept.
- Next release (not in scope now): multi-file batch drop with thumbnail strip, printer plate-fit warning, printer/resin setting presets, resin volume estimate.

## Work units

| # | Unit | Scope | Done check |
|---|---|---|---|
| U0 | Baseline + inventory | Complete `dentalwork/wasm-geometry-inventory.md`: one row per production TS 3D file/export with columns *callers · target Rust module · label* where label ∈ {port, port-into-shared-safety, frozen-reference, host-adapter, retire}. Dental-specific safety (`dentalBodyClearance`, `dentalLandingSide`, `dentalPrimaryFace`, `dentalGapAlternates`) must map to shared `supports/` + policy data. Decide owner of `supportCheck.ts` island heuristic. Add `scripts/perf-baseline.mjs` (import, brush p95, Generate on aligner + knot) and record results. Add guard script `scripts/geometry-guard.mjs` (report-only). | Inventory has no unlabelled row; perf baseline recorded; guard runs in `npm test` |
| U1 | Import (finish) | Remaining non-worker import helpers → Rust. Odd-STL corpus (colour-header binary, CRLF ASCII, non-ASCII whitespace, malformed) in `scripts/fixtures/stl-corpus/`. | All import callers use Rust; TS → oracle; corpus parity green |
| U2 | Core spatial + crate layout | Restructure crate into `core/` `supports/` `generic/` `dental/` folders. Port transforms/handedness, normals, BVH, ray/face pick, screen-brush, overlay vertices. Fixture: recorded camera + strokes on the aligner with expected face IDs (incl. occluded). | Pick/brush face IDs identical; brush p95 within perf gate; TS → oracle |
| U4 | Support parts + manual edits | `PolicyResult` contract first. Every part (tip, neck, foot, pillar, Tree, Brace, roof, cage, raft, label) with attribution tags; manual edit model in `supports/`. Compare Rust builder vs TS builder fed the **same TS placement** for every golden fixture/variant. | Parity per rule 7 on all goldens; TS builders → oracle |
| U5 | Generic policy | Downward faces, minima, edges, remesh, deterministic IDs, zones → `generic_policy`. | Golden contact IDs identical; Generate/export/reload use Rust; TS placement → oracle |
| U6a | Dental policy (reference aligner) | Orientation, outer contour, opening `present/absent/ambiguous`, strip, tuning → `PolicyResult`. Port only these; safety/alternates belong to U7. | Loops 2,665/339 edges; 100/100 random poses within 0.02 mm; mask + tip IDs identical; **every** tip and secondary landing on an allowed face per `face-labels.json`; synthetic no-opening mesh abstains; `ambiguous` never becomes `absent`; saved policy recomputed on load, never grandfathered; paint cannot override a failed geometry gate; Step 1/2/3 browser parity |
| U7 | Shared safety engine (Rust-only) | Port sources: `bodyIntersection`, `modelCollisionIndex`, `contactReach`, `pathPreflight`, `columnPathScreen`, `candidateSelection`, `supportPath`, `topologyBirths`, frozen `genericBodyClearance`, plus the dental safety files from U0. Build: collision index, intentional-reach vs crossing classifier, bounded repair runner (consumes `alternates`), built-path graph → island `resolved/unresolved/inconclusive`, one verdict for both policies; `generate` call. | Every case in those modules' existing tests passes in Rust, plus: two-wall, Tree both leaves (round + shaped), brace, generic roof/cage, nearby detached tip, manual never moved/deleted, timeout = inconclusive. Route preflight kept **only if** zero false-safe results and measured benefit on a collision-heavy fixture without clean-case regression; otherwise final exact check only |
| U8 | One result path | `jobRunner.ts` shrinks to lifecycle; workers, preview, export, project reload and `scripts/dental-region-review` use `generate` / `diagnose`. Revision: every request carries `revision`; host drops mismatched results; cancel = terminate + recreate worker. Babylon left-handed contract smoke. | Preview == export IDs and verdicts; test: cancel mid-generate then new request → only newest revision reaches viewport/export, live handle count returns to 0; export refuses stale/failed/inconclusive results with a visible message; review GLB colors per contour spec; Babylon smoke passes |
| U9 | Cleanup + guard on | Convert oracle comparisons to recorded golden files; delete `scripts/test-support/ts-oracle/`; guard enforcing; review host-adapter allow-list. | Guard enforcing + green; no production TS geometry |
| UX-a | Dental flow: entry → Step 2 (TS host only) | On current engine calls (swapped to WASM later with no UI change): dimmed mode, Step 0 type cards (profile SVG, Mixo app style), Step 1 drop prompt + mesh check + bad-file message + auto-orient on drop in a worker + type-mismatch prompt, Step 2 no-area branch, Back confirm, Exit. Three locales (zh-Hant via Gemini, Taiwan wording). | Browser walk covers Step 0→2, Back, Exit, failed-orientation, bad file, holes warning, no-area branches |
| UX-b | Dental flow: Step 3 + finish (TS host only) | Step 3 settings incl. lift + raft, add/delete selected, problem list with Show/fix, Label field (rules above), OK / Add another aligner, auto-arrange on drop, after-OK hint. | Browser walk: two aligners end to end, labels on both, arranged without overlap, export contains both |
| U10 | UI + release evidence | Island/unresolved status in problem list (replacing old heuristic per U0 decision); `OVER_CAPACITY` message; licence notices for Rust crates; docs in sync. | Fresh run of all baseline commands; browser walk generic + dental in **all three locales**; perf gate; owner review |

**Order:** U0 → (U1, U2 in parallel) → U4 → (U5, U6a in parallel) → U7 → U8 → U9 → U10. (Old U3 topology merged into U7.) **UX-a → UX-b** are UI-only and run in parallel with U0–U7 (no geometry). If label glyphs for digits/`-` are missing, add them as glyph **data** and flag it for the U4 port.

## External validation (owner-supplied, separate track)

- U6b: a second with-opening aligner and a real **no-opening** aligner run through the U6a checks. Physical print/fit review on the target printer/resin.
- Until done: dental mode ships labelled **preview / not clinically validated** (or hidden; owner decides) and abstains on uncertain meshes.

## U0 decisions (2026-10-27)

- D1 `supportCheck.ts`: island part replaced by U7 verdict, deleted in U10 with `runCheckJob` after goldens + aligner match; its overhang-coverage report is ported as a **non-gating generic-policy warning** (Check is a shipped generic feature).
- D2 `dentalRimCoverage` → shared `supports/verdict`; dental thresholds are profile data.
- D3 `genericBodyClearance.ts` (+ test) committed as frozen-reference; never extended in TS.
- D4 `vec3`/budget stay host-adapter; U9 guard separates render/camera use from defects.
- D5 `buildPickIndex` → Rust `core/spatial` in U2.
- D6 non-worker `stl.ts`/`weld.ts` helpers → U1.

## Owner answers (2026-10-27)

1. Dental mode is visible, with the flow above.
2. One reference STL for now; more later → aligner profiles.
3. No hard performance target; measure and avoid obvious regressions.

## Progress

| Unit | State | Commit | Note |
|---|---|---|---|
| U0 | done | see git log | toolchain, version gate, mesh session; inventory (103 rows), `dentalwork/perf-baseline.json`, report-only `scripts/geometry-guard.mjs` + `src/geometryGuard.test.ts` |
| U1 | done | see git log | all import callers use Rust (worker + Node test/dev helper `scripts/test-support/rustImport.ts`); TS parser/welder/centre moved to `scripts/test-support/ts-oracle/`; 24-file odd-STL corpus in `scripts/fixtures/stl-corpus/` with parity test (one Rust fix: non-ASCII whitespace); `src/importOracleBoundary.test.ts` guards production |
| U2 | done (Phase A + B) | see git log | crate folders `core/ supports/ generic/ dental/`; Rust matrix/normals/BVH/pick/brush/overlay + WASM `transform`, `pick`, `pick_pixels`, `project_brush`, `body_segments`, overlay calls; parity `src/workers/spatialParity.test.ts` + `scripts/fixtures/brush/`; ASCII STL keywords case-insensitive (task 0). Phase B: `state/transform` (via `state/transformEngine`), brush (`editing/screenBrush` + `useScreenBrush` on `body_segments`/`project_brush`), pointer raycast (`viewport/rustRaycast`, shared main-thread session `sharedSession()`), dental overlay on Rust; TS brush and overlay in `scripts/test-support/ts-oracle/`; `geometryNow()` + engine awaited in `main.tsx`; wasm init in object form. Brush p95 (browser, `scripts/brush_perf.py`, in `dentalwork/perf-baseline.json`): 1,920 supports TS cached 1.8 ms vs Rust 3.2 ms per step, 48 supports 0.1 ms both. Leftover: worker still builds the three-mesh-bvh pick index (App.tsx `setPrebuiltBvh`, prepareImport) for U1/UX-b to drop; `core/transform.ts` stays for jobRunner/unitSupports until U8 |
| U4 | done (U4a columns, U4b Tree + Brace, U4c raft + label + Roof + Cage, production cut-over); manual-edit rekeying stays TS until U5 | see git log | `PolicyResult`/settings types in `crates/geometry-core/src/supports/{policy,settings}.rs`; parts in `supports/parts/` (tip, neck, pillar, foot, tags, builder, solids, autotree, tree, brace, raft_outline, raft, label, font, roof, structures); WASM `build_supports` (typed `NOT_YET_PORTED` only for the Safe Distance scatter without a host layout). U4c: raft follows the model outline (plan-view SDF trace, part groups, flared walls, drainage gaps), label glyphs incl. digits and `-` from the shared `labelFont.json`, Roof/Cage (generic only; dental keeps them off). Parity (rule 7) of Rust vs the TS oracle on every golden fixture and variant (cube-overhang, knot, thin-slab, v-ridge; STANDARD + Low Poly, preview + export, with raft + label on and the roof variant) plus extra settings (cage, roof diagonals + concentric braces, open ceiling, raft wall/angle/voxel changes, label sizes and `AB-12`, Safe Distance with a host layout), tips-only, manual + own shapes, and the reference aligner (preview Low Poly + export): indices/tags identical, positions within 1e-5 mm (`scripts/test-support/supportParityHarness.ts`, `src/workers/supportBuildParity.test.ts`); production host path (zones, landing rules, blocked trees) vs the oracle in `src/supports/rustSupports.test.ts`. Cut-over: `runSupportJob` (mesh worker preview + export, goldens, review scripts) builds through `src/supports/rustSupports.ts` (typed arrays in once, out once; engine registered by `geometryReady`). TS still supplies, until U5/U7: voxel-remeshed landings and normals (Low Poly previews let Rust cast exact landings), the Auto Tree layout when Safe Distance != 0 or a policy needs it, and the zone / landing-rule omissions (`src/supports/hostOmissions.ts`). No whole-build TS fallback remains. The opt-in path preflight (`decideColumn`, default off, no measured benefit) is gone from the production runner and returns with U7 only if its benefit is measured. TS builder (`mesh.ts` builder, `meshBuilder`, `raft`, `raftGeometry`, `roof`, `labelFont.ts` + their tests) moved to `scripts/test-support/ts-oracle/support-builder/`; `src/core/supports/mesh.ts` is types only. Golden `thin-slab.tree`: only the STL byte hash changed (two ~1e-17 mm coordinates round to other float32 values); mesh hash and the rest identical |
| UX-b | done (TS host) | see git log | Step 3 panel (tip size, density, lift, raft, Tree/Brace moved from Step 2, Support Edit Mode tools, problem list with Show/Fix, Label field A-Z 0-9 - max 8 default X), OK / Add another aligner, auto-arrange on every drop and finish (`src/dental/arrange.ts`), Back confirm, Exit clears policy, toasts clear on step change. Label font already had digits and `-`: no glyph data added. Walk lane `x` (two aligners, labels, export, no overlap). |
| U5 | done | see git log | Rust: voxel remesh (`supports/remesh/`, OpenVDB VolumeToMesh port with single-precision stages; in `supports/` because the builder lands on it, the generic policy only consumes it), generic placement (`generic/placement/`: downward faces and regions, Poisson field, island minima, legacy ridges, edge anchors, deterministic `auto-X_Y_Z` IDs), `generic_policy` -> `PolicyResult` (`generic/policy.rs`: automatic minus deleted and zoned, plus manual, point class per source, structures from the validated settings), zones (`supports/zones.rs`), manual-edit bookkeeping (`supports/edits.rs`: compose, remap, rekey, hiding removals), and `build_supports` now samples neck normals and lands on the remesh itself (exact surface in Low Poly previews), lays out Auto Trees incl. Safe Distance and applies zone omissions; the dental landing rule is evaluated by the host on `probe_landings` and handed back as flags. WASM in `crates/geometry-wasm/src/generic.rs`. TS keeps only adapters (`supports/{genericPlacement,genericPolicy,contactEdits}.ts`); TS placement, remesh, Auto Tree layout, landing and host omissions moved to `scripts/test-support/ts-oracle/{placement,remesh,support-builder}`. Parity (rule 7): goldens reproduce exactly (IDs, mesh and STL hashes); Rust placement vs the oracle on 4 fixtures x 7 setting variants (IDs, sources, regions identical, positions within 1e-5 mm); Rust build vs the oracle with its own remesh on every golden variant, preview and export, Safe Distance and the aligner (indices and tags identical). Knot Generate 689 ms (baseline 1,440 ms); aligner dental Generate 13.1 s (baseline 12.2 s: the remesh is no longer cached across the dental rebuilds). Left for U7: `supportCheck` overhang coverage (D1) and island heuristic stay TS with `runCheckJob`; the dental landing-rule callback and `decideColumn`-style verdicts |
| U6a–U10 | not started | — | |

## Reference material (detail only; do not track progress there)

- Architecture: `dentalwork/wasm-geometry-design.md` (its ABI names are superseded by the table above)
- Safety design: `docs/superpowers/specs/2026-10-26-support-ship-gates-design.md`
- Dental contour design: `docs/superpowers/specs/2026-10-25-dental-contour-contacts.md`
- Superseded task lists: `docs/superpowers/plans/2026-10-27-wasm-geometry-migration.md`, `2026-10-26-support-ship-gates.md`, `2026-10-25-dental-contour-contacts.md`, `2026-10-24-dental-rework.md`
- Algorithms: `dentalwork/technical-algorithm.md`, `dentalwork/support-module-boundaries.md`
- Evidence log: `docs/dental-rework-handoff.md`
