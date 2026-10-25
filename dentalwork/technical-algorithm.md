# Dental support region: two mesh contours

> Historical implementation note: this document reconstructs the current two-contour **face-mask** algorithm. The approved next design uses narrow exterior-side contour bands instead; see the [new design](../docs/superpowers/specs/2026-10-25-dental-contour-contacts.md). This face mask remains diagnostic and must not be treated as the final direct-print contact policy.

Code layout changed without changing this algorithm: `src/core/analysis/dentalContours.ts` now detects the mesh-edge contours, and `src/core/analysis/dentalRegion.ts` performs the old face cut. `src/core/analysis/dentalContourEvidence.ts` independently validates one closed contour and returns each edge's two incident source faces; it deliberately does not choose a contact side.

The projected central-opening test now reports `present`, `absent`, or `ambiguous`: no enclosed holes at both 256 and 512 pixels is `absent`; a stable, identical lifted mesh-edge loop is `present`; small/multiple holes, failed loop lift, or resolution disagreement is `ambiguous`. Current support generation still requires `present`; `absent` remains an inconclusive production result pending real no-hole aligner validation.

`diagnosticDentalSideBands` in `src/core/analysis/dentalContactBand.ts` now traces both local surface sides of each validated contour for visual comparison. It builds exact triangle adjacency from indexed mesh edges, seeds each of the two incident faces per contour edge with its 3D face-centroid-to-edge-midpoint distance, then runs a bounded multi-source Dijkstra through same-side face neighbors, accumulating 3D centroid distances. The current diagnostic parameters omit centroids closer than 0.2 mm to the ridge and stop at 1.2 mm. The legacy face cut labels the sides as `openingSide` and `otherSide`; neither is automatically called exterior or authorized for contacts. A failure to find two-sided, opposing incident faces abstains. This is **not** a clinical setback/width setting or a production permission rule.

`sampleDiagnosticContourContacts` in `src/core/analysis/dentalContourContacts.ts` is the next, still-diagnostic layer. First reject an invalid contour using `inspectContourIncidence` (one simple closed, two-sided mesh-edge loop). Construct undirected vertex adjacency, begin at the lowest indexed loop vertex, walk through its lower-indexed neighbor, and follow the degree-two cycle. Measure every segment in original 3D millimeters, sum the perimeter, and place sample positions at `spacing/2 + k*spacing` while below the perimeter (currently `spacing=2 mm`). For each position, find the nearest *source triangle centroid* among the caller-supplied side-band faces within `maxSearchDistance=1.5 mm`; keep each source face at most once. Record that face index, centroid, geometric cross-product normal, arclength, and contour distance; count skipped samples. This selection is rotation-equivariant on the saved reference and cannot choose an unmasked triangle. It is **not** proof of intrinsic geodesic locality at folds, anatomical non-fitting side, collision-free approach, or printability. The exporter shows the `otherSide` alternatives as lime outer / pink inner markers only to inspect these hypotheses. Neither these markers nor this function grant production contact permission.

This document describes `proposeDentalSupportRegion` in `src/core/analysis/dentalRegion.ts`. It is a reproducible **candidate detector** measured on the one owner-approved [`reference-aligner.stl`](../docs/dental-reference/reference-aligner.stl); its thresholds are not yet validated on other patients. In `codex/dental-rework`, the operator's Step 1 Next accepts a successful candidate and uses its face mask for dental contacts. A failed or changed mask yields no automatic tips; this is not a claim of clinical validation across models. See [the plain-language explanation](plain-language.md) for an operator-level description.

## Technical reconstruction

### Input and output contract

Call `proposeDentalSupportRegion(mesh: TriangleMesh)`. The input has indexed vertex positions and triangles in local coordinates. `proposeDentalOrientation` first supplies the opening direction and a perpendicular tangent/bitangent frame. The result is a discriminated union:

- `kind: 'proposal'`: `allowedFaces[i] === 1` for each candidate underside triangle; `outerEdges` and `openingEdges` are flat pairs of vertex indices (unordered edge set). `outerRidgeEdges` holds the two original 60° chains. `outerConnectorEdges` holds the two paths added through the 20° edge graph. The last two sets partition `outerEdges`. Diagnostics give both region face counts and outer connector lengths in STL units.
- `kind: 'inconclusive'`: a machine-readable reason. No partial mask or contour is returned.

The returned mask is tied to the **input triangle indices**, not a transformed world-space raster. Rotating the mesh should leave the per-face answer unchanged. No 2D brush or vertex-color approximation is used to decide membership.

