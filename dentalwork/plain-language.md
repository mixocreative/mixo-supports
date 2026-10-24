# How the dental support region is found

The software tries to mark the inside, downward-facing part of an aligner where supports may touch. It does not recognize teeth as a person does. It follows the aligner's shape and checks whether the result makes geometric sense.

The first clue is a sharp ridge around the outside of the intended support area. On the reference aligner, the strongest parts form two separate chains. The review GLB colors those chains **blue**. The software joins their ends by following less-sharp mesh edges, not by drawing straight lines through empty space. Those joining paths are **green**. Blue and green together make one closed outer boundary. The back ends can rise; the boundary need not lie on a flat plane.

The opening in the middle is a second boundary. The software finds the hole when looking along the aligner's opening direction, then traces its edge on the actual 3D model. This boundary is **red**.

Imagine cutting the surface along the blue, green, and red edges. The cut must leave exactly two connected face groups. The group that faces the opening becomes the proposed support region, colored **teal**. The other group stays **white**. Supports may start only on eligible teal triangles. The final placement step also checks that a triangle faces downward enough for a support; teal does not promise a support on every triangle.

The tool separately estimates an orientation from the cavity and arch shape, then places the review GLB in its proposed print pose. That pose is a calibrated suggestion, not a universal dental rule. If the hole or boundaries are unclear, or if the cuts do not make two plausible groups, the detector reports “inconclusive” and does not approve a region.

The reference STL produced one plausible result and passed a rotation test. That does not establish accuracy for a different patient's aligner. Inspect the GLB from the inside, outside, front, and back before trusting its colors. The [technical algorithm](technical-algorithm.md) states the exact tests and thresholds.

A support can start in the teal area but touch the aligner again lower down. The final build checks that second touch against the approved mesh faces. On the reference, it rejected four of 397 proposed tips and built 393 supports. Step 2 shows proposed tips because it has not yet checked those second touches. This check does not prove that every support rod or cross-brace stays clear of the outside surface; inspect the final support model before printing.
