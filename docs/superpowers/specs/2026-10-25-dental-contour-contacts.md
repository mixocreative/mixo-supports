# Dental contour contact design

Status: approved product direction, geometry and clinical validation pending. The current `codex/dental-rework` implementation still places tips across a broad face mask. This design replaces that permission rule; it does not claim that every resin/printer combination can use the same contacts.

## Operator rule

For a directly printed aligner, propose automatic support contacts in a narrow band on the **non-fitting side** of a validated lower trim ridge. Do not put a contact on the sharp crest itself, across the broad tooth-fitting cavity, or above the intended lower contour. If the mesh has a validated central opening, its rim may provide a second contact band. A model without that opening uses only the outer band. Show the exact proposed tips for review before building support bodies. The operator can erase tips or allow more within the certified bands; painting cannot override a failed geometric gate.

The band width and crest setback are process parameters to tune against actual print/fit results. They are not universal clinical numbers. Support density must also satisfy layer-island and mechanical stability checks. If a narrow band cannot carry a printable result, ask for a manual choice instead of silently expanding into the cavity.

## Detector contracts

Input: one indexed, consistently wound, manifold triangle mesh in unit-local coordinates. Preserve source face and edge IDs through orientation and export. Output is `proposal` or `inconclusive(reason)`; a proposal contains the opening axis, outer contour roles (strong ridge sections and weaker graph connectors), optional central-opening contour, contour confidence/evidence, and a face-local contact band. The old between-curves face mask is diagnostic only and may be computed independently. It must not grant contact permission.

Separate operations in dedicated dental files:

1. `orientation`: infer cavity axis and arch front; abstain on ambiguous sign. Keep the current reference-pose calibration separate from shape inference.
2. `outerContour`: find two long strong-ridge chains, join their ends along the weaker sharp-edge graph, and validate one simple closed mesh-edge cycle. Record each role separately. Do not assume the ridge is planar or a topological mesh boundary.
3. `centralOpening`: classify `present(loop)`, `absent(evidence)`, or `ambiguous(reason)`. Confirm projected occupancy at two resolutions. `absent` requires stable evidence that no enclosed central opening exists; a failed loop lift, multiple holes, or resolution disagreement is `ambiguous`, never `absent`.
4. `contactBand`: inspect both mesh-face sides of each contour. Identify the fitting cavity using opening direction, face normals, connected surface context, and the available inner contour. Trace a bounded geodesic strip on the opposite side; exclude the crest and all tooth-facing/cavity faces. For the central-opening rim, determine its own exterior-side strip, not an assumed shared side. If the side cannot be separated reliably, return `inconclusive`. A side assignment based only on normal sign or a 2D projected band is insufficient.
5. `placement`: distribute candidate contacts by **3D contour arclength**, then move each onto a certified non-fitting-side strip with an exact source-face ID. A downward-facing normal is useful evidence, but it cannot be a universal requirement: an edge-adjacent strip can be near vertical. For non-downward faces, require an explicit collision-free approach path and layer-island/stability check; otherwise omit that contact. Apply spacing, painted removals, and secondary-landing face checks. Preview shows final eligible tip locations and any omitted/unsafe count.

Classify a proposal as `two-contour` only with both validated loops and bands; `outer-only` only with stable absence evidence and a validated outer band. Otherwise abstain. Saved policy must be recomputed and compared to the current mesh before use. A stale policy is not grandfathered into permission.

## Verification gates

- Reference STL: preserve expected outer 2,665-edge loop and 339-edge central loop; random rotations must preserve edge and face identities. Label forbidden tooth/cavity faces and allowed external near-ridge faces; assert **every** proposed tip and secondary landing is on an allowed face.
- Review GLB: show strong ridge blue, connectors green, central opening red, candidate contact bands in distinct colors, excluded cavity neutral, and final tips separately. A diagnostic face-between-loops overlay remains available but is not called support permission.
- Different aligner STL with an opening: run the same checks. Until available, cross-patient correctness is unverified.
- No-hole aligner STL: prove stable `absent` classification and outer-only contacts. Synthetic fixtures can test control flow, but cannot validate anatomy.
- Browser: Step 1 orientation, Step 2 band/tip preview and paint, Step 3 support build. Preview and built source contact IDs must agree after declared omissions. Budget computation time and allow cancellation.
- Physical print/fit review: clinician/lab must validate contact marks, fit, removal, and process settings. Software tests do not establish clinical suitability.

## Reversibility

Keep this work on `codex/dental-rework`. A failed detector gives no automatic dental contacts, not the old broad mask. Preserve the old face-region function for diagnostics and potential future non-dental use, isolated from production permission. Do not merge or describe as ready while independent meshes, annotated forbidden faces, and support-body review remain outstanding.