### Orientation frame used by detection

Calculate the mean vertex position and the unnormalized 3 × 3 covariance matrix of all vertex offsets. Its smallest-eigenvalue eigenvector is the candidate cavity axis. Reject the mesh when the smallest eigenvalue divided by the largest exceeds `0.6`. Project vertices onto the axis. Measure triangle area in the outermost 14% of the projection range at each end, using triangle centroids. The end with *less* area is the opening. Reject an end-area difference below 18% of their sum. Reject confidence below `0.12`, where confidence is the end-area difference ratio times one minus the eigenvalue ratio.

Let `openingDirection` point toward the lower-area end. Choose reference axis `(1,0,0)` unless `abs(openingDirection.x) >= 0.8`, then use `(0,0,1)`. Set `tangent = normalize(reference × openingDirection)` and `bitangent = normalize(openingDirection × tangent)`. Project a vertex `p` to `(dot(p-centroid,tangent), dot(p-centroid,bitangent))`. The rim-centroid translation does not change edge connectivity or planar extents. The production orientation helper also builds a provisional rim and visibility mask; the two-contour face cut does not use those masks.

### 1. Construct the mesh graph

For each triangle, calculate its unit normal and its three undirected edges. Welded/indexed edges must each have exactly two incident faces; reject a boundary, non-manifold edge, or degenerate triangle. Store vertex coordinates projected into the opening-plane frame for later extent and hole tests. Edge length and face adjacency always come from the original 3D mesh.

For neighboring face normals `n1,n2`, an edge passes a sharpness threshold `θ` when `abs(dot(n1,n2)) <= cos(θ)`. The absolute value follows the exploratory probe; it tolerates locally reversed winding but does **not** repair globally inconsistent normals. Thus 60° finds strong ridge sections, while 20° allows a weaker connecting ridge.

### 2. Close the outer ridge

At 60°, sort connected edge components by edge count. Require the largest two to be simple open chains: exactly two degree-1 ends, every other vertex degree 2, `edgeCount = vertexCount - 1`. On this sample they have 1,628 and 831 edges. Require at least 500 and 300 edges respectively; the largest must span at least 60% of the full model extent in *both* opening-plane axes. These are conservative sample-derived rejection checks, not anatomical laws.

Make a 20° sharp-edge graph, excluding edges already in the two chains. For both possible end pairings, find shortest paths by accumulated **3D Euclidean edge length** with Dijkstra. Combine the two chains and two paths. Accept the shorter total pairing only if every vertex has degree 2 and the number of edges equals the number of vertices: one simple closed contour, with no branch or crossing. Here the connectors are 10.55 mm/38 edges and 40.39 mm/168 edges; the full loop has 2,665 edges. The two original chains contain 2,459 edges and export in blue. The 206 added path edges export in green, even if an individual connector edge also passes the 60° test. Color records *how the detector selected it*, not its angle alone. This is a surface-following path, not a straight join, but its long connector still needs anatomical review.

### 3. Recover the inner opening loop

Project every triangle to the tangent/bitangent plane and rasterize its occupancy with pixel-center triangle tests, leaving a two-pixel margin. Flood-fill empty pixels in four-neighbor connectivity. The one empty component not touching the image border is the central opening; require exactly one hole occupying at least 1% of the image.

For each mesh edge, keep it if its incident face normals have opposite signs against the opening direction **and** its projected midpoint is within two pixels of the hole. This lifts a projected silhouette back onto actual mesh edges. Build an edge graph. On the reference it contains one 339-edge closed loop and one three-edge false loop sharing a degree-4 vertex. Keep the large loop only if there is no other branch and any extra loop has at most 10 edges. Run independently at 256 and 512 pixels and demand the **same exact mesh-edge set**; otherwise abstain. The red central-opening contour is 339 edges on this sample.

The raster only helps locate a hole. It never defines the final 3D support region, and disagreement between resolutions is a rejection signal.

### 4. Cut and classify mesh faces

Construct the triangle-adjacency graph. Block adjacency across every outer-loop and inner-loop edge. Require exactly two connected face regions. Calculate each region's mean face-normal dot against the detected opening direction. Choose the more opening-facing region only when its mean is at least `+0.2`, the other is at most `-0.15`, and the chosen region has 20–85% of all faces. Set `allowedFaces` by flood-fill region membership; no projection band, local height plane, or “all downward normals” rule is applied.

On the reference the cut yields 254,344 candidate underside faces (mean dot `+0.381`) and 119,612 other faces (mean dot `-0.299`). Either contour alone does **not** isolate the region. Both closed loops are necessary.

