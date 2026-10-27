# Dental support algorithm (shipped state)

This document is for engineers. It describes what the code does at the end of unit U10 of [the ship plan](../docs/SHIP-PLAN.md). For the layer rules see [support-module-boundaries.md](support-module-boundaries.md). For the plain explanation see [plain-language.md](plain-language.md).

**Not clinically validated.** Every threshold below was calibrated on one owner-approved scan, `docs/dental-reference/reference-aligner.stl`. See [What is validated and what is not](#what-is-validated-and-what-is-not).

## Where things run

All geometry is in Rust: `crates/geometry-core` (pure library, no browser dependency) and `crates/geometry-wasm` (the `wasm-bindgen` wrapper). TypeScript is the host. A guard (`scripts/geometry-guard.mjs`, run by `src/geometryGuard.test.ts`) fails the test run if production TypeScript does geometry; see [Host and guard](#host-and-guard).

```
crates/geometry-core/src/
  core/      mesh, STL import, weld, decimate, matrix, transform, normals, spatial index, pick, brush, overlay
  supports/  everything that is not specific to a mode:
               parts/ (tip, neck, pillar, foot, tree, brace, roof, cage, raft, label, ...)
               remesh/ (OpenVDB VolumeToMesh port), build, zones, edits (manual-edit bookkeeping)
               safety/ (collision index, exact triangle tests, conflicts, reach, clearance, births, paths, rim, preflight)
               generate/ (permit, repair, enrich, islands), check/ (overhang-coverage warning)
               policy.rs, settings.rs
  generic/   generic placement and the generic policy
  dental/    orientation, rim, pose, topology, contour, opening, region, bands, sampling, footprint,
             incidence, policy, legacy fill, review layers, profiles/
crates/geometry-wasm/src/  dental.rs, generic.rs, safety.rs, lib.rs
```

Layers are one-way: `core` is used by `supports`, which is used by the policies `generic` and `dental`. No collision, landing, repair or mesh-building code lives in a policy. Rust files are kept under about 400 lines except test files.

## The contract between a policy and the engine

A policy produces a `PolicyResult` (`supports/policy.rs`). It is data. There are no callbacks.

| Field | Meaning |
|---|---|
| `permitted_faces` | Bitset over source faces. Dental: the contact strip plus the operator's paint. Generic: every face. |
| `candidates` | Primary contacts: id, source face, point, normal, origin (`Auto` or `Manual`). |
| `alternates` | Ordered repair options per contact. **No policy supplies any today** (see the validation section). The runner and `select_gap_alternates` are tested with synthetic ones. |
| `structures` | Allowed pillar, tree, brace, roof, cage, raft flags. Dental: roof and cage off. The flags are an upper bound on the user's settings (`limit_structures`). |
| `repair_budget` | Maximum rebuilds. 0 means report only. Dental default is 8 (profile data). |
| `landing_rule` | `Unrestricted`, or `ApprovedFaces { stamps }`: a column or tree may land on the model only on an upward-facing source face inside `permitted_faces`; a later paint stamp at the landing point can erase or restore it. Dental uses `ApprovedFaces`. |
| `automatic` | `AsGiven` (generic: the candidates are the contacts) or `MatchCandidates` (dental: an automatic contact is built only if it reproduces a candidate within 0.03 mm and normal dot above 0.95, and it then takes that candidate's source face). |
| `rings` | Closed contours with a nominal contact spacing and the arclength of each candidate on them (dental: outer rim and opening rim). Used for the rim-gap report. |

A new mode is a new producer of this struct. Nothing else changes.

## One `generate` call

`GeometrySession.generate` (`crates/geometry-wasm/src/safety.rs`, core `supports/generate/mod.rs`) takes the model handle, the contacts, the settings, zones, the policy data, a `revision` (u32) and a timeout in milliseconds. It runs the whole pipeline and returns the support mesh arrays with component tags, the verdict, the dropped lists, the island verdict, the ring coverage, the number of rebuilds and the echoed revision. TypeScript never runs a retry loop. `src/supports/jobRunner.ts` is about 80 lines: it moves contacts and zones to plate space, builds the policy input and makes the one call.

Steps inside `generate`:

1. **Limit structures.** The policy's `structures` bound the settings.
2. **Permit.** (`generate/permit.rs`) Apply `automatic` (match to candidates). Apply the landing rule as a per-face mask handed to the builder. Contacts the policy never permitted are reported as dropped.
3. **Build and repair.** (`generate/repair.rs`) Build the supports, run the exact check on the finished mesh, and repair inside `repair_budget`. Every rebuild counts. Order:
   - a crossing Tree switches Tree off; a crossing Brace switches Brace off (reported as `fallback`);
   - a crossing automatic pillar moves to the next entry of `alternates` if the policy has one, and is otherwise left out;
   - the last bounded step builds the manual contacts alone (fail-safe).
   Manual contacts are never moved or deleted. A manual crossing is reported.
4. **Verdict.** (`safety/clearance.rs::review_body_clearance`) See the next section.
5. **Islands.** (`generate/islands.rs`) See [Islands](#islands).
6. **Rings.** (`safety/rim.rs`) For each ring, the longest circular gap between retained built automatic contacts. A rim with no retained contact reports its full perimeter. The report trigger is twice the nominal spacing (6 mm outer, 4 mm opening at default density). It is a request to review, not a clinical limit.

A timeout is a host option (`GENERATE_TIMEOUT_MS`, 120 s in `src/supports/jobRunner.ts`). The engine polls it between steps. When it expires the remaining work is skipped and the verdict is `inconclusive`.

## Safety verdict

`Verdict { status, reason, issues }` with `status` one of:
- `clear`: no non-exempt crossing was found and every contact end had face identity.
- `blocked`: at least one crossing. `issues` lists the crossed part, the contact and the model face.
- `inconclusive`: a contact end has no face identity, the model cannot be judged (for example invalid triangles), or the timeout expired. **A timeout is never `clear`.**

With no model to check against, the verdict is `clear` because nothing can cross.

The check (`supports/safety/`): one `CollisionIndex` per call (X/Z grid over model triangles); the exact triangle intersection predicate for each selected support triangle against nearby model triangles; `conflicts` returns the first non-exempt hit per component and keeps searching after an approved hit, so a second wall is not hidden. `reach` decides whether a hit is intentional: a built component may touch the model only where one of its recorded contact intents proves it, near the exact tagged source face (or a face sharing exactly one indexed edge with it and matching normals), within a bounded distance and penetration depth. No face identity means no exemption. Trunks and braces have no exemption. The numeric limits are in `supports/safety/clearance.rs` and are the values ported from the earlier TypeScript; they are engineering bounds, not clinical thresholds.

Policy differences are data only. Both policies use the same check. The repair order (Tree or Brace off, alternate, leave out, manual-only) is the engine's and is the same for both, but it only runs inside `repair_budget`: the generic policy sets 0, so a generic build reports crossings (verdict `blocked`) and is not repaired. (`repair.rs`: repair is active only when the budget is above 0 and a model is present.)

### Route preflight: ported, not wired

`safety/preflight.rs` holds the route preflight (`preflight_support_path`), the column path screen and the candidate chooser, ported with their tests. They are not called by `generate`. The ship plan's rule was to keep them only if they gave zero false-safe results and a measured benefit on a collision-heavy fixture. The earlier measurement showed no measurable benefit (one warm comparison was 5.35 s against 5.42 s), so the final exact check is the only gate. They remain in the crate as tested building blocks. If you wire them, re-measure.

## Islands

`island_verdict` (`generate/islands.rs`) uses the topology-birth sweep (`safety/births.rs`): sort mesh vertices by height, union same-height plateaus, and record each region with no lower neighbor as a birth. About O(V log V + E alpha(V)); it does not slice print layers. Degenerate triangles are skipped. Edges shared by more than two triangles make the sweep refuse.

Each birth is linked to what the nearest built support rests on: the plate, or the lowest island of the surface it lands on (`safety/paths.rs`, `resolve_birth_paths`). A built contact within one cover radius of an island's lowest point and at or below it links the island. Proximity alone is never a path: a link counts only when it is verified, and a contact that the body-clearance check marked blocked does not verify.

Island status:
- `resolved`: a chain of verified links reaches the plate. If the chain depends on a manual support, the island carries `manual_only`.
- `unresolved`: no such chain.
- `inconclusive` (whole verdict): the mesh could not be analysed. `scripts/fixtures/knot.stl` gives `inconclusive: non-manifold edge` because 4,011 edges are shared by four triangles (the tube touches itself). That is a property of the file.

### Dental islands outside the policy area

The reference aligner at default settings has 54 islands: 6 resolved, 5 `unresolved` on permitted faces, and 43 `OutsidePolicy`. An unresolved island is `OutsidePolicy` when none of the faces around its lowest point is permitted; this applies only when the policy has an approved-area landing rule, so the generic policy never produces it (`supports/generate/islands.rs`, wasm status code 3). The host groups all of them into **one informational problem-list entry** (kind `outside`, Show only, no Fix, not counted as an unsupported spot): "43 low points lie outside the dental support area and are left to the aligner shape." Islands on permitted faces stay `unresolved` entries with Show and Fix. The status bar on the reference aligner reads 6 spots (5 islands + 1 uncovered overhang).

## Problem list (host)

`src/supports/islandProblems.ts` turns the island verdict into `SupportProblem` entries (`island`, `overhang`, `unjudged`, and with the change above `outside`):
- an `unresolved` island is an `island` entry at its lowest vertex with Show and Fix;
- `resolved` and manual-only islands are not problems;
- `inconclusive` is one `unjudged` entry ("Could not judge islands on this mesh") without Show or Fix; the status line says "Islands could not be judged on N objects" instead of clean;
- a Check with no current build has no verdict and reports that it did not finish, never clean.

`overhang` is the Rust check's overhang-coverage warning (`supports/check`). It is non-gating. The old island heuristic was removed from that check. `blocked` body verdicts are not in the problem list because every generic build is blocked (supports touch the model); the dental `issues` carry the evidence.

## Revision, cancel and the export gate

- Every request carries a `revision` u32. `generate` echoes it. `SupportMeshClient` stamps each request, and a result is delivered only if it answers the newest request of its unit and mode.
- `cancel(unitId)` terminates the running worker. The next request gets a fresh worker, which frees its whole WASM instance. `live_mesh_handles()` returns to 0 (tested in `src/workers/resultPath.test.ts`). The `generate` call is synchronous inside the worker, so cancel is observable between calls, not inside one. A replaced running build restarts the worker after 800 ms; the revision drop covers correctness.
- **Export gate** (`src/supports/exportGate.ts`). Export returns the files plus each unit's revision, verdict and island verdict, and refuses with a visible message (en, ja, zh-Hant) and no file written when a result is: `stale` (the unit changed meanwhile, or another revision), `failed` (no result for a unit with supports in the files), or `inconclusive` (the body-clearance verdict). Not refusals: a `blocked` verdict, and an inconclusive island verdict. Both are shown in the problem list.
- `OVER_CAPACITY`: the engine's wire code is `CAPACITY` (`MeshError::Capacity`, `StlError::Capacity`). The host maps it to the error code `over-capacity` with one message per job; import names the file.

## Detection pipeline (dental policy)

Order: `orientation → outer and inner mesh-edge loops → broad face cut → side labels → narrow mesh-distance strips → sampled contact faces → PolicyResult`.

The loops define where the strips begin. The face cut is still required: it labels the two incident faces of each contour edge as `opening side` or `other side`. The strips are then built from the edges along the mesh, and only the `other side` is permitted. The broad face group is **not** a support area.

Reference numbers (one scan): outer loop 2,665 edges, opening loop 339 edges, 254,344 opening-facing faces and 119,612 other faces in the cut, 13,176 faces in the default narrow strip, 117 proposed tips. These are checked by the tests in `src/core/analysis/dentalRustParity.test.ts` against recorded golden files.

### Input and output

The mesh is an indexed triangle mesh in local millimetres. The result is a proposal or `inconclusive` with a machine-readable reason. An inconclusive result returns no partial mask. Masks are tied to input triangle indices, not to a transformed raster, so rotating the mesh must leave the per-face answer unchanged (tested over 100 random poses).

### 1. Orientation frame (`orient.rs`, `rim.rs`, `pose.rs`)

Compute the vertex mean and the 3 x 3 covariance. The smallest-eigenvalue eigenvector is the candidate cavity axis. Reject if smallest over largest eigenvalue exceeds 0.6 (`axialVarianceMax`). Project vertices on the axis. Sum triangle area (by centroid) in the outer 14% of the range at each end; the end with less area is the opening. Reject an end-area difference below 18% of their sum. Reject confidence below 0.12, where confidence is the difference ratio times one minus the eigenvalue ratio.

Let `openingDirection` point to the lower-area end. The reference axis is `(1,0,0)` unless `abs(openingDirection.x) >= 0.8`, then `(0,0,1)`. `tangent = normalize(reference x openingDirection)`, `bitangent = normalize(openingDirection x tangent)`.

### 2. Mesh graph and the outer ridge (`topology.rs`, `contour.rs`)

Build unit normals and undirected edges. Every edge must have exactly two faces. Reject a boundary edge, a non-manifold edge or a degenerate triangle. An edge is sharp at angle `theta` when `abs(dot(n1, n2)) <= cos(theta)`. The absolute value tolerates locally reversed winding but does not repair globally inconsistent normals.

At 60° sort connected sharp-edge components by size. Require the largest two to be simple open chains (two degree-1 ends, all other vertices degree 2). Require at least 500 and 300 edges (1,628 and 831 on the reference) and require the largest to span at least 60% of the model extent in both opening-plane axes. Build a 20° sharp-edge graph, excluding the chain edges. For both end pairings, find shortest paths by 3D edge length (Dijkstra). Accept the shorter pairing only if the result is one simple closed loop (every vertex degree 2, edges equal vertices). On the reference the connectors are 10.55 mm / 38 edges and 40.39 mm / 168 edges. The loop has 2,665 edges, 2,459 in the chains (blue) and 206 added (green).

### 3. Central opening (`opening.rs`)

Rasterize all triangles projected on the tangent/bitangent plane with a two-pixel margin. Flood-fill empty pixels (4-connected). The one empty component not touching the border is the hole; require exactly one hole of at least 1% of the image. Lift it back to mesh edges: keep an edge if its two face normals have opposite signs against the opening direction and its projected midpoint is within two pixels of the hole. Keep the large loop only if there is no other branch and any extra loop has at most 10 edges. Run at 256 and 512 pixels and require the same exact edge set.

The result is `present`, `absent` or `ambiguous`. No enclosed hole at both resolutions is `absent`. A stable identical lifted loop is `present`. Small or multiple holes, a failed lift or a resolution disagreement is `ambiguous`. **Ambiguous never becomes absent.** `absent` on a profile that expects an opening is the Step 1 type-mismatch prompt, and is `inconclusive` for automatic supports. The raster only locates the hole; it never defines the 3D support region.

### 4. Face cut and side labels (`region.rs`, `bands.rs`)

Build triangle adjacency, block it across every edge of both loops, and require exactly two face regions. Choose the opening-facing region only if its mean face-normal dot with the opening direction is at least +0.2, the other is at most -0.15, and the chosen region holds 20% to 85% of the faces. A region that fails these is `inconclusive`.

### 5. Narrow strips (`bands.rs`, `footprint.rs`)

Seed the two incident faces of each contour edge, each at its 3D centroid-to-edge-midpoint distance. Run bounded multi-source Dijkstra over 3D centroid distances through neighbors on the same side. Omit centroids closer than `setback` to the ridge and stop at `width`. Default setback 0.2 mm and width 1.2 mm (`setback + stripWidth`). `contactFaces` is the union of the two `other side` masks. It does not cross empty space or a fold of the mesh. A missing opposing face or a side that does not separate makes the result inconclusive.

Tuning (`DentalTuning`, defaults and limits from profile data): `(setbackMm, stripWidthMm, density) = (0.2, 1.0, 1.0)`. `setback = setbackMm`, `width = setbackMm + stripWidthMm`, `outerSpacing = 3 / density`, `innerSpacing = 2 / density`, `maxSearchDistance = 1.5`. UI limits: `0 <= setbackMm <= 1`, `0.2 <= stripWidthMm <= 2.4`, `0.5 <= density <= 2`. These are interface limits, not clinical ranges. A retune reuses the accepted contours and side labels and recomputes the mask and samples. The host debounces it (180 ms), and Step 2 shows the new overlay after the worker returns.

### 6. Contact sampling (`sampling.rs`, `incidence.rs`)

`inspect_contour_incidence` requires one simple closed, two-sided loop. Order the loop from its lowest vertex, measure segment length in original 3D millimetres and sample at `spacing/2 + k*spacing`. For each sample, search from the two incident faces without crossing a contour edge, accumulating 3D centroid-path distance up to twice `maxSearchDistance`. Select the nearest reachable source-face centroid in the chosen strip within 1.5 mm. Skip the sample if both sides reach the strip or no face qualifies. Keep each source face once. Each contact carries the face index, centroid, normal, distance along the loop and distance from the contour. Default spacing is 3 mm (outer) and 2 mm (opening). The 2 mm opening spacing replaced 5 mm, which left a 25 mm unsupported arc; it is not validated as universal.

### 7. Painting

Paint stamps (`AreaStamp`: center, radius, normal, add or remove) apply in order, last one wins, but only inside the recomputed mask. Add cannot extend beyond the strip. When detection finds no area at all, Step 2 builds a `manual-area` policy from the stamps (`manual_dental_area_from_stamps`). It is refused when an area was detected. Contacts created this way go through every later safety check. The `legacy` fill (`dental/legacy.rs`: area rules, opening raycaster, face fill) places points for that policy.

A saved policy is recomputed on use, never grandfathered (`src/dental/savedPolicy.test.ts`). A changed mask, contour or primary contact is rejected.

## Aligner profiles

Dental behavior is parameterised by an `AlignerProfile`, a JSON file in `crates/geometry-core/src/dental/profiles/`. The profile holds:
- `id`, per-language `name` and `description` (en, ja, zh-Hant);
- `opening`: `yes`, `no` or `either`;
- `card`: top-view line art as SVG path data in a 120 x 90 box;
- `fixture`: the reference scan path;
- `thresholds`: all the detector numbers used above (axial variance, terminal band, sharp angles, loop and ridge minimums, opening resolutions, region means and fractions);
- `defaults`: setback, strip width, density, their limits, outer and inner spacing, max search, and `repairBudget`.

The same file is read by Rust (`profiles/mod.rs`, embedded with `include_str!`, listed in `ALL`) and by the host (`src/core/analysis/dentalProfile.ts`, `src/dental/alignerProfiles.ts`), which makes the Step 0 cards. One profile exists today: `reference-aligner`.

### Adding an aligner type

1. Add `crates/geometry-core/src/dental/profiles/<id>.json` with all the fields above.
2. List it in `ALL` in `profiles/mod.rs` (`include_str!`).
3. Import it in the host profile list (`src/core/analysis/dentalProfile.ts` and `ALIGNER_PROFILES` in `src/dental/alignerProfiles.ts`). The card, name and description then appear in Step 0 with no UI code.
4. Add the reference fixture STL and its checks: golden files, labeled faces (`docs/dental-reference/face-labels.json` is the reference's), random-pose test, opening present/absent/ambiguous cases.

`src/dental/alignerProfiles.test.ts` fails if the Rust registry and the host list differ. Steps 2 to 4 above are inferred from that test and the file headers; no second profile has been added yet, so this procedure has not been exercised.

## The dental flow (host)

Step 0 type cards (shown even with one profile). Step 1 drop (mesh check for holes or non-manifold geometry first; detection is marked unreliable if the check fails; automatic orientation in a worker; type-mismatch prompt "Switch?" re-runs detection with the other profile; uncertain orientation keeps the dropped pose; bad or too large files show a message and stay). Step 2 area (tuning sliders, Add area and Remove area paint, no-area branch). Step 3 supports (tip size, density, lift, raft, Tree and Brace, add and delete selected supports, problem list, Label, OK, Add another aligner). Back from Step 3 asks before it discards manual edits. Exit keeps finished aligners and clears the current one's policy and supports (`src/dental/flow.ts`). `src/dental/arrange.ts` re-arranges every aligner on the plate without overlap on every drop and finish.

Label rules (`src/dental/label.ts`): default `X`, at most 8 characters, `A-Z`, `0-9` and `-`; other characters are dropped and lower case becomes upper case. It is embossed on the raft base from the shared `labelFont.json` glyph data (digits and `-` are present).

## Golden files, fixtures and how to regenerate

- **Reference aligner**: `docs/dental-reference/reference-aligner.stl` (the only dental fixture). Root `Aligner.stl` and `dentalwork/fixtures/` are not gates.
- **Generic fixtures**: `src/goldens/fixtures.ts` (cube-overhang, knot, thin-slab, v-ridge; standard and low-poly variants). End-to-end snapshots are in `src/goldens/__snapshots__/`. Regenerate by hand with `npx vite-node scripts/update-goldens.ts` (refuses to run in CI), and only after an intended output change.
- **Recorded parity goldens**: `scripts/fixtures/golden/` (about 170 files, 1.9 MB: builder, dental, generic, import, knot, legacy, review, safety, rustSupports). They replaced the TypeScript oracle. Helper `scripts/test-support/golden.ts`: IDs, tags, indices, omitted counts and verdicts compared exactly (big arrays as FNV-1a hashes); positions as strided samples within 1e-5 mm. Regenerate one test's files from the current Rust output with `UPDATE_GOLDENS=1 npx vitest run <that test file>`, then review the diff in the commit. Without the variable a missing golden is an error and a mismatch fails.
- **Face labels**: `docs/dental-reference/face-labels.json` (allowed and forbidden faces of the reference as run-length lists). Regenerate with `npx vite-node scripts/dental-face-labels.ts`. Every tip and secondary landing must sit on an allowed face.
- **Other corpora**: odd-STL corpus in `scripts/fixtures/stl-corpus/` (24 files), brush strokes in `scripts/fixtures/brush/`, `scripts/fixtures/knot.stl`.
- Parity rule: vertex positions within 1e-5 mm (JavaScript and Rust trig differ in the last bit). A larger difference needs a fixture, a rationale and a visible note.

Baseline commands: `cargo test --workspace`; `npm run wasm:build && npm run wasm:test`; `npx vitest run --maxWorkers=1 --testTimeout=60000`; `npx tsc --noEmit`; `npm run build`; `npm run walk` (and `WALK_LOCALES=en,ja,zh-Hant node scripts/walk.mjs` for the locale walk); browser smoke with `npx vite --host 127.0.0.1 --port 5173` and `python scripts/geometry_wasm_browser_smoke.py`.

## Host and guard

TypeScript owns UI, React, Three.js buffer copies, camera and gizmo, files, worker lifecycle, settings and project serialization (presets stay TypeScript and are sent to Rust as validated numbers), and translations (en, ja, zh-Hant; zh-Hant is translated with Gemini in Taiwan wording).

`scripts/geometry-guard.mjs` scans `src/` and `scripts/dental-region-review`. A file is flagged if it imports a geometry module or contains vector math. Every flagged file must be in `scripts/geometry-allowlist.json` as `host-adapter` (no math of its own) or `host-math` (a justified small amount of render or camera math, with a `why` and a ratcheting `maxMath`). The guard fails on an unlisted flagged file, any other label, a listed file that is gone or no longer flagged, and on any production import of test-support code. At U9 there are 35 flagged files, 5 of them `host-math`.

## Performance (U10 gate)

Measured with `npx vite-node scripts/perf-baseline.mjs` (median of 3 in Node, not a browser) against `dentalwork/perf-baseline.json`. No hard target was set; the aim was no obvious regression.

| Measure | Baseline (pre-port) | Final |
|---|---|---|
| Import of the reference aligner | 195.3 ms | 62.2 ms |
| Dental Generate on the reference (117 contacts, 38,032 support triangles, 16 dropped) | 12.25 s | 3.50 s |
| Knot Generate (150 contacts, 48,160 triangles) | 1,440 ms | 70.8 ms |
| Brush p95, 48-triangle supports (`scripts/brush_perf.py`) | 0.1 ms | 0.1 ms |
| Brush p95, 1,920-triangle supports | 3.2 ms | 1.1 ms |
| Pick index build | 207 ms | 271 ms (one-off) |

The contact count, triangle counts and dropped counts are identical to the baseline.

## What is validated and what is not

Validated, on one reference aligner:
- Loops of 2,665 and 339 edges; the face mask, four edge sets, contact faces and tip IDs match the recorded goldens; positions within 1e-5 mm at three tunings.
- 100 of 100 seeded random poses within 0.02 mm.
- A covered opening is `absent`; a split opening is `ambiguous` (never `absent`); a cube abstains.
- Every tip and secondary landing candidate sits on an allowed face per `face-labels.json`.
- A saved policy is recomputed on use.
- Rust `generate` matches the earlier TypeScript flow on two walls, brace fallback, Tree with both leaves, landing mask, export mode and the aligner (recorded as goldens).
- Fresh U10 evidence on one revision: `cargo test --workspace` 176 + 3 + 1 passed; `npx tsc --noEmit` clean; full Vitest 126 files / 1,183 tests; browser smoke pass; `npm run walk` 66 checks pass; locale walk in en, ja and zh-Hant 18 checks pass.

Not validated:
- **Only one reference STL exists.** Thresholds are calibrated to it. Rotations of it do not substitute for other patient models.
- **U6b (external validation) is pending**: a second aligner with an opening and a real aligner with no opening. Until then, dental mode ships labeled preview / not clinically validated.
- **No-opening aligners**: `absent` is inconclusive for automatic supports. Only a synthetic no-opening mesh exists.
- **No physical print or fit review** on a printer and resin.
- **Island check is geometric**, not a print simulation. Dental low points outside the support area are reported for information only; this is a policy choice (lead decision 2026-10-28, reversible) that has not been checked against real prints.
- **`knot.stl`**: the island verdict is `inconclusive` because the mesh is non-manifold. The generic Generate itself works.
- **Route preflight** is ported but unwired (see above).
- **Alternates**: no policy supplies them, so a crossing automatic pillar is left out rather than moved. Rim-gap reports can therefore remain.
- **Neck penetration**: intentional-reach exemptions are bounded engineering limits, not proof that every neck touch is intended. The earlier TypeScript measurements counted thousands of neck-to-model triangle pairs that were not classified by depth; whether the Rust classifier changes that was not re-measured here.
- **Blocked body verdicts** are not individually listed in the problem list.
- **Unverified in this document**: the numeric reach limits in `clearance.rs` (not re-read for this document).
- Left-handed hosts (a future Babylon.js host): `src/workers/babylonContract.test.ts` checks the left-handed contract without loading Babylon itself.

## Pose of the diagnostic GLB

The review GLB is rotated into a calibrated pose (`pose.rs`, `dental_pose`). It does not change triangle indices or face membership. Project vertices on the opening plane and take the 2 x 2 covariance. Reject a nearly symmetric footprint when eigenvalue spread over trace is below 0.05. In principal-plane coordinates keep points with major-axis fraction between 0.3 and 0.7, and count occupied cells of a 40 x 40 grid in the outer 22% band at each minor-axis end. Reject if the larger count is below 20 or below twice the smaller. The denser end is the arch front. The rotation maps the source frame `(sourceSide, front, openingDirection)` to a target frame taken from the one approved reference pose. If the arch front cannot be estimated, no GLB is written. The target pose is not a universal print angle.

## Earlier methods (reference only)

The first `lower-edge-loop` and ray method found a tiny ridge, not the full trim. A later probe found the largest smooth opening-facing patch, which reached tooth-height surfaces (`scripts/probe-dental-edges.ts`). Using the full opening-facing group as the support mask gave 397 tips on one run and overpainted areas above the trim. None of these grant contact permission now. The old images and explanation are in [docs/dental-reference](../docs/dental-reference/README.md).

## To rebuild this in another language

Preserve mesh indexing and triangle order. Compute the orientation frame and the manifold edge-to-faces table. Extract the 60° outer chains and join them on the 20° graph. Rasterize and lift the central hole at both resolutions. Cut face adjacency along both loops and classify the two groups. For each contour edge, seed a bounded 3D face-distance search on each side and keep the `other side` faces between setback and width. Union the outer and inner masks. Sample each ordered contour at its spacing and move each sample to a reachable exact source face within 1.5 mm in the mask. Emit the faces, the candidates and the policy fields above. Any failed check returns `inconclusive`, never a partially painted mask.
