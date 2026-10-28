# Support modules: who owns what

This document says which code owns which decision. It describes the layout at the commit that last changed this file; [the ship plan](../docs/SHIP-PLAN.md) records how it got there. For algorithm detail see [technical-algorithm.md](technical-algorithm.md).

## The rule

Layers are one-way:

```
core  ->  supports  ->  policies: generic, dental
```

- **`core`** (`crates/geometry-core/src/core`): mesh, STL import, weld, decimate, matrix and transform, normals, spatial index, pick, brush, overlay, nearest point, and the one vector module (`vec.rs`) with the JavaScript-exact number helpers (`jsnum.rs`). Knows nothing about supports.
- **`supports`** (`crates/geometry-core/src/supports`): placement of every part, the manual-edit model, the stamp rule (`AreaStamp::resolve`), overhang classification (`overhang.rs`), collision and clearance, islands, bounded repair, the verdict. Knows nothing about dental anatomy or about generic placement rules.
- **Policies** (`generic`, `dental`): each one produces a `PolicyResult` (data). **No collision, landing, repair or mesh-building code may live in a policy.** A policy has no callbacks into the engine.
- **TypeScript** is host only: UI, React, Three.js buffer copies, camera and gizmo, files, worker lifecycle, settings and project serialization, translations. Any TypeScript vector math beyond render and camera is a defect, enforced by the geometry guard.

If you are about to write a collision test, a landing check, a retry loop or a mesh builder inside `dental/` or `generic/`, stop: it belongs in `supports/`, driven by a new field of `PolicyResult` if it needs a new input. `crates/geometry-core/tests/layers.rs` fails on an import that points up the layers (core importing supports, supports importing a policy, one policy importing the other).

## Ownership map

| Decision | Owner | Where |
|---|---|---|
| Aligner orientation, outer trim loop, central opening (`present` / `absent` / `ambiguous`), face cut, strips, contact sampling, tuning, the contour cache | dental policy | `dental/{orient,orientation,rim,pose,topology,contour,opening,region,bands,sampling,footprint,incidence,cache,mesh}.rs` |
| Which faces are permitted, the candidates, the gap alternates, structure flags and the Tree/Brace choice, rings, landing rule, match tolerances, repair budget | dental policy, as data, made in Rust (`dental_policy`) | `dental/policy.rs` -> `PolicyResult` |
| Thresholds, default strip width, density, setback, spacing, repair budget, match tolerance and normal dot, card art, names | aligner profile (serde JSON, unknown keys are an error) | `dental/profiles/<id>.json` |
| Paint-from-scratch area when detection finds none, the older fill | dental policy | `dental/legacy.rs`, host stamps in `src/dental/manualArea.ts` |
| Diagnostic review layers and their colors | dental, review only | `dental/review.rs` (`diagnose`) |
| Generic placement: downward faces, regions, Poisson field, island minima, ridges, edge anchors, deterministic `auto-X_Y_Z` IDs; the generic `PolicyResult` (`generic_policy`) | generic policy | `generic/placement/`, `generic/policy.rs` -> `PolicyResult` |
| Every support part: tip, neck, foot, pillar, Tree, Brace, roof, cage, raft, label; attribution tags | supports | `supports/parts/` |
| Voxel remesh (OpenVDB VolumeToMesh port) | supports (the builder lands on it) | `supports/remesh/` |
| Zones (no-support areas), the one brush-stamp rule and manual-edit bookkeeping (compose, remap, rekey, hiding removals) | supports | `supports/zones.rs` (`zoned_at`), `supports/policy.rs` (`AreaStamp::resolve`), `supports/edits.rs` |
| Which contacts a zone, the tree layout or the policy leave out of a build | supports | `supports/omit.rs` |
| Overhang classification | supports | `supports/overhang.rs` |
| Collision index, exact triangle tests, first non-exempt hit per component | supports | `supports/safety/{index,tri,conflicts}.rs` |
| Intentional contact reach versus crossing | supports | `supports/safety/reach.rs` |
| Which crossing parts to switch off or leave out | supports (repair order is fixed) | `supports/safety/clearance.rs`, `supports/generate/repair.rs` |
| Permit step: match to candidates, landing mask, source-face identity | supports | `supports/generate/{permit,enrich}.rs` |
| Island verdict and topology births, built-path reachability | supports | `supports/generate/islands.rs`, `supports/safety/{births,paths}.rs` |
| Rim (ring) coverage (the longest gap; ring errors make the verdict inconclusive) | supports (shared, thresholds are policy data) | `supports/safety/rings.rs` |
| Overhang-coverage warning (non-gating) | supports | `supports/check/` |
| The one `generate` call, `revision` echo, timeout, verdict | supports | `supports/generate/mod.rs`, WASM `geometry-wasm/src/safety.rs` |
| Vector math and JavaScript-exact numbers | core | `core/vec.rs`, `core/jsnum.rs` |
| Workers, revision stamping, cancel, export gate, problem list, settings, presets, project files, i18n | TypeScript host | `src/workers/`, `src/supports/{jobRunner,generateSupports,exportGate,islandProblems,omittedProblem}.ts`, `src/dental/` |

