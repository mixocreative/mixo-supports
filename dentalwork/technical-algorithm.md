# Dental support algorithm (shipped state)

This document is for engineers. It describes what the code does at the commit that last changed this file (the ship plan's units and the review fixes after them; see [the ship plan](../docs/SHIP-PLAN.md)). For the layer rules see [support-module-boundaries.md](support-module-boundaries.md). For the plain explanation see [plain-language.md](plain-language.md).

**Not clinically validated.** Every threshold below was calibrated on one owner-approved scan, `docs/dental-reference/reference-aligner.stl`. See [What is validated and what is not](#what-is-validated-and-what-is-not).

## Where things run

All geometry is in Rust: `crates/geometry-core` (pure library, no browser dependency) and `crates/geometry-wasm` (the `wasm-bindgen` wrapper). TypeScript is the host. A guard (`scripts/geometry-guard.mjs`, run by `src/geometryGuard.test.ts`) fails the test run if production TypeScript does geometry; see [Host and guard](#host-and-guard).

```
crates/geometry-core/src/
  core/      mesh, stl (import), weld, decimate, digest, matrix, transform, normals, spatial index, pick,
             brush, overlay, nearest (nearest point), vec (the one vector module), jsnum (JS-exact hypot, rounding)
  supports/  everything that is not specific to a mode:
               parts/ (tip, neck, column, pillar, foot, tree, autotree, brace, roof, cage, raft, label, font, landing, ...)
               remesh/ (OpenVDB VolumeToMesh port), build, omit (which contacts a zone, the tree layout or the
               policy leave out), zones, edits (manual-edit bookkeeping), contact_id, line_target, flat,
               overhang (overhang classification), error, policy, settings/
               safety/ (index, tri, conflicts, reach, clearance, births, paths, rings)
               generate/ (permit, repair, enrich, islands), check/ (overhang-coverage warning)
  generic/   generic placement (placement/) and the generic policy
  dental/    orientation (orient, orientation), rim, pose, topology, contour, opening, region, bands, sampling,
             footprint, incidence, policy, legacy fill, review layers, cache (contour detection cache), mesh, profiles/
crates/geometry-wasm/src/  lib.rs, import.rs, transform.rs, spatial.rs, overlay_calls.rs, dental.rs, dental_area.rs,
                           dental_review.rs, generic.rs, safety.rs; test-abi only: dental_test_abi.rs, generic_test_abi.rs
```

Layers are one-way: `core` is used by `supports`, which is used by the policies `generic` and `dental`. No collision, landing, repair or mesh-building code lives in a policy. Every Rust file is under 400 lines (the largest, `crates/geometry-wasm/src/safety.rs`, has 378 including its tests); this is a ship-plan rule checked with `wc`, not enforced by a test. The layer rule is enforced by `crates/geometry-core/tests/layers.rs`.

## The contract between a policy and the engine

A policy produces a `PolicyResult` (`supports/policy.rs`). It is data. There are no callbacks. Both policies are made in Rust inside the session that runs `generate`: `GeometrySession.dental_policy(model, profile, kind, tuning, stamps, saved allowed faces / contact faces / outer and opening edges, structure switches, frame)` (`dental/policy.rs`) and `GeometrySession.generic_policy(model, settings, automatic and manual contacts, deleted IDs, zones)` (`generic/policy.rs`) return a `PolicyHandle` that the host passes straight to `generate`. The aligner profile is a required argument of every dental call. The host only packs the saved policy as numbers; it never assembles or edits a policy.

| Field | Meaning |
|---|---|
| `permitted_faces` | Bitset over source faces. Dental two-contour: the recomputed contact strip (empty when the saved area does not reproduce). Dental painted from scratch: the painted faces. Generic: every face. |
| `candidates` | Primary contacts: id, source face, point, normal, origin (`Auto` or `Manual`). Dental IDs are `dental-outer-N` / `dental-opening-N` (region order, kept when paint erases one); a candidate passes the face gate (`area_allows`: on the strip, last paint stamp reaching it decides) in Rust. |
| `alternates` | Ordered repair options per contact. Dental: gap alternates. The same contour is sampled again at phase zero (samples at `k * spacing` instead of `spacing/2 + k * spacing`, so they fall in the gaps between the primaries), the samples pass the same face gate (`dental-outer-alt-N`, `dental-opening-alt-N`), and each is offered to the one primary that follows it on its rim within one spacing, so two contacts can never move to one spot. They are never extra primaries. Generic: none. |
| `structures` | Allowed pillar, tree, brace, roof, cage, raft flags. Dental: roof and cage off. The flags are an upper bound on the user's settings (`limit_structures`). |
| `structure_choice` | The policy's own Tree/Brace choice, applied to the settings before the bound (`permit::chosen_settings`). Dental: the per-aligner Step 3 switches (default both on, whatever the generic settings say). Generic: none, the settings decide. |
| `repair_budget` | Maximum rebuilds, counted exactly: every rebuild spends one trial, and the alternate loop keeps three trials for the fail-safe steps. 0 means report only (the generic policy). Dental default is 8 (profile `repairBudget`). |
| `landing_rule` | `Unrestricted`, or `ApprovedFaces { stamps }`. It is evaluated as a closure over each landing (`permit::landing_allowed`), not as a per-face mask: the landing must name a source face; that face must be upward-facing (normal y above 1e-6); it must be in `permitted_faces`; and the last paint stamp that reaches the landing's source point on that face's side decides (`AreaStamp::resolve`; no stamp reaching it means allowed). So a stamp can erase a permitted face or restore an erased one, but never permit a face outside `permitted_faces`. An automatic support whose landing fails is left out. Dental uses `ApprovedFaces`. |
| `automatic` | `AsGiven` (generic: the candidates are the contacts; dental painted from scratch: the fill contacts of the painted area) or `MatchCandidates { tol_mm, min_dot }` (dental two-contour: an automatic contact is built only if it reproduces a candidate within the profile's `matchToleranceMm` (0.03) and normal dot above `matchMinDot` (0.95), and it then takes that candidate's source face). |
| `rings` | Closed contours with a nominal contact spacing and the arclength of each candidate and alternate on them (dental: outer rim and opening rim, spacing from the tuning). Used for the rim-gap report. |
| `islands_outside_permitted` | Whether the policy has an outside: an unresolved island whose lowest plateau touches no permitted face is then `outside-policy`. Dental: yes (all three area kinds). Generic: no. |

A dental policy whose saved area cannot be reproduced from the mesh (`reproduced` false) has no candidates and no permitted face, so no automatic support is built. A new mode is a new producer of this struct. Nothing else changes.

## One `generate` call

`GeometrySession.generate` (`crates/geometry-wasm/src/safety.rs`, core `supports/generate/mod.rs`) takes the plate-space model handle (`load_placed` from the unit's own handle), the contacts, the settings, zones, the `PolicyHandle`, a `revision` (u32) and a timeout in milliseconds. It runs the whole pipeline and returns the support mesh arrays with component tags, the verdict (with its issues), the dropped lists (`take_dropped`, and `take_dropped_by_zones` for the subset a no-support zone caused), the Tree/Brace fallback, the island verdict, the ring coverage, the number of rebuilds and the echoed revision. TypeScript never runs a retry loop. `src/supports/jobRunner.ts` is small: it moves contacts and zones to plate space, names the policy maker (dental or generic) and makes the one call (`generateSupports.ts`).

Steps inside `generate`:

1. **Limit structures.** The policy's `structures` bound the settings.
2. **Permit.** (`generate/permit.rs`) Apply `automatic` (match to candidates; a manual contact always passes). Evaluate the landing rule as a predicate over each landing, handed to the builder (see `landing_rule`). Contacts the policy never permitted are reported as dropped, after the build's own.
3. **Build and repair.** (`generate/repair.rs`) Build the supports, run the exact check on the finished mesh, and repair inside `repair_budget`. Every rebuild spends one trial; a step that cannot spend one is not taken and the crossing is reported. Repair runs only when the budget is above 0 and a model is present, and no step starts once the timeout has expired. Order:
   - a crossing Tree switches Tree off; a crossing Brace switches Brace off (reported as `fallback`);
   - a crossing automatic pillar moves to the next entry of its `alternates`, one rebuild per round, while more than three trials remain; when none is left it is left out;
   - if the rebuild after the omissions exposes another crossing pillar, all remaining automatic contacts are left out;
   - if a Tree or Brace still crosses after that, the last bounded step builds the manual contacts alone with both structures off (fail-safe).
   Manual contacts are never moved or deleted. A manual crossing is reported.
4. **Verdict.** (`safety/clearance.rs::review_body_clearance`) See the next section.
5. **Islands.** (`generate/islands.rs`) See [Islands](#islands).
6. **Rings.** (`safety/rings.rs`, `ring_coverage`) For each ring, the longest circular gap between retained built automatic contacts. A rim with no retained contact reports its full perimeter. The report trigger is twice the nominal spacing (6 mm outer, 4 mm opening at default density). It is a request to review, not a clinical limit. A ring that cannot be measured (a non-positive perimeter or spacing, an arclength outside the perimeter) neither reports "fully open" nor passes: it is left out of the list and a verdict that would have been `clear` becomes `inconclusive` with the ring's reason.

A timeout is a host option (`GENERATE_TIMEOUT_MS`, 120 s in `src/supports/jobRunner.ts`). The engine polls it between steps. When it expires the remaining work is skipped and the verdict is always `inconclusive` (reason `timeout`), whatever was found before: never `clear`, never `blocked`. An island verdict that runs out of time is `inconclusive` too.

## Safety verdict

`Verdict { status, reason, issues }` with `status` one of:
- `clear`: no non-exempt crossing was found and every contact end had face identity.
- `blocked`: at least one crossing that can be judged. `issues` lists, for each hit, the crossed part, the owning contact (absent for a Tree trunk or a Brace, which serve several contacts and record none), the origin (`auto`, `manual` or `structural`) and the model face.
- `inconclusive`: a contact end has no face identity (an issue with `blocked` false and no judged crossing), the model or the support mesh cannot be judged (`invalid-geometry`), a ring cannot be measured, or the timeout expired. **A timeout is never `clear` and never `blocked`.**

With no model to check against, the verdict is `clear` because nothing can cross.

The check (`supports/safety/`): one `CollisionIndex` per call (X/Z grid over model triangles); the exact triangle intersection predicate for each selected support triangle against nearby model triangles; `conflicts` returns the first non-exempt hit per component and keeps searching after an approved hit, so a second wall is not hidden. `reach` decides whether a hit is intentional: a built component may touch the model only where one of its recorded contact intents proves it. Directions and depths are measured against the intent face's own normal, not the intent's recorded normal, because the build takes a neck's direction from the smoothed remesh normal (`line_target.rs`), which on a thin aligner rim can be 50 to 80 degrees off the face. A hit is the tip itself in two cases. (1) **Intended surface**: the hit face is the intent face or is joined to it through shared indexed edges by faces that each face within the dot limit of the intent face and whose bounds touch the reach sphere; the support triangle stays within the reach radius and penetration depth. On a dense mesh (the reference aligner has triangles around 0.1 to 0.2 mm) this covers the several rings of faces a tip spans; the earlier rule accepted only faces one edge away. (2) **Tip seat**: the hit face points another way, but every point where the support triangle crosses it lies within the penetration depth of the contact point, the support triangle goes no deeper than that behind the intent face, and the hit face is joined to the intent face through faces within that depth. This is a tip seated over an edge thinner than its own depth, such as the far side of an aligner rim. A separate wall (its own vertices, even at the same coordinates) is never joined, so it is never exempt. No face identity means no exemption. Trunks and braces have no exemption. The numeric limits are `reach_limits` in `supports/safety/clearance.rs`: radius = neck length + pillar diameter / 2 + contact radius, penetration = tip depth + contact radius + 0.05 mm, face-normal dot at least 0.8. They are the values ported from the earlier TypeScript; they are engineering bounds, not clinical thresholds. The intent face's neighbourhood comes from a vertex-to-face table that `CollisionIndex` builds on first use (`faces_at`).

Policy differences are data only. Both policies use the same check. The repair order (Tree or Brace off, alternate, leave out, manual-only) is the engine's and is the same for both, but it only runs inside `repair_budget`: the generic policy sets 0, so a generic build reports crossings (verdict `blocked`) and is not repaired. A crossing also withdraws island credit: one that names its contact un-verifies only that contact's support, while one with no owner (a Tree trunk or a Brace) is `unattributed_crossing` on the verdict and conservatively withdraws every contact's credit (`withdrawn_contacts` in `generate/mod.rs`). `unattributed_crossing` stays in Rust; it is not part of the browser ABI.

### Route preflight: removed

An earlier port of the route preflight, the column path screen and the candidate chooser (`safety/preflight.rs`) was never called by `generate`: it gave no false-safe evidence and no measured benefit (one warm comparison was 5.35 s against 5.42 s). It was deleted with its tests, so the final exact check on the finished mesh is the only gate. A fast path would need a new measurement and a new implementation.

## Islands

`island_verdict` (`generate/islands.rs`) uses the topology-birth sweep (`safety/births.rs`): sort mesh vertices by height, union same-height plateaus, and record each region with no lower neighbor as a birth. About O(V log V + E alpha(V)); it does not slice print layers. Degenerate triangles are skipped. Edges shared by more than two triangles make the sweep refuse.

Not every birth is an island. A birth is listed only if at least one vertex of its lowest plateau has an area-weighted vertex normal that is not clearly upward; a plateau whose vertices all have `ny / length >= 0.3` is a pit in an upward face with material below it, and is not an island.

Each birth is linked to what a nearby built support rests on: the plate, or the lowest island of the surface it lands on (`safety/paths.rs`, `resolve_birth_paths`). A built contact links a birth when all of these hold (`generate/islands.rs`): its support has a ground (the plate, or a model face whose component joined a birth); the contact point is not higher than the birth height plus `cover_mm`; and the contact point is within `cover_mm` of a face around the birth's lowest plateau (closest point on the triangle). `cover_mm` is the scatter spacing setting (`scatter_spacing`) of the settings actually built. Proximity alone is never a path: a link counts only when it is verified, and the contact of a blocked crossing does not verify (see `unattributed_crossing` above for the Tree trunk and Brace case).

Island status:
- `resolved`: a chain of verified links reaches the plate. If the chain depends on a manual support, the island carries `manual_only`.
- `unresolved`: no such chain.
- `inconclusive` (whole verdict): the mesh could not be analysed (a non-manifold edge, an invalid support path) or the timeout expired. No island is called resolved then. `scripts/fixtures/knot.stl` (89,472 triangles) gives `inconclusive: non-manifold edge` (`src/supports/knotIslands.test.ts`, and the "Could not judge islands" row in the locale walk): the welded mesh has 282 degenerate triangles, which the sweep skips, and 4,011 edges shared by four triangles (the tube touches itself). That is a property of the file; the generic Generate itself works. The 1,920-triangle `knot` golden fixture in `src/goldens` is a different, manifold mesh: its islands are `ok`.

### Dental islands outside the policy area

The reference aligner at default settings has 54 islands (measured at this revision with the `scripts/perf-baseline.mjs` setup, 117 contacts, 14 dropped): 6 `Resolved`, 5 `Unresolved` on permitted faces, and 43 `OutsidePolicy`. An unresolved island is `OutsidePolicy` when none of the faces around its lowest plateau is in `permitted_faces`; this applies only when the policy says it has an outside (`islands_outside_permitted`, dental yes), so the generic policy never produces it (`supports/generate/islands.rs`, wasm status code 3). The host groups all of them into **one informational problem-list entry** (kind `outside`, Show only, no Fix, not counted as an unsupported spot): "43 low points lie outside the dental support area and are left to the aligner shape." Islands on permitted faces stay `unresolved` entries with Show and Fix. The Step 3 Check on the reference aligner lists 8 problem rows in the browser walk, one of them the outside-area note. (The earlier figure "status bar reads 6 spots" was not re-measured at this revision.)

## Problem list (host)

`src/supports/islandProblems.ts` turns the island verdict into `SupportProblem` entries (`island`, `unjudged`, `outside`), and `src/supports/omittedProblem.ts` turns the build's dropped list into the `omitted` entry; `overhang` entries come from the Rust check:
- an `unresolved` island is an `island` entry at its lowest vertex with Show and Fix;
- `resolved` and manual-only islands are not problems;
- `inconclusive` is one `unjudged` entry ("Could not judge islands on this mesh") without Show or Fix; the status line says "Islands could not be judged on N objects" instead of clean;
- a Check with no current build has no verdict and reports that it did not finish, never clean;
- `omitted` ("Supports left out") is ONE informational entry for the automatic supports the build left out: `dropped` minus `dropped_by_zones` (the user's own no-support zones), at those contacts' positions in the unit frame, with Show (the first) and Fix. It is not counted as an unsupported spot. The build reports no per-support reason, so the entry does not either (the possible causes are a crossing, the policy's match or landing rule, and the repair).

`overhang` is the Rust check's overhang-coverage warning (`supports/check`). It is non-gating. The old island heuristic was removed from that check. The `blocked` body verdict is not turned into problem-list entries: every generic build is blocked (supports touch the model), so a list entry per issue would flood it. The issues (part, contact, face) are in the result for tests and tools; what the user sees of a repaired crossing is the "Supports left out" entry and the Tree/Brace fallback notes.

## Revision, cancel and the export gate

- Every request carries a `revision` u32. `generate` echoes it. `SupportMeshClient` stamps each request, and a result is delivered only if it answers the newest request of its unit and mode.
- `cancel(unitId)` terminates the running worker. The next request gets a fresh worker, which frees its whole WASM instance. `live_mesh_handles()` returns to 0 (tested in `src/workers/resultPath.test.ts`). The `generate` call is synchronous inside the worker, so cancel is observable between calls, not inside one. A replaced running build restarts the worker after 800 ms; the revision drop covers correctness.
- **Export gate** (`src/supports/exportGate.ts`). Export returns the files plus each unit's revision, verdict and island verdict, and refuses with a visible message (en, ja, zh-Hant) and no file written when a result is: `stale` (the unit changed meanwhile, or another revision), `failed` (no result for a unit with supports in the files), or `inconclusive` (the body-clearance verdict). Not refusals: a `blocked` verdict (not listed per issue, see above) and an inconclusive island verdict (listed as "Could not judge islands on this mesh").
- `OVER_CAPACITY`: the engine's wire code is `CAPACITY` (`MeshError::Capacity`, `StlError::Capacity`). The host maps it to the error code `over-capacity` with one message per job; import names the file.

## Detection pipeline (dental policy)

Order: `orientation → outer and inner mesh-edge loops → broad face cut → side labels → narrow mesh-distance strips → sampled contact faces → PolicyResult`. Contour detection is cached across calls in `dental/cache.rs` (key: the mesh bits and the profile; the tuning is applied on top), so retuning and the policy do not repeat it.

The loops define where the strips begin. The face cut is still required: it labels the two incident faces of each contour edge as `opening side` or `other side`. The strips are then built from the edges along the mesh, and only the `other side` is permitted. The broad face group is **not** a support area.

Reference numbers (one scan): outer loop 2,665 edges, opening loop 339 edges, 254,344 opening-facing faces and 119,612 other faces in the cut, 13,176 faces in the default narrow strip, 116 proposed tips (117 before the 0.6 mm minimum tip separation). These are checked by the tests in `src/core/analysis/dentalRustParity.test.ts` against recorded golden files.

### Input and output

The mesh is an indexed triangle mesh in local millimetres. The result is a proposal or `inconclusive` with a machine-readable reason. An inconclusive result returns no partial mask. Masks are tied to input triangle indices, not to a transformed raster, so rotating the mesh must leave the per-face answer unchanged (tested over 100 random poses).

### 1. Orientation frame (`orient.rs`, `rim.rs`, `pose.rs`)

Compute the vertex mean and the 3 x 3 covariance. The smallest-eigenvalue eigenvector is the candidate cavity axis. Reject if smallest over largest eigenvalue exceeds 0.6 (`axialVarianceMax`). Project vertices on the axis. Sum triangle area (by centroid) in the outer 14% of the range at each end; the end with less area is the opening. Reject an end-area difference below 18% of their sum. Reject confidence below 0.12, where confidence is the difference ratio times one minus the eigenvalue ratio.

Let `openingDirection` point to the lower-area end. The reference axis is `(1,0,0)` unless `abs(openingDirection.x) >= 0.8`, then `(0,0,1)`. `tangent = normalize(reference x openingDirection)`, `bitangent = normalize(openingDirection x tangent)`.

### 2. Mesh graph and the outer ridge (`topology.rs`, `contour.rs`)

Build unit normals and undirected edges. Every edge must have exactly two faces. Reject a boundary edge, a non-manifold edge or a degenerate triangle. An edge is sharp at angle `theta` when `abs(dot(n1, n2)) <= cos(theta)`. The absolute value tolerates locally reversed winding but does not repair globally inconsistent normals.

At 60° take the connected sharp-edge components that are simple open chains (two degree-1 ends, all other vertices degree 2) and sort them by length in millimetres (never by edge count; a closed sharp loop such as a plate edge is not a candidate). The two longest are the ridges. Require at least `ridgeFirstMinMm` 35 mm and `ridgeSecondMinMm` 20 mm (110.2 mm / 1,628 edges and 56.1 mm / 831 edges on the reference; the next open chain is 7.9 mm; the old 500 / 300-edge minimums were 34 / 20 mm at the reference's 0.068 mm ridge edge) and require the longest to span at least 60% of the model extent in both opening-plane axes. Build a 20° sharp-edge graph, excluding the chain edges. For both end pairings, find shortest paths by 3D edge length (Dijkstra). Accept the shorter pairing only if the result is one simple closed loop (every vertex degree 2, edges equal vertices). On the reference the connectors are 10.55 mm / 38 edges and 40.39 mm / 168 edges. The loop has 2,665 edges, 2,459 in the chains (blue) and 206 added (green).

### 3. Central opening (`opening.rs`)

Rasterize all triangles projected on the tangent/bitangent plane with a two-pixel margin. Flood-fill empty pixels (4-connected). The one empty component not touching the border is the hole; require exactly one hole of at least 1% of the image. Lift it back to mesh edges: keep an edge if its two face normals have opposite signs against the opening direction and its projected midpoint is within `openingNearHoleMm` 0.5 mm of the hole, rounded up to whole cells at each resolution (2 cells of 0.268 mm at 256, 4 cells of 0.133 mm at 512 on the reference; the lifted edges lie within 1 cell, the next silhouette edges 5 cells = 1.34 mm and 9 cells = 1.20 mm away, so both resolutions lift the same 342 edges). Then check the lifted edge graph: every vertex must have 2 or 4 incident edges and at most one vertex may have more than 2 (`opening-loop-branched` otherwise). With no branch vertex the edges must be one connected loop longer than `openingLoopMinMm` 15 mm (else `opening-loop-not-closed`). With one branch vertex the edges split into loops at it; keep the longest (by length) only if it is at least `openingLoopMinMm` long, there are at most 2 loops, and the second is at most `openingSideLoopMaxMm` 2.5 mm (else `opening-loop-not-isolated`). On the reference the loop is 90.1 mm (339 edges) and the side loop 0.80 mm (3 edges); the old 50- and 10-edge limits were about 13 mm and 2.7 mm at its 0.266 mm opening edge. Run at 256 and 512 pixels (resolutions, not sizes) and require the same exact edge set.

The result is `present`, `absent` or `ambiguous`. No enclosed hole at both resolutions is `absent`. A stable identical lifted loop is `present`. Small or multiple holes, a failed lift or a resolution disagreement is `ambiguous`. **Ambiguous never becomes absent.** `absent` on a profile that expects an opening is the Step 1 type-mismatch prompt, and is `inconclusive` for automatic supports. The raster only locates the hole; it never defines the 3D support region.

### 4. Face cut and side labels (`region.rs`, `bands.rs`)

Build triangle adjacency, block it across every edge of both loops, and require exactly two face regions. Choose the opening-facing region only if its mean face-normal dot with the opening direction is at least +0.2, the other is at most -0.15, and the chosen region holds 20% to 85% of the faces. A region that fails these is `inconclusive`.

### 5. Narrow strips (`bands.rs`, `footprint.rs`)

Seed the two incident faces of each contour edge, each at its 3D centroid-to-edge-midpoint distance. Run bounded multi-source Dijkstra over 3D centroid distances through neighbors on the same side. Omit centroids closer than `setback` to the ridge and stop at `width`. Default setback 0.2 mm and width 1.2 mm (`setback + stripWidth`). `contactFaces` is the union of the two `other side` masks. It does not cross empty space or a fold of the mesh. A missing opposing face or a side that does not separate makes the result inconclusive.

Tuning (`DentalTuning`, defaults and limits from profile data): `(setbackMm, stripWidthMm, density) = (0.2, 1.0, 1.0)`. `setback = setbackMm`, `width = setbackMm + stripWidthMm`, `outerSpacing = 3 / density`, `innerSpacing = 2 / density`, `maxSearchDistance = 1.5`. UI limits: `0 <= setbackMm <= 1`, `0.2 <= stripWidthMm <= 2.4`, `0.5 <= density <= 2`. These are interface limits, not clinical ranges. A retune reuses the accepted contours and side labels and recomputes the mask and samples. The host debounces it (180 ms), and Step 2 shows the new overlay after the worker returns.

### 6. Contact sampling (`sampling.rs`, `incidence.rs`)

`inspect_contour_incidence` requires one simple closed, two-sided loop. Order the loop from its lowest vertex, measure segment length in original 3D millimetres and sample at `spacing/2 + k*spacing`. For each sample, search from the two incident faces without crossing a contour edge, accumulating 3D centroid-path distance up to twice `maxSearchDistance`. Select the nearest reachable source-face centroid in the chosen strip within 1.5 mm. Skip the sample if both sides reach the strip or no face qualifies. Keep each source face once. Arclength alone does not keep tips apart where a contour folds back (the arch's distal hairpin, where two outer tips 3 mm apart along the loop were 0.31 mm apart in space) or passes close to the other contour, so a sample whose contact lies closer than `minTipSeparationMm` (0.6 mm, 3D) to a contact already accepted on the same contour or on the outer contour (sampled first) is left out (`crowded_samples`). 0.6 mm is just over one 0.5 mm tip width: it removes overlapping tips but keeps the density slider meaningful (at density 1.5 consecutive opening tips 1.33 mm apart along the loop land 0.64 to 1.0 mm apart in space and all survive). On the reference it removes the distal hairpin tip at default settings (117 to 116), in the retuned golden (147 to 146) and at density 1.5 (177 to 176); at density 2 it removes 7 (235 to 228: 2 outer at the hairpin, 5 opening tips 0.28 to 0.58 mm from a neighbour). Each contact carries the face index, centroid, normal, distance along the loop and distance from the contour. Default spacing is 3 mm (outer) and 2 mm (opening). The 2 mm opening spacing replaced 5 mm, which left a 25 mm unsupported arc; it is not validated as universal.

### 7. Painting

Paint stamps (`AreaStamp`: center, radius, normal, add or remove) apply in order, last one wins, but only inside the recomputed mask. Add cannot extend beyond the strip. When detection finds no area at all, Step 2 builds a `manual-area` policy from the stamps (`manual_dental_area_from_stamps`). It is refused when an area was detected. Contacts created this way go through every later safety check. The `legacy` fill (`dental/legacy.rs`: area rules, opening raycaster, face fill) places points for that policy.

A saved policy is recomputed on use, never grandfathered (`src/dental/savedPolicy.test.ts`). A changed mask, contour or primary contact is rejected.

## Aligner profiles

Dental behavior is parameterised by an `AlignerProfile`, a JSON file in `crates/geometry-core/src/dental/profiles/`. The profile holds:
- `id`, per-language `name` and `description` (en, ja, zh-Hant);
- `opening`: `yes`, `no` or `either`;
- `card`: top-view line art as SVG path data in a 120 x 90 box;
- `fixture`: the reference scan path;
- `thresholds`: all the detector numbers used above (axial variance, terminal band, sharp angles, rim-loop and ridge minimums, opening resolutions and the opening distances, region means and fractions, the arch-front rules). **Rule: anything that stands for a size or a spacing is in millimetres (`…Mm`), never a count of faces, edges, vertices or pixels.** The others are angles, ratios of the part's own extent, or raster resolutions. Calibrated on the reference:

  | Key | Value | Measured on the reference | Replaces |
  |---|---|---|---|
  | `loopMinPerimeterMm` | 1 | closed sharp loops: 3-vertex creases 0.30 to 0.59 mm, the next loops 2.85 mm | `loopMinVertices` 6 |
  | `ridgeFirstMinMm` / `ridgeSecondMinMm` | 35 / 20 | ridge chains 110.2 / 56.1 mm | `ridgeFirstMinEdges` 500 / `ridgeSecondMinEdges` 300 |
  | `openingNearHoleMm` | 0.5 | lifted edges within 1 cell (0.27 / 0.13 mm); next silhouette edges at least 1.20 mm | 2 pixels (hard-coded) |
  | `openingLoopMinMm` | 15 | opening loop 90.1 mm | `openingLoopMinEdges` 50 |
  | `openingSideLoopMaxMm` | 2.5 | side loop 0.80 mm | 10 edges (hard-coded) |
  | `archFrontMinAreaFraction` | 0.0125 | front end 138 of 1,600 cells (8.6%), back end 13 | 20 cells (hard-coded) |

  Kept as counts on purpose: `openingResolutionLow/High` and `archFrontGridCells` (raster resolutions), and sanity minimums (a closed loop of degree-2 vertices has at least 3; the rim fallback needs 6 points to fit a loop; the arch front needs 32 vertices for its covariance);
- `pose`: the target print pose, see [Pose of the diagnostic GLB](#pose-of-the-diagnostic-glb);
- `defaults`: setback, strip width, density, their limits, outer and inner spacing, max search, `repairBudget`, the automatic-match tolerances `matchToleranceMm` and `matchMinDot`, and `minTipSeparationMm` (0.6 mm, see Contact sampling).

The same file is read by Rust (`profiles/mod.rs`, embedded with `include_str!`, listed in `ALL`, parsed with serde; an unknown or a missing key is an error) and by the host (`src/dental/alignerProfiles.ts`, which reads every `crates/geometry-core/src/dental/profiles/*.json` with `import.meta.glob` and parses just as strictly), which makes the Step 0 cards. A unit saves its `profileId`; a saved unit without one means profile #1. One profile exists today: `reference-aligner`.

### Adding an aligner type

1. Add `crates/geometry-core/src/dental/profiles/<id>.json` with all the fields above.
2. List it in `ALL` in `profiles/mod.rs` (`include_str!`).
3. Nothing in the host: `ALIGNER_PROFILES` in `src/dental/alignerProfiles.ts` picks the file up through the glob, and the card, name and description appear in Step 0 with no UI code.
4. Add the reference fixture STL and its checks: golden files, labeled faces (`docs/dental-reference/face-labels.json` is the reference's), random-pose test, opening present/absent/ambiguous cases.

`src/dental/alignerProfiles.test.ts` fails if the Rust registry and the host list differ, and a test profile (`profiles/testdata/second-aligner.json`) is parsed by both sides to show the format is not tied to one file. Steps 2 to 4 above are inferred from those tests and the file headers; no real second profile has been added yet, so this procedure has not been exercised end to end.

## The dental flow (host)

Step 0 type cards (shown even with one profile). Step 1 drop (mesh check for holes or non-manifold geometry first; detection is marked unreliable if the check fails; automatic orientation in a worker; the type-mismatch prompt ("This looks like a different aligner type: no central opening was found.", with **Switch to** each profile that has no central opening and **Keep** the chosen one) re-runs detection with the other profile; uncertain orientation keeps the dropped pose; bad or too large files show a message and stay). Step 2 area (tuning sliders, Add area and Remove area paint, no-area branch). Step 3 supports (tip size, density, lift, raft, Tree and Brace, add and delete selected supports, problem list incl. "Supports left out", Label, OK, Add another aligner). Back from Step 3 asks before it discards manual edits. Exit keeps finished aligners and clears the current one's policy and supports (`src/dental/flow.ts`). `src/dental/arrange.ts` re-arranges every aligner on the plate without overlap on every drop and finish.

Label rules (`src/dental/label.ts`): default `X`, at most 8 characters, `A-Z`, `0-9` and `-`; other characters are dropped and lower case becomes upper case. It is embossed on the raft base from the shared `labelFont.json` glyph data (digits and `-` are present).

## Golden files, fixtures and how to regenerate

- **Reference aligner**: `docs/dental-reference/reference-aligner.stl` (the only dental fixture). Root `Aligner.stl` and `dentalwork/fixtures/` are not gates.
- **Generic fixtures**: `src/goldens/fixtures.ts` (cube-overhang, knot, thin-slab, v-ridge; standard and low-poly variants). End-to-end snapshots are in `src/goldens/__snapshots__/`. Regenerate by hand with `npx vite-node scripts/update-goldens.ts` (refuses to run in CI), and only after an intended output change.
- **Recorded parity goldens**: `scripts/fixtures/golden/` (176 files, 1.9 MB at the last count: builder, dental, generic, import, knot, legacy, review, safety, rustSupports). They replaced the TypeScript oracle. Helper `scripts/test-support/golden.ts`: IDs, tags, indices, omitted counts and verdicts compared exactly (big arrays as FNV-1a hashes); positions as strided samples within 1e-5 mm. Regenerate one test's files from the current Rust output with `UPDATE_GOLDENS=1 npx vitest run <that test file>`, then review the diff in the commit. Without the variable a missing golden is an error and a mismatch fails.
- **Face labels**: `docs/dental-reference/face-labels.json` (allowed and forbidden faces of the reference as run-length lists). Regenerate with `npx vite-node scripts/dental-face-labels.ts`. Every tip and secondary landing must sit on an allowed face.
- **Other corpora**: odd-STL corpus in `scripts/fixtures/stl-corpus/` (24 files), brush strokes in `scripts/fixtures/brush/`, `scripts/fixtures/knot.stl`.
- Parity rule: vertex positions within 1e-5 mm (JavaScript and Rust trig differ in the last bit). A larger difference needs a fixture, a rationale and a visible note.

Baseline commands: `cargo test --workspace`; `npm run wasm:build && npm run wasm:test`; `npx vitest run --maxWorkers=1 --testTimeout=60000`; `npx tsc --noEmit`; `npm run build`; `npm run walk` (and `WALK_LOCALES=en,ja,zh-Hant node scripts/walk.mjs` for the locale walk); browser smoke with `npx vite --host 127.0.0.1 --port 5173` and `python scripts/geometry_wasm_browser_smoke.py`.

## Host and guard

TypeScript owns UI, React, Three.js buffer copies, camera and gizmo, files, worker lifecycle, settings and project serialization (presets stay TypeScript and are sent to Rust as validated numbers), and translations (en, ja, zh-Hant; zh-Hant is translated with Gemini in Taiwan wording).

`scripts/geometry-guard.mjs` scans `src/` and `scripts/dental-region-review`. A file is flagged if it imports a geometry module or contains vector math. A file is flagged when it matches a geometry import (`core/vec3`, `state/transform`, `core/supports/`, `core/analysis/`, `core/handedness`, `core/transform`, `editing/screenBrush`), or when its vector-math patterns (libm calls, `a[0]*b[0] + a[1]*b[1]`, `dx*dx + dy*dy`, `dot/cross/normalize/subtract(`) reach the threshold: 1 hit in `src/dental/` and `src/supports/`, 3 elsewhere. Every flagged file must be in `scripts/geometry-allowlist.json` as `host-adapter` (no math at or above the threshold) or `host-math` (a justified small amount of render or camera math, with a `why` and a ratcheting `maxMath`). The guard fails on an unlisted flagged file, any other label, a `host-adapter` with math, a `host-math` over its ratchet or without a reason, a listed file that is gone or no longer flagged, and on any import of test-support or ts-oracle code (named, bare side-effect, dynamic `import()` or `require`) from production code. That last rule covers `src/` and every script except `scripts/test-support`, `scripts/fixtures`, `scripts/perf` and five named dev tools that exist to run tests and oracles (`update-goldens.ts`, `probe-dental-edges.ts`, `probe-dental-orientation.ts`, `perf-baseline.mjs`, `dental-face-labels.ts`); the production review tool `scripts/dental-region-review` and `scripts/node-engine.ts` (the Node engine loader) may not import test-support. Test files (`*.test.*`, `*.testkit.*`) are not scanned. At this revision the allow-list has 35 entries: 29 `host-adapter` and 6 `host-math` (`UnitObject.tsx`, `core/supports/zones.ts`, `core/vec3.ts`, `editing/check.ts`, `editing/view.ts`, `supports/export.ts`).

## Performance

Measured with `npx vite-node scripts/perf-baseline.mjs` (median of 3 in Node, not a browser) on the machine in `dentalwork/perf-baseline.json` (AMD Ryzen 9 9950X, Node 22). No hard target was set; the aim was no obvious regression. The baseline column is the file `dentalwork/perf-baseline.json`, recorded at U0/U2, and it is not all "TypeScript before the port": the import and the Rust brush and pick-index numbers were already Rust/WASM when they were recorded.

| Measure | Recorded in `perf-baseline.json` | At this revision (median of 3) |
|---|---|---|
| Import of the reference aligner (373,956 triangles) | 195.3 ms, already the Rust/WASM stream (the file records the import after U1) | 61.0 ms |
| Dental Generate on the reference (region + filter + `runSupportJob`) | 12.25 s, TypeScript flow; 117 contacts, 38,032 support triangles, 16 dropped | 3.12 s; 117 contacts, 38,656 support triangles, 14 dropped |
| Knot Generate (golden `knot`, 1,920 source triangles) | 1,440 ms, TypeScript; 150 contacts, 48,160 triangles | 64.6 ms; 150 contacts, 48,160 triangles |
| Brush p95 per pointer step, 48-triangle supports (`scripts/brush_perf.py`, browser) | 0.1 ms TypeScript cached, 0.1 ms Rust | not re-measured |
| Brush p95, 1,920-triangle supports | 1.8 ms TypeScript cached (the pre-port path), 3.2 ms Rust `project_brush` (production since U2) | not re-measured; 1.1 ms was recorded at U10 |
| Pick index build | 115.8 ms TypeScript (three-mesh-bvh oracle), 207.1 ms Rust | not re-measured; 271 ms was recorded at U10 (one-off) |

Reading it: the Rust brush and pick-index build are slower than the TypeScript oracle they replaced, by 1.4 ms and about 90 ms; the port was chosen for a single tested engine, not for these two numbers. The dental Generate sample 1 includes JIT warm-up (4.35 s; the other two samples are 3.07 s and 3.12 s). Contact count and the knot triangle count equal the recorded ones; the dental support-triangle count (38,656 against 38,032) and dropped count (14 against 16) differ from the U0 recording. The change came with the policy work: real gap alternates now let some crossing contacts move instead of being left out (the Policy API entry of `docs/dental-rework-handoff.md` records the same 16 to 14 change and that cause).

## What is validated and what is not

Evidence at this revision (one revision, run in sequence): `cargo test --workspace` 183 + 7 + 3 + 1 passed (core unit tests, `dental_reference`, `layers`, the wasm crate); `npm run wasm:build` and `wasm:test` ok; `npx tsc --noEmit` clean; `npm run build` ok (83 npm packages and 24 Rust crates in the notices); `npm test` 125 files / 1,183 tests passed; `npm run walk` ALL PASS, 66 checks, 357 s; locale walk `WALK_LOCALES=en,ja,zh-Hant` ALL PASS, 18 checks, 108 s. The browser smoke (`scripts/geometry_wasm_browser_smoke.py`) was not run for this revision.

Validated, on one reference aligner:
- Loops of 2,665 and 339 edges; the face mask, four edge sets, contact faces and tip IDs match the recorded goldens; positions within 1e-5 mm at three tunings.
- 100 of 100 seeded random poses within 0.02 mm.
- A covered opening is `absent`; a split opening is `ambiguous` (never `absent`); a cube abstains.
- Every tip and secondary landing candidate sits on an allowed face per `face-labels.json`.
- A saved policy is recomputed on use.
- Rust `generate` matches the earlier TypeScript flow on two walls, brace fallback, Tree with both leaves, landing mask, export mode and the aligner (recorded as goldens).
- A timeout is always `inconclusive`, the repair budget is exact and a ring that cannot be measured makes the verdict `inconclusive` (Rust tests in `supports/generate/tests.rs`, `safety/tests.rs`).

Not validated:
- **Only one reference STL exists.** Thresholds are calibrated to it. Rotations of it do not substitute for other patient models.
- **U6b (external validation) is pending**: a second aligner with an opening and a real aligner with no opening. Until then, dental mode ships labeled preview / not clinically validated.
- **No-opening aligners**: `absent` is inconclusive for automatic supports. Only a synthetic no-opening mesh exists.
- **No physical print or fit review** on a printer and resin.
- **Island check is geometric**, not a print simulation. Dental low points outside the support area are reported for information only; this is a policy choice (lead decision 2026-10-28, reversible) that has not been checked against real prints.
- **`scripts/fixtures/knot.stl`**: the island verdict is `inconclusive: non-manifold edge` (re-checked at this revision by `knotIslands.test.ts` and the locale walk): 4,011 edges are shared by four triangles, so no island can be judged. The generic Generate itself works.
- **The `blocked` verdict now marks real crossings**: before the reach rule above, every golden build and the reference aligner were `blocked`, almost all by tips touching their own surface (the reference aligner: 102 tip necks). With it, 9 of the 16 golden builds are `clear` (cube default, roof and low-poly; all six v-ridge variants). What remains was inspected: Tree branches and trunks crossing (cube Tree, knot Tree, thin-slab Tree), knot pillars where the knot touches itself, one thin-slab neck, and on the reference aligner 14 tip necks whose neck runs 0.25 to 1.9 mm back into the aligner (11 of them more than 1.3 mm), because the remesh normal at the rim points the neck back into the shell. Those 14 are real: repair drops crossing automatic pillars but not crossing necks, so they stay in the result. `blocked` is still not listed per issue in the problem list and does not stop an export; the folder review (`dentalwork/batch-review`) marks each crossing on the model.
- **Alternates** are real for dental (one gap alternate per primary at most), but whether the moved contacts are better supports than the dropped ones was not evaluated; rim-gap reports can still remain.
- **Neck penetration**: intentional-reach exemptions (`reach_limits` in `clearance.rs`) are bounded engineering limits, not proof that every neck touch is intended. The earlier TypeScript measurements counted thousands of neck-to-model triangle pairs that were not classified by depth; whether the Rust classifier changes that was not re-measured here.
- **`zonedAt`**: the TypeScript copy is gone (Rust `zoned_at`). The per-vertex stamp loop of the zone paint display (`stampVertices`, `core/supports/zones.ts`) applies the same last-stamp-wins rule on the display mesh; it is the one remaining TypeScript copy of the idea, kept for the brush's frame budget, and a test (`zones.test.ts`) compares it with Rust `zoned_at`.
- Left-handed hosts (a future Babylon.js host): `src/workers/babylonContract.test.ts` checks the left-handed contract without loading Babylon itself.

## Pose of the diagnostic GLB

The review GLB is rotated into the profile's target pose (`pose.rs`, `dental_pose`; Step 1 uses the same rotation). It does not change triangle indices or face membership. Project vertices on the opening plane and take the 2 x 2 covariance. Reject a nearly symmetric footprint when eigenvalue spread over trace is below `archFrontMinAnisotropy` (0.05; 0.34 on the reference). In principal-plane coordinates keep points with major-axis fraction between `archFrontSideFraction` and one minus it (0.3 to 0.7), and count occupied cells of an `archFrontGridCells` x `archFrontGridCells` grid (40 x 40) over the part's own box in the outer `archFrontEndBandFraction` (22%) band at each minor-axis end. The cells are an area fraction of the part, not a mesh count. Reject if the fuller end covers less than `archFrontMinAreaFraction` of the grid (0.0125 = 20 of 1,600 cells; 138 on the reference) or less than `archFrontEndRatioMin` (2) times the other end (13 on the reference). The fuller end is the arch front.

The rotation maps the source frame `(sourceSide, front, openingDirection)` to the target frame of the profile's `pose` block (build plate normal +Y):
- `tiltDeg`: the opening axis is tilted this far from the downward plate normal (-Y);
- `headingDeg`: toward this direction about the plate normal (0 = toward -Z, positive toward +X);
- `rollDeg`: the arch front is the direction of increasing tilt, rolled this far about the opening axis.

The reference profile has `tiltDeg` 46.4577512332, `headingDeg` 2.9376675175 and `rollDeg` 2.7827557871: the owner-approved reference pose, within 1e-12 of the direction vectors it replaced (`pose.rs` test), so the reference's rotation changes by about 1e-12 rad. Another aligner type sets its own tilt in its profile. If the arch front cannot be estimated, no GLB is written. The target pose is not a universal print angle.

## Earlier methods (reference only)

The first `lower-edge-loop` and ray method found a tiny ridge, not the full trim. A later probe found the largest smooth opening-facing patch, which reached tooth-height surfaces (`scripts/probe-dental-edges.ts`). Using the full opening-facing group as the support mask gave 397 tips on one run and overpainted areas above the trim. None of these grant contact permission now. The old images and explanation are in [docs/dental-reference](../docs/dental-reference/README.md).

## To rebuild this in another language

Preserve mesh indexing and triangle order. Compute the orientation frame and the manifold edge-to-faces table. Extract the 60° outer chains and join them on the 20° graph. Rasterize and lift the central hole at both resolutions. Cut face adjacency along both loops and classify the two groups. For each contour edge, seed a bounded 3D face-distance search on each side and keep the `other side` faces between setback and width. Union the outer and inner masks. Sample each ordered contour at its spacing and move each sample to a reachable exact source face within 1.5 mm in the mask. Emit the faces, the candidates and the policy fields above. Any failed check returns `inconclusive`, never a partially painted mask.
