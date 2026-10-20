# SLASG / Resin UV node logic (reference)

How Resin UV builds live supports. This was read node by node from the Geometry Nodes groups that `mixo3d` (Blender 5.2) applies to a support object; the dump comes from `tools/blender-parity/dump_nodes.py`. Blender is Z-up here; the web is Y-up. All lengths are in mm.

## Modifier stack

`mixo_scatter` (SLASG_VertexScatter_Mixo) → `mixo_manual` (MIXO_ManualPoints) → `mixo_gen` (SLASG_SupportGenerator_Mixo) → `mixo_label` (MIXO_Label) → `mixo_model` (MIXO_ShowModel).

## 1. Contact points

### SLASG_VertexScatter_Mixo

1. Remesh the target: `Mesh to SDF Grid` (voxel = Spacing / 4, band 3), then `Grid to Mesh` (threshold 0, adaptivity 0.1). Call the result R.
2. **Bottom faces** (when Facing Down is on): R faces whose true normal is within Overhang Angle of (0,0,-1). On these faces, `Distribute Points on Faces` runs in POISSON mode with Distance Min = Spacing, Density Max = (1/Spacing)^4, Density Factor 1, seed 0. The resulting points lie on R, not on the exact model.
3. **Island minima** (when Topological Island is on): vertices of R whose lowest adjacent edge is not lower than the vertex itself, i.e. local minima.
   - They are tagged `Vertical = 1`, merged by distance within Spacing, and snapped back to the nearest original minimum.
   - A minimum is dropped when the angle between its R vertex normal and straight down exceeds Overhang Angle.
4. **Legacy ridge points**: disabled. With Reinforce Overhang Edges on, the ridge threshold is forced to π ("MIXO suppress legacy SDF ridges").
5. **Mixo edge candidates** (Python `rebuild_edge_candidates`, computed on the exact model):
   - **Eligible faces**: faces with normal.z < −cos(Overhang Angle), and only when Downward Faces is on. Regions are connected through shared manifold edges.
   - **Qualifying edges**:
     - boundary edges, with exactly one incident face in the region;
     - ridge edges, with both faces in the region and the angle between their normals greater than 45°.
     - Non-manifold edges are skipped.
   - **Samples per edge**: count = max(1, ceil(length / spacing)), where spacing = max(0.2, Spacing). Fractions are {0.5} when count is 1, otherwise n / count for n = 0..count, so both ends are included.
   - **Inset**: each sample moves along the in-plane perpendicular `face.normal × edgeDir`, oriented toward the face centre, by r + 1e-4 with r = Contact Ø/2 + 0.05. The point must lie inside that face with clearance r. Otherwise the deepest of 16 steps that is inside with clearance min(0.05, r/4) is used; if none is inside, the next incident face is tried.
   - **Dedup**: a candidate is skipped when it is within 0.9 × spacing of any earlier point, across all regions.
   - Points are tagged `Edge = 1`, `Vertical = 0`.
6. **Auto Tree** (optional):
   - **Safe Distance**: the non-overhang faces of R (Separate Geometry, inverted) are copied twice, moved out and in by Safe Distance along their vertex normals. A ray goes straight down from p − (0, 0, Spacing/32) with length p.z. A point whose ray hits the moved-out copy but misses the moved-in copy is deleted; a point can branch only when the moved-out copy is missed. With Safe Distance 0 both copies are R itself.
   - Branching points are duplicated; Merge by Distance (Merge Distance) clusters the duplicates greedily into junctions at the members' mean.
   - The Spacing/16 clean-up merge then welds every point within Spacing/16 of a junction into it: that contact disappears and the junction moves to the mean of the welded points. One-member clusters fuse back onto their contact the same way.
   - Each junction drops to (mean z − Branch Descent − 2 × the longest horizontal member distance). Junctions below z = Spacing are removed.
7. Manual points (vertices of the support object) are joined last.

### MIXO_ManualPoints

1. Delete every contact within **Erase Radius of any removal marker**. This applies to automatic and manual points alike, including new points after regeneration.
2. Snap every remaining point to the nearest surface of the lifted model.

## 2. Columns: SLASG_Line

- **Normal source.** The target for normals and the landing raycast is the model remeshed with `Mesh to SDF Grid` (voxel = max(bbox diagonal / 2000, **Middle Ø**)) and `Grid to Mesh` (threshold 0, adaptivity 0.1). Low Poly Mode ("Exact Shape") uses the exact model instead.
- **Neck normal n**, chosen by point class:

  | Class | Normal |
  |---|---|
  | face (no tag) | normal of the nearest face of the remesh |
  | Vertex | true normal of the nearest vertex |
  | Edge | normal of the nearest edge: the mean of its two vertex normals (each the corner-angle-weighted sum of its face normals) |
  | Vertical | (0, 0, −1) |

  Because of the remesh, normals blend within about one voxel of edges and apexes. That is why the edge contacts next to the apex tilt less than 45° and why their directions change with Middle Ø. It also explains what earlier looked like "pillar repulsion": the small sideways turns of crowded rim necks are vertex-normal blending, not a separate step.