## Two independent checks

`Body Clearance` and `Early-Layer Islands` are separate checks with separate verdicts.
- **Body clearance** asks whether a finished support part passes through the model. Verdict `clear`, `blocked` (the result records part, contact where one owns the part, and face) or `inconclusive`. A timeout is always `inconclusive`.
- **Islands** ask whether each new region of the model has a verified chain of built supports down to the plate. Status `resolved`, `unresolved`, or `inconclusive` for the whole mesh.

A collision-free support can still start at an unsupported island, and a supported island can sit on a support that crosses the model. Neither verdict substitutes for the other.

## What a policy supplies

`PolicyResult` fields: `permitted_faces`, `candidates`, `alternates`, `structures`, `structure_choice`, `repair_budget`, `landing_rule`, `automatic`, `rings`, `islands_outside_permitted`. Rust makes it (`GeometrySession.dental_policy` with a required profile, `GeometrySession.generic_policy`); the host passes the handle to `generate`. See the table in [technical-algorithm.md](technical-algorithm.md#the-contract-between-a-policy-and-the-engine). Adding a mode means writing a new producer of this struct. The engine does not change.

Differences between the two policies are only these values:

| | Generic | Dental |
|---|---|---|
| Permitted faces | every face | recomputed contact strip (painted from scratch: the paint) |
| Landing rule | unrestricted | approved faces: an upward source face inside `permitted_faces` that the last paint stamp reaching the landing does not erase (a closure over each landing, not a per-face mask) |
| Automatic rule | candidates as given | match candidates (profile `matchToleranceMm` 0.03 mm, `matchMinDot` 0.95); painted from scratch: its own fill contacts as given |
| Tree and Brace | the settings | the aligner's Step 3 switches |
| Roof and cage | allowed | off |
| Rings | none | outer rim and opening rim |
| Alternates | none | gap alternates (phase-zero samples), each offered to one primary |
| Islands outside the area | none (no outside) | reported as outside-policy |
| Repair budget | 0 (reports, does not repair) | profile `repairBudget` (8), counted exactly |

## Safety behavior shared by both policies

- Manual contacts are never moved or deleted. A manual crossing is reported.
- Repair order: switch off a crossing Tree or Brace, move a crossing automatic pillar to the next alternate if one exists, otherwise leave it out, and as the last bounded step build the manual contacts alone. Every rebuild counts against `repair_budget` exactly; with a budget of 0 (the generic policy today) the engine reports crossings and does not repair them.
- A contact end without face identity is `inconclusive`, never exempt. A timeout and a ring that cannot be measured are `inconclusive` too, never `clear`.
- Preview and export come from the same `generate` result path. Export is refused for stale, failed or inconclusive results.

## TypeScript that remains, and why

`scripts/geometry-allowlist.json` lists every production file the guard flags: 35 files, 29 `host-adapter` and 6 `host-math`. See [wasm-geometry-inventory.md](wasm-geometry-inventory.md) for the table and [technical-algorithm.md](technical-algorithm.md#host-and-guard) for what the guard flags and forbids. Examples of what stays in TypeScript (all on the allow-list): the thin calls into the Rust core (`src/supports/{jobRunner,supportBuildWasm,contactEdits,checkSupports,zoneCheck,omittedProblem,supportFrame,unitSupports}.ts`, `src/core/analysis/{dental,dentalOrient,supportCheck}.ts`), `src/dental/arrange.ts`, `src/components/{useDentalFlow,useFixSpot}.ts`, the viewport and brush hooks (`src/components/viewport/useScreenBrush.ts`), and the Node-side review build (`scripts/dental-region-review/build.ts`). Other host files that do no geometry (for example `src/supports/{generateSupports,genericPolicy,genericPlacement,exportGate,islandProblems}.ts`, `src/dental/{placement,legacyArea,diagnose,flow,label,alignerProfiles}.ts`) are not flagged and need no entry.

The TypeScript oracle directory `scripts/test-support/ts-oracle/` is deleted. Its comparisons live on as recorded golden files in `scripts/fixtures/golden/`. No production code imports test-support code; the guard fails if it does.

## Contracts for extraction or porting

1. **Dental detection**: indexed mesh in local millimetres -> outer loop, optional opening loop, source edge and face IDs, or `inconclusive`. It must not turn another sharp edge into an aligner rim because it is long.
2. **Contact footprint**: contours -> exact source faces, a narrow permitted mask and ordered face-anchored samples, or `inconclusive`. It builds no shafts.
3. **Support build**: approved contacts plus settings -> triangles tagged by component and owning contact IDs. Raft, column, tree, brace, roof, cage and label are separately testable parts.
4. **Body clearance**: model and built mesh in one millimetre frame -> per component, the first non-exempt exact hit.
5. **Generate**: the single entry point. A failed or cancelled call returns a typed error and never a partial result. Over-capacity inputs return `CAPACITY` (host code `over-capacity`).
