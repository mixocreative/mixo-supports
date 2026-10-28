# Synthetic test aligners: specification (roadmap step V1)

Status: specification, not built. Design by Fable (2026-10-28), measured on the reference; reviewed by three EGM reviewers (readiness, scope, code accuracy) and folded by the lead. The implementer makes no design decisions beyond this file; anything unclear is asked, not chosen.

## Why

Everything in dental mode is tuned on one aligner (`dentalwork/fixtures/case-001/aligner.stl`, byte-identical to `docs/dental-reference/reference-aligner.stl`). The owner has no other files. A synthetic set cannot prove clinical fit or match other design programs, but it shows whether the detector, orientation, belt and checks are specific to one mesh. Real files (step V) stay the acceptance gate.

Ranked sources (Fable):

1. **Procedural arches (mode B) and perturbations of the reference (mode C).** Licence-free, deterministic. Built here.
2. **Shells from public intraoral scans (Teeth3DS+).** Its data licence is "Other, see license.txt" on OSF; redistribution and commercial use are not stated on the web. Not used unless the owner reads that file (open question Q2). Nothing from it is downloaded into the repository tree.
3. **Public aligner STLs with clear licences:** none found.

What the synthetic set cannot show: edge statistics of other design programs, real trim and attachment shapes, thin or warped shells, whether verdicts match prints.

## The reference, measured (welded)

Closed (373,956 triangles, 186,976 vertices, no boundary edges); extents 67.5 × 50.2 × 20.6 mm; edges median 0.22 mm (10–90 %: 0.15–0.35); trim sharp (99.9th-percentile dihedral 91°). Upper aligner with a palatal plate. The plate has a central window of about 28 × 15.5 mm with a rounded rim. The distal ends are flat 90° cuts. The plate's back border is a sharp trim straight across the palate, about one molar forward of the distal ends.

## Where and how it runs

- Rust binary `crates/geometry-core/src/bin/synthetic_aligners/main.rs` (modules beside it; `mod tests`). Cargo discovers it; no `Cargo.toml` change, no new dependencies. The binary is a separate crate: library modules are `mixo_geometry_core::core::…`, `mixo_geometry_core::supports::…`. Private library helpers are not made public for it; `signed_volume` (`supports/parts/builder.rs`) is copied.
- `cargo run --release -p mixo-geometry-core --bin synthetic_aligners -- --cases dentalwork/synthetic-aligners/cases.json --out dentalwork/synthetic-aligners/stl`
- Committed: the generator, `cases.json`, `README.md` (how to run, the expected table, the owner's record table), `manifest.json` (per output: case, SHA-256, triangle count, the pose matrix, `truthOpening`, and `openingErrorDeg`: the angle between `truthOpening` and the opening direction `propose_orientation` proposes on the output, or its inconclusive reason code). Git-ignored: `dentalwork/synthetic-aligners/stl/` (add to the root `.gitignore`).
- Output names `syn-<case>-<tag>.stl`, e.g. `syn-B01-upper-window.stl`. Binary STL (80-byte header, u32 count, 50-byte records). No Rust STL writer exists; it is written inline.
- **Reading the reference (mode C):** `core::stl::BinaryStlStream::new(count)` with the count from header bytes 80..84, `push` the whole file, `finish()` gives a welded `WeldedMesh` (1e-4 mm weld). The reader turns the file −90° about X (Z-up data becomes Y-up). Mode C undoes that rotation before any operation as an exact coordinate permutation, (x, y, z) → (x, −z, y), not with trigonometry, so mode C outputs are in the file's own frame.
- **Randomness:** SplitMix64, written inline, seeded with FNV-1a 64 of the case id string. Draw order per case: pose, then jitter (s, then u, then k), then noise (F, then G). Same case id → same bytes on any platform.
- **Pose:** applied last to every output. Rotation: axis uniform on the sphere (two draws), angle uniform 0–360° (one draw); translation uniform ± 50 mm per axis (three draws). `truthOpening` = the direction the cavity opens toward (the teeth enter the shell along its reverse): the build frame's −z after the pose for mode B; for mode C, `Rim::opening_direction` from `dental::orient::propose_orientation` (`dental::mesh::Mesh::new`, `profiles::reference_aligner()`) on the unmodified reference (the reference's orientation is accepted by the owner), as read (reader frame), rotated +90° about X into the file frame, then mapped through the operation (mirror: x → −x; scale and noise: unchanged) and the pose.
- Runtime: generation **and** the output checks for all cases under 30 s in release on the development machine. If that cannot be met, report to the lead; do not weaken a check.
- The folder review runs unchanged: `dentalwork/batch-review/run-batch-review.bat`, pick `dentalwork/synthetic-aligners/stl`.
- Time box: mode B 1 unit. If it overruns, cut in this order and report: jitter, then case B07.

