# How the aligner gets its support locations

The detected edges are the starting point. The software does **not** paint the whole surface between the outer edge and the middle hole as a support area. It uses that wide surface only to work out which side of each edge faces the opening. Then it makes a narrow strip beside the edges and places support tips in that strip.

## The current method

1. The software estimates which way the aligner opens and suggests a print orientation. You can adjust the orientation in Step 1.
2. It traces the outer trim ridge on the 3D mesh. The strong ridge sections appear blue in the review GLB. Green paths follow weaker mesh edges to join the blue sections into one closed outer line. The back ends can rise, so the line need not be flat.
3. If the model has a clear central opening, the software traces its edge in red. It cuts the mesh along the outer and inner lines. The cut separates the surface into two groups. This tells the software which side of each line faces the opening; the wide group is **not** a support mask.
4. Starting at both lines, the software follows connected triangles for 0.2 to 1.2 mm on each side. It keeps the strips on the side opposite the opening-facing group. Their union is the narrow teal area shown in Step 2 and in the review GLB. It does not fill gaps by painting across empty space or across a fold of the mesh.
5. The software spaces proposed tips along the outer line at 3 mm intervals and along the middle line at 5 mm intervals. It moves each tip onto a nearby triangle in the teal strip. Add and Remove paint can change permission **within** that strip, but Add cannot extend it beyond the detected strip.
6. In Step 3, the app builds the shafts and its existing raft. The builder checks the current STL and strips again. It rejects a saved tip that no longer matches a detected location and rejects a support whose second model contact lands outside the strip. It also removes automatic pillars that its current body-clearance check finds passing through the model. Manual supports are separate.

The edge line alone cannot tell the software which side faces the opening. The wide face group gives that side label, but it cannot prove dental safety. The narrow strip grows **from the edge along the mesh**, not from every face in the wide group. This is the key difference between the current method and our first method.

## The earlier wide-area method remains useful

Our first method treated every face in the opening-facing group between the two detected lines as eligible. On the saved aligner, that group contains 254,344 triangles. It reached underside places that a downward ray might miss, but it also spread too far and produced tips on unwanted surfaces. We stopped using that group as the live contact mask. The code still calculates it because it labels the two sides of each edge, helps reject a bad contour, and may help future support-area tools. The older broad teal GLB and its explanation remain under [`docs/dental-reference`](../docs/dental-reference/README.md). In the **current** review GLB, teal means the narrow strip, not that old wide group.

The review GLB also shows both sides of each edge for diagnosis. Violet and amber sit on opposite sides of the outer line. Cyan and magenta sit around the middle line. Lime and pink dots are older 2 mm-spaced test markers, not current gold supports. These layers help you inspect the side choice; they do not prove dental safety.

The detector and support positions are calculated from each loaded STL. The saved reference STL is used for tests, not copied into a new model. Rotating that one STL passed tests, and an ideal supported example placed most measured tips near the detected edges. A new check removed two automatic pillars that crossed this reference model, but it does **not** prove every brace, tree, roof, or manual support clears it. We still lack a second patient model, a real U-shaped aligner with no middle hole, and an early-layer stability check. For now, a model with no clear central opening is inconclusive. Keep the app's raft; the ideal example may guide a future dental support diameter. The [support-module map](support-module-boundaries.md) shows which checks are generic and which rules are aligner-specific.

For exact thresholds, source files, and failure rules, read the [technical algorithm](technical-algorithm.md).