- **Remesh details** (OpenVDB `VolumeToMesh`, checked vertex for vertex and face for face with `tools/blender-parity/remesh_dump.py`). The grid nodes sit at multiples of the voxel (single precision). A node on the surface counts as inside. Each sign-changing cell has one point per edge group at the mean of that group's crossings, and each sign-changing grid edge has one quad of the four surrounding points. Adaptivity 0.1: inside each 8³ leaf, 2³, then 4³, then 8³ blocks merge into one point (the mean of their cells' points) when the block is manifold, none of its cells is ambiguous, and every pair of cell gradients has 1 − dot ≤ 0.1; quads whose corners share a point become triangles or vanish. Points of triangles facing more than 120° away from the field gradient move to the mean of the polygons around them. Blender's grid is not tagged as a level set, so the face orientation is OpenVDB's inverted one. Where the surface passes through nodes, OpenVDB keeps coincident duplicate points and zero-area faces.
- **Clamp.** If angle(n, down) > Max Neck Angle, d = down rotated toward n by exactly Max Neck Angle; otherwise d = n.
- **Snap.** Auto Snap moves p to the nearest feature point; when it is off, p stays as is.
- **Tip.** t = p − d · Contact Depth. An IcoSphere instance sits at t (subdivision 2, radius Contact Ø/2, Diameter attribute 0).
- **Chain**, as vertices with a Diameter attribute:
  1. t (Upper Ø)
  2. neck bottom b = t + d · (Neck Length + Contact Depth) = p + d · Neck Length (Middle Ø)
  3. b − (0, 0, max(Fillet Radius, Middle Ø)) = b − Middle Ø (Middle Ø). This marks IsLower.
- **Landing.** A ray is cast down from the IsLower point + (0, 0, Middle Ø) against the remesh, with length equal to the target's bbox height.
  - **Miss (lands on the plate).** Extrude to z = 0. The first new vertex is lifted to z = Bottom Thickness (Middle Ø, edge tagged `isPillar`); a ground vertex sits at z = 0 with Diameter = Middle Ø + (Bottom Ø − Middle Ø) = Bottom Ø.
  - **Hit at distance > 2 × Neck Length.** Snap to the hit point, then build an inverted neck along the up-clamped normal for Neck Length with Upper Ø at the end, plus a touch sphere.
  - **Hit at distance ≤ 2 × Neck Length.** End directly on the model with Upper Ø and a touch sphere.
- **Crossings.** Junction vertices with more than two neighbours (tree) get an IcoSphere scaled to 0.55 × Diameter.

## 3. Tubes: SLASG_Realizer

- Edges with Diameter > 0 become poly curves.
- `Fillet Curve` runs in Poly mode with radius = Middle Ø / 2, count 3, and Limit Radius on. Limit Radius gives each segment to its two corners in proportion to their displacements r·tan(turn/2), and the curve ends take none: a corner next to an end can use the whole segment, not just half.
- Essentials `Curve to Tube` then builds the tube:
  - round profile with Resolution sides
  - radius = Diameter / 2 per point
  - flat merged caps, extrapolated cap radius
  - no resampling
- Spheres (Diameter 0) pass through unchanged.

## 4. Bracing: SLASG_Truss2