## Mode B: procedural arch

All lengths in mm. Build frame: x left–right, y toward the incisors, z up (crowns +z, gum line z ≈ 0, palate z < 0).

**Centreline C(s).** Per half a cubic Bézier in the xy plane, mirrored in x: P0 (0, D), P1 (Wf/2, D), P2 (W/2, 0.55 D), P3 (W/2, 0). Upper W 56, D 44, Wf 14; lower W 52, D 40, Wf 14. Sampled by arclength; L = total arclength (both halves); s runs from the left distal end (s = 0) to the right distal end (s = L). T = dC/ds, N = horizontal unit normal pointing buccal (away from the arch's inside), Z = (0, 0, 1).

**Teeth.** Seven per half, distal to front: second molar, first molar, second premolar, first premolar, canine, lateral, central. The widths are scaled by one factor so the 14 teeth fill L exactly. τ ∈ [0, 1) is the position within a tooth. B and H are constant per tooth and blend with a raised cosine, f = (1 − cos(πx/4))/2 over 4 mm centred on each tooth boundary (x from 0 to 4 mm across the blend).

| Arch | Value | M2 | M1 | P2 | P1 | C | L | Central |
|---|---|---|---|---|---|---|---|---|
| upper | width | 10.5 | 10 | 7 | 7 | 7.8 | 6.5 | 8.5 |
| upper | B (buccolingual) | 10.5 | 10.5 | 9 | 9 | 8 | 7 | 7 |
| upper | H (crown above gum) | 7 | 7 | 8 | 8 | 10 | 9 | 10 |
| lower | width | 11 | 10.5 | 7 | 7 | 7 | 6 | 5.5 |
| lower | B | 10.5 | 10.5 | 8 | 7.5 | 7 | 6 | 6 |
| lower | H | 7 | 7 | 8 | 8 | 10 | 9 | 9 |

Groove: B(s) = B_tooth · (1 − g(1 − cos 2πτ)/2), g 0.08. Trim height z_b(s) = m + a_g · cos 2πτ (margin m, scallop amplitude a_g). A negative m (case B06) is intended: the trim sits below the gum line.

**Profile (the fitting surface F at s, in the (N, Z) plane, point list in order of increasing u):**
1. (+B/2, z_b(s)) buccal trim;
2. straight up to (+B/2, H − 2);
3. arc radius 2, centre (B/2 − 2, H − 2), to (B/2 − 2, H);
4. straight to (−B/2 + 2, H);
5. arc radius 2, centre (−B/2 + 2, H − 2), to (−B/2, H − 2);
6. lingual end, **upper with plate:** straight down to (−B/2, 3), arc radius 3, centre (−B/2 − 3, 3), to (−B/2 − 3, 0): the *join row*; **otherwise:** straight down to (−B/2, z_b(s)), the lingual trim.

U(s) = profile length at s; U_max = max over s. Band grid (s, u): i = 0..n_s, n_s = ceil(L / h), s_i = iL/n_s; j = 0..n_u, n_u = ceil(U_max / h), u_j = jU(s)/n_u (by arclength along that profile).

**Plate (upper with plate only; polar rings).**
- Outer loop O: the join-row vertices of columns i with 10 ≤ s_i ≤ L − 10 (s_post,L and s_post,R are the first and last such columns), then a straight back border at z = 0 from the right join vertex to the left one, sampled every h. O shares its vertices with the band. Join-row vertices outside [s_post,L, s_post,R] form a free 3 mm lingual lip and are part of the outer trim.
- Window: a rounded rectangle, w across (x), d front–back (y), corner radius 4, centred at W = area centroid of O plus the case offset (+y is forward). One ray per O vertex, θ_i = atan2 of (O_i − W) in xy. If θ_i is not strictly monotone around O, the case fails with an error (O not star-shaped about W). I_i = where ray i meets the window outline. If |I_i − W| > |O_i − W| − h for any i, the case fails with an error (the window does not fit inside O).
- Rings k = 0..K with one global K = ceil(max_i |O_i − I_i| / h) (ring edges may be shorter than h): xy P_k,i = I_i + (k/K)(O_i − I_i); z = −V · cos²(πk / 2K), V 5. Zero slope at both ends: the plate meets the r 3 arc tangentially and the window rim is flat. Ring K is O itself.
- Quads (k, i), (k+1, i), (k+1, i+1), (k, i+1), i wrapping.

**Surfaces and winding.** F is the fitting (tooth-facing) surface. n = area-weighted vertex normal of F, oriented away from the teeth and tissue (n · Z > 0 at the occlusal top and on the plate; on the lingual wall n points toward the palate's centre); n is continuous across the join. The outer surface G = F + t · n. The solid lies between F and G; every triangle is wound so its right-hand normal points out of the solid: G as built, F reversed. Fail the case if the curvature radius of F, along s or along u and evaluated on the grid, is under 1.5 t anywhere, or if the arch's curvature radius at the front is under B/2 + 3 + t (the 4 mm blend gives a minimum radius of 1.62 mm, which passes for t ≤ 1.08).

**Walls** close every boundary loop of F with the matching loop of G.
- **Cut (90°):** one quad per boundary edge, F_v → G_v. Used for the outer trim: the buccal row, both distal columns, the lingual lips, the back border, and the lingual trim when there is no plate.
- **Rounded:** a half circle of radius t/2, centre F_v + (t/2) n_v, from F_v to G_v through F_v + (t/2)(n_v + m_v), 8 quads over 180°. m_v = the in-sheet direction pointing out of the sheet, from the interior neighbour, orthogonalised against n_v (at distal columns m_v is along ∓T; at a boundary vertex where the loop turns, m_v is the normalised sum of the outward in-sheet perpendiculars of its two boundary edges, orthogonalised against n_v). Used for the window always, and for the whole outer trim in case B07.

**Triangulation.** Each quad splits along its shorter diagonal. The mesh is indexed directly; vertex ids are shared by construction.

**Jitter** (parameters only, never 3D points): s_i and u_j by uniform ± 0.25 of their spacing, k/K by ± 0.25/K. Not moved: i = 0 and n_s, j = 0 and n_u, the s_post columns, rings 0 and K. Order stays monotone.

**Noise** (when set): uniform ± σ along n_v, applied to F and G separately after the offset.

## Mode C: perturbed reference

- **Mirror:** x → −x, winding flipped.
- **Scale:** uniform about the bounding-box centre.
- **Noise:** uniform ± σ along the area-weighted vertex normal.

## Output checks

On every output (any failure exits non-zero, naming the case and check):

1. Every undirected edge used exactly twice, with opposite winding.
2. Every vertex has a single fan of faces.
3. Euler characteristic: B cases 2 − 2g, g = windows (with a window χ 0, without χ 2); C cases equal to the unmodified reference's χ, measured at run time (−2 today: the welded reference has genus 2, not 1; where the second handle is, is an open finding for the lead).
4. Round trip: write, read back with `BinaryStlStream`, undo the reader's rotation; same vertex count and checks 1–3 pass.
5. Triangle count within 0.5–2× the estimate (sum of grid quads × 2 plus walls) and ≤ 3 M.

In the generator's unit tests only (h 0.5, cheap):

6. Signed volume > 0 and within 15 % of (mean of the F and G areas) × t.
7. Minimum edge ≥ 0.05 mm, minimum angle ≥ 10°.
8. No self-intersection: triangle-triangle tests on non-adjacent pairs through a uniform hash with 2h cells (`core::spatial::Bvh` answers rays, not triangle pairs). If it fires on a plate case, look first at the back-border corners, where the rays from W meet O at shallow angles.

## Cases (12)

Defaults h 0.2, t 0.6, m 0.5, a_g 1.2, window 28 × 15.5 centred, no noise, jitter on.

"Absent" means the reference type refuses the file with `central-opening-absent` (`dental/region.rs`), which needs orientation to succeed first. That refusal is the expected result until step O. An `orientation-*` or `dental-pose-inconclusive` result on any case is a finding. `projected-holes-uncertain` (an ambiguous opening) is a finding on every case.

| Case | Setup | g (B: windows; C: as the reference) | Expected in the folder review |
|---|---|---|---|
| B01 | upper, plate with window | 1 | built; opening present; outer chain runs the whole loop including the back border and distal cuts |
| B02 | upper, no plate | 0 | absent |
| B04 | upper, flat trim m 2, a_g 0 | 1 | built |
| B05 | upper, t 0.8, h 0.4 | 1 | built |
| B06 | upper, m −0.5, a_g 1.5 (deep scallop) | 1 | built (held out) |
| B07 | upper, outer trim rounded | 1 | `inconclusive` with a named reason, never a wrong belt |
| B08 | upper, t 0.5, h 0.12 | 1 | built |
| B09 | upper wide W 62, D 48, window 20 × 10 offset 5 forward | 1 | built (held out) |
| B10 | lower default | 0 | absent |
| C02 | reference mirrored, scale 0.9 | as reference | built (held out) |
| C03 | reference, noise 0.03 | as reference | built |
| C04 | reference, scale 1.15 | as reference | built |

"Built" means: proposed opening direction within 15° of `truthOpening`; outer belt with 0 left out; 0 crossings; no gap at or above twice the rim's spacing; islands only outside the area.

**Held out: B06, B09, C02.** They are run and reported, but no threshold is tuned on them.

**After step O** (not built in V1): solid web (upper plate without a window), small lower arch (10 teeth), lower with attachments near the buccal trim, the reference refined to 0.15 mm edges. Each is added by a later step with its own specification.

## Generator unit tests (h 0.5)

1. Every case's construction passes checks 1–8.
2. Same seed → same SHA-256; another case id → different bytes.
3. Buccal trim vertices lie on z_b(s) within 1e-6 before the pose.
4. Cut walls have dihedrals 90 ± 5°; the window rim and B07's trim have every dihedral under 30°, except wall edges at the outer loop's corner vertices (4 without a plate: the distal corners; 6 with a plate: plus the two lip/back-border corners), where the loop turns about 90°.
5. A window that does not fit inside O returns `Err`, not a mesh.
6. The self-intersection check finds two crossing triangles and passes a tetrahedron.
7. Mirroring keeps the volume positive.
8. The plate join has every dihedral under 15°.

## The inspect-and-adjust loop

- **Owner, per case** (one row in the README table): orientation right or wrong; the coloured edges follow the trim and window (yes / partly / no, where); support area on the outer side only; markers that are real problems; the `summary.csv` row (verdict, crossings, tips, gaps, seconds). Case names and numbers only.
- **Lead:** each GLB against the expected table; the `inconclusive` reasons; gap and left-out counts against spacing; the diagnostics where edges were "partly" right; the numbers diffed against the previous `summary.csv`.
- **Fix discipline:** the reference goldens never move for a synthetic fix (the fix step says "goldens unchanged"). A threshold change is explained in mm and checked on the held-out cases, never tuned on them; if a held-out case fails after a fix, the fix is too specific. Every fix gets a Rust test on a small procedural shell (h 0.5), not on an STL. Synthetic cases may move ridge minimums, the window fraction and orientation confidence; never thresholds calibrated on prints (tip angle, tip move distance).