### 5. Check secondary support landings

The Step 2 placement worker samples downward-facing approved triangles directly. It records proposed tip IDs but does not build full supports. During the Step 3 support build, `LineTarget.cast` first casts a vertical ray against the exact indexed source mesh. The ray result carries its hit face index and exact hit point. If a voxel-remeshed landing is used for the visible geometry, retain the original face index and hit point with that result.

For each automatic column that lands on the model, and each automatic tree junction that lands on the model, transform the exact hit point back to unit-local coordinates. Calculate the source triangle's geometric normal from its three indexed vertices. Call `dentalRegionAllowedOnFace(policy, faceIndex, localHitPoint, normal)`. If it returns false, omit that column or all members of that tree. A support that lands on the build plate has no second model contact and needs no second-face test. The rule does not reject manual supports. Record the omitted contact IDs in `dropped`; keep painted-zone omissions separately in `droppedByZones`.

This gate checks contact points, not intersections along pillars, braces, rafts, or roofs. On the reference, Step 2 proposed 397 tips and the full build kept 393. Four failed the secondary-landing check. The Step 2 count therefore says "proposed" and warns that the final count can be lower. Matching the Step 2 and Step 3 contact IDs needs a placement-time landing preflight; that work is still open.

### Pose of the diagnostic GLB

The GLB review tool calls `rotationToDentalPose` after detection. This step transforms the displayed model and contours; it does not change triangle indices or face membership. Project all vertices onto the opening plane. Compute the principal axis of their 2 × 2 covariance matrix, then its perpendicular minor axis. Reject a nearly rotationally symmetric footprint when eigenvalue spread divided by trace is below `0.05`.

In principal-plane coordinates, normalize each point into the bounding rectangle. Keep points with major-axis fraction between `0.3` and `0.7`. On each minor-axis end, count occupied cells of a 40 × 40 grid in the outer 22% band. Reject when the larger count is below 20 or below twice the smaller count. The denser end determines the signed arch-front direction. Let `sourceSide = normalize(front × openingDirection)`. Map the source orthonormal frame `(sourceSide, front, openingDirection)` to the calibrated target frame defined by `targetOpening = normalize(0.03714905735, -0.68888926512, -0.72391403353)` and `targetFront = normalize(-0.01322175450, 0.72401182810, -0.68966082821)`, with `targetSide = normalize(targetFront × targetOpening)`. The rotation matrix is `targetFrame × transpose(sourceFrame)`. The implementation exports this rotation as a GLB node matrix. If arch-front estimation fails, the review tool writes no GLB; it does not guess a pose. These target directions come from the single approved reference pose, not from a universal print-angle rule.

### Reproduction and evidence

Run `npx vitest run src/core/analysis/dentalRegion.test.ts scripts/dental-region-review/review.test.ts` from the repository root. The tests parse `docs/dental-reference/reference-aligner.stl`, assert both loop sizes and face counts, rotate the exact same triangles and require an identical face mask, require a cube to be inconclusive, and verify GLB output. Run [`run-review.bat`](run-review.bat) for a future STL. The read-only exploratory source is `scripts/probe-dental-edges.ts` with `DENTAL_PROBE_CONNECTORS=1` and `DENTAL_PROBE_OPENING=1`; the older colored reference model is [`support-area-review.glb`](../docs/dental-reference/support-area-review.glb). Its teal surface is the proposed area, not an approved clinical truth for other patients.

To recreate this in another language: preserve mesh indexing and triangle order; calculate the orientation frame; construct a manifold edge→faces table; extract two 60° chains; join them along the 20° edge graph; rasterize and lift the central hole silhouette twice; cut face adjacency along both loops; select the opening-facing component under the stated checks. If any check fails, return an inconclusive result, not a partially painted mask.

### Limits and next safety gate

These measurements prove rotation consistency on one STL, not correctness on different aligners. An unusual trim, missing posterior section, scan hole, reversed/inconsistent winding, attachment, or second projected opening can cause abstention or a plausible but wrong candidate. The fixed edge-count, extent, angle, pixel, and region thresholds are calibrated only to the reference. The implementation samples eligible downward-facing *triangles* directly rather than requiring an opening-ray hit; Add paint can restore an erased candidate face but cannot authorize a face beyond either contour. Before release, test distinct similar STLs with labeled allowed/forbidden faces and inspect final support-body paths. User approval of the algorithm on this example is not proof of those remaining gates.