1. Take the `isPillar` edges (IsLower point to Bottom Thickness point) and sort them by x + y. Each pillar gives one point.
2. For each pillar i (in sort order), its partner is the nearest pillar j with j > i, found by Index of Nearest in a Repeat zone.
3. A pair is valid when all of the following hold:
   - the partner exists;
   - the horizontal distance d is greater than 0.9 × Middle Ø;
   - d ≤ Distance Limit;
   - max(upper z of the two pillars) > Minimum Height;
   - the pair is not a mutual duplicate (the partner's partner ≠ i, or i > j).
4. Build a grid with 2 columns (column 0 = partner, column 1 = own) and Vy = ceil(maxTop / (rise + Spacing)) + 1 rows, where rise = d · tan(90° − Truss Angle).
   - Row y, column 0 sits at level y + (y mod 2).
   - Row y, column 1 sits at level y + 1 − (y mod 2).
   - z = Bottom Thickness + level · rise + Spacing · (y + 1).
5. Delete points above (that column's pillar top − Top Spacing), delete vertical edges, and split. Edges get Diameter = Truss Ø.

## 5. Tree: SLASG_Tree2

- Leaves are vertices with one neighbour that are the higher end of their edge.
- Walking edges from the highest to the lowest, the lower vertex accumulates `nLeaf` (the sum of both ends).
- Diameter = Middle Ø × sqrt(1 + (nLeaf − 1) × Increment / 100). The rule is area-based, not linear.

## 6. Raft: SLASG_Raft

1. Flatten the target to z = 0.
2. Voxel size = (3D bbox diagonal + 2 × Expand Width) / Voxel Resolution.
3. `Mesh to SDF Grid` (band 3) → `SDF Grid Offset` (+Expand Width) → `Grid to Mesh` at threshold **0.1** (adaptivity 0). The surface sits at distance Expand + 0.1 from the silhouette.
4. Keep the faces with normal.z ≥ 0.01 and flatten them; their boundary edges form the **perimeter**.
5. Resample the perimeter to **3 × Voxel Resolution** points and fill it as an n-gon.
6. **Floor**: extrude the n-gon up by Floor Thickness, moving the top ring outward along each corner bisector by Floor × tan(Wall Angle).
7. **Rim**:
   - Inset the floor top by Wall Thickness along the bisector.
   - Extrude that band to Wall Height, leaning outward by (Wall Height − Floor) × tan(Wall Angle).
8. Merge by distance at min(0.5, Wall Height) / 16.
9. **Roof / Cage**: Python raises Expand Width to Gap To Model + column radius.

## 7. Label: MIXO_Label

1. **Anchor**: from the support vertices with z ≤ Pad Height + 0.01, take the one nearest the bbox corner (max x, min y).
2. **Letters**: `String to Curves` in Blender's Bfont (Size, align Left / Top Baseline), filled. W and H are the letters' bbox plus 2 × Margin.
3. **Pad**: a frustum from z = 0 to Pad Height (= raft Wall Height). The bottom is W × H; the top is wider by Pad Height × tan(Wall Angle) on each side.
4. Placement: the pad is centred on anchor + (Offset X, Offset Y); the letters are extruded Height upward from the pad top and centred on the same point.

## 8. Top level: SLASG_SupportGenerator_Mixo (no stacking)

Points → SLASG_Line → SLASG_Truss2 (when Bracing is on) → SLASG_Realizer, joined with SLASG_Raft (when the raft is on). Roof and Cage go through SLASG_Ceiling and SLASG_Column; these are documented separately.

## Web status (see `src/supports/`, verified by `src/supports/blenderCases.test.ts`)

| Rule | Status |
|---|---|
| Column curve (tip, neck along clamped normal, Middle Ø transition, bend fillet, pillar, foot, no clamping) | exact: every ring of every column in every case within 0.01 mm |
| Landing on the model (ray cast from b, inverted neck above 2 × Neck Length) | exact: cast against the emulated remesh (Blender's 5.4188 below the apex reproduced) |
| Tree diameter, sqrt area rule | implemented |
| Bracing (pairing, validation, zigzag levels, trim) | exact: brace for brace |
| Raft perimeter (voxel contour at Expand + 0.1, 3 × res resample, OpenVDB start vertex, clockwise) | within 0.008 mm at 64 voxels, 0.06 mm at 16 (OpenVDB renormalisation) |
| Raft floor flare, rim inset, gapped wall runs | implemented as Blender |
| Edge anchors (`rebuild_edge_candidates`) | exact: point for point, same order |
| Poisson interior | Blender's algorithm on the exact model; counts match, positions differ (OpenVDB remesh input) |
| Island minima, incl. remesh plateau grid | emulated: leaf-block centres exact, totals within ~15% |
| Erase-radius suppression | implemented |
| Label (Bfont glyphs, Size / 0.686, pad frustum, anchor) | sizes exact; position within 0.4 mm |
| Remesh (Mesh to SDF Grid, Grid to Mesh at adaptivity 0.1) | OpenVDB port, evaluated per 8³ leaf around queried points: vertex for vertex and face for face with Blender on the probe pyramid at adaptivity 0 and 0.1 (`remesh.test.ts`) |
| Neck normals: face (nearest polygon), edge (mean vertex normal), vertical | 461 of 476 probe contacts within 0.02 mm, total 3.2 mm (`blenderNecks.test.ts`); the rest sit where the pyramid's faces pass exactly through voxel nodes and Blender's zero-area faces carry float-noise normals |
| Roof / Cage (Ceiling plates, brace bands, cage rings) | ported: columns, cross bars, slab, plates and rings match per case (`blenderRoof.test.ts`) |
| Auto Tree (eligibility, clustering, Spacing/16 weld, descent, snap, branches, junction landing, trunk) | junctions within 0.01 mm; every branch curve within 0.005 mm (`blenderTree.test.ts`) |
| Safe Distance (delete / no-branch rays against R's moved non-overhang faces) | same contacts and trees as Blender on a ledge model at Safe 0 and 1.7; 2 tie contacts at 0.8 (`blenderSafe.test.ts`) |
