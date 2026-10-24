# Dental support-region candidate: two mesh contours

This document describes `proposeDentalSupportRegion` in `src/core/analysis/dentalRegion.ts`. It is a reproducible **candidate detector**, not permission to attach supports. It has been measured on the one owner-approved `reference-aligner.stl`; the thresholds are not yet validated on other patients. The production contact gate remains closed.

## Plain-language explanation

Think of the aligner as a thin, curved bowl shaped like a U. We need to mark its underside without accidentally marking the tooth-shaped outside. A flat horizontal cut will miss the rim because the back of the aligner rises. Instead, we follow edges *on the actual 3D mesh*.

1. Find the long sharp ridge around the outside. On this sample it appears as two long broken lines. Follow the less-sharp ridge at their ends to join them into one closed outer line. The joining lines are not straight shortcuts through empty space.
2. Look through the aligner's central opening to locate that hole. Trace the 3D mesh edge around it to make a second closed line.
3. Imagine cutting the mesh along both lines. If they separate the surface into exactly two pieces, the piece facing the opening is the proposed underside. The other piece remains unmarked.
4. If the lines do not close, the opening is unclear, or the cut gives the wrong number or orientation of pieces, return “inconclusive.” Never paint a guessed region green and call it safe.

The result is a list of marked *triangles*, plus both edge loops for display. A support generator must still check real contact tips against an approved mask. This function does not generate tips, move the model, or modify project state.

## Technical reconstruction

### Input and output contract

Call `proposeDentalSupportRegion(mesh: TriangleMesh)`. The input has indexed vertex positions and triangles in local coordinates. `proposeDentalOrientation` first supplies the opening direction and a perpendicular tangent/bitangent frame. The result is a discriminated union:

- `kind: 'proposal'`: `allowedFaces[i] === 1` for each candidate underside triangle; `outerEdges` and `openingEdges` are flat pairs of vertex indices (unordered edge set); diagnostics give both region face counts and outer connector lengths in STL units.
- `kind: 'inconclusive'`: a machine-readable reason. No partial mask or contour is returned.

The returned mask is tied to the **input triangle indices**, not a transformed world-space raster. Rotating the mesh should leave the per-face answer unchanged. No 2D brush or vertex-color approximation is used to decide membership.

### 1. Construct the mesh graph

For each triangle, calculate its unit normal and its three undirected edges. Welded/indexed edges must each have exactly two incident faces; reject a boundary, non-manifold edge, or degenerate triangle. Store vertex coordinates projected into the opening-plane frame for later extent and hole tests. Edge length and face adjacency always come from the original 3D mesh.

For neighboring face normals `n1,n2`, an edge passes a sharpness threshold `θ` when `abs(dot(n1,n2)) <= cos(θ)`. The absolute value follows the exploratory probe; it tolerates locally reversed winding but does **not** repair globally inconsistent normals. Thus 60° finds strong ridge sections, while 20° allows a weaker connecting ridge.

### 2. Close the outer ridge

At 60°, sort connected edge components by edge count. Require the largest two to be simple open chains: exactly two degree-1 ends, every other vertex degree 2, `edgeCount = vertexCount - 1`. On this sample they have 1,628 and 831 edges. Require at least 500 and 300 edges respectively; the largest must span at least 60% of the full model extent in *both* opening-plane axes. These are conservative sample-derived rejection checks, not anatomical laws.

Make a 20° sharp-edge graph, excluding edges already in the two chains. For both possible end pairings, find shortest paths by accumulated **3D Euclidean edge length** with Dijkstra. Combine the two chains and two paths. Accept the shorter total pairing only if every vertex has degree 2 and the number of edges equals the number of vertices: one simple closed contour, with no branch or crossing. Here the connectors are 10.55 mm/38 edges and 40.39 mm/168 edges; the full loop has 2,665 edges. This is a surface-following path, not a straight join, but its long connector still needs anatomical review.

### 3. Recover the inner opening loop

Project every triangle to the tangent/bitangent plane and rasterize its occupancy with pixel-center triangle tests, leaving a two-pixel margin. Flood-fill empty pixels in four-neighbor connectivity. The one empty component not touching the image border is the central opening; require exactly one hole occupying at least 1% of the image.

For each mesh edge, keep it if its incident face normals have opposite signs against the opening direction **and** its projected midpoint is within two pixels of the hole. This lifts a projected silhouette back onto actual mesh edges. Build an edge graph. On the reference it contains one 339-edge closed loop and one three-edge false loop sharing a degree-4 vertex. Keep the large loop only if there is no other branch and any extra loop has at most 10 edges. Run independently at 256 and 512 pixels and demand the **same exact mesh-edge set**; otherwise abstain. The red central-opening contour is 339 edges on this sample.

The raster only helps locate a hole. It never defines the final 3D support region, and disagreement between resolutions is a rejection signal.

### 4. Cut and classify mesh faces

Construct the triangle-adjacency graph. Block adjacency across every outer-loop and inner-loop edge. Require exactly two connected face regions. Calculate each region's mean face-normal dot against the detected opening direction. Choose the more opening-facing region only when its mean is at least `+0.2`, the other is at most `-0.15`, and the chosen region has 20–85% of all faces. Set `allowedFaces` by flood-fill region membership; no projection band, local height plane, or “all downward normals” rule is applied.

On the reference the cut yields 254,344 candidate underside faces (mean dot `+0.381`) and 119,612 other faces (mean dot `-0.299`). Either contour alone does **not** isolate the region. Both closed loops are necessary.

### Reproduction and evidence

Run `npx vitest run src/core/analysis/dentalRegion.test.ts` from the repository root. The tests parse `docs/dental-reference/reference-aligner.stl`, assert both loop sizes and face counts, rotate the exact same triangles and require an identical face mask, and require a cube to be inconclusive. The read-only exploratory source is `scripts/probe-dental-edges.ts` with `DENTAL_PROBE_CONNECTORS=1` and `DENTAL_PROBE_OPENING=1`; the colored review model is `support-area-review.glb` in this directory. Its teal surface is the candidate, not an approved clinical truth.

To recreate this in another language: preserve mesh indexing and triangle order; calculate the orientation frame; construct a manifold edge→faces table; extract two 60° chains; join them along the 20° edge graph; rasterize and lift the central hole silhouette twice; cut face adjacency along both loops; select the opening-facing component under the stated checks. If any check fails, return an inconclusive result, not a partially painted mask.

### Limits and next safety gate

These measurements prove rotation consistency on one STL, not correctness on different aligners. An unusual trim, missing posterior section, scan hole, reversed/inconsistent winding, attachment, or second projected opening can cause abstention or a plausible but wrong candidate. The fixed edge-count, extent, angle, pixel, and region thresholds are calibrated only to the reference. Before using this mask for contact placement, obtain explicit operator review of the colored model, test distinct similar STLs with labeled allowed/forbidden faces, and verify every final transformed tip (including landing/offset effects) is on an approved face. Manual Add must not bypass the anatomical safety gate.
