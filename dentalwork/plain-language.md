# How Mixo Supports handles an aligner, in plain language

This page is for dentists and technicians. It has no code. For the engineering detail, see [the technical algorithm](technical-algorithm.md).

**Dental mode is a preview. It is not clinically validated.** It was built and tested on one aligner scan. Check every result yourself before you print.

## What the software does

You give it a scan of an aligner. It finds the trim edge of the aligner. It then places small support tips along that edge, builds the supports, and checks that the supports do not cut through the aligner.

The supports are placed only on a narrow strip next to the trim edge, on the outside face. They are never placed in the inner surface that touches the teeth.

## The four steps

Dental mode dims the rest of the editor so you can focus on one aligner at a time.

**Step 0. Aligner type.** You pick a card for the type of aligner. Each card shows a line drawing, a name and one sentence. Today there is one type, the reference aligner. The card is still shown, so the steps are always the same. The last type you chose is highlighted.

**Step 1. Aligner.** Drop or upload the STL file.
- The software first checks the mesh. If it has holes or broken geometry, it warns you and marks the detection as unreliable.
- It then turns the aligner into a good print position by itself.
- If the scan does not match the type you chose (for example, no central opening was found on a type that has one), it asks "This looks like a different aligner type. Switch?". It does not carry on silently.
- You can turn the aligner by hand with the gizmo, then press Next.
- If the software is not sure about the position, it says so and keeps the pose you dropped it in. You then turn it yourself.
- If the file is wrong, broken or too large, you get a clear message and stay in Step 1.

**Step 2. Support area.** The detected strip is shown in teal.
- **Strip width** makes the strip wider or narrower.
- **Support density** changes how close together the tips are.
- **Rim setback** moves the strip away from the trim edge.
- **Add area** and **Remove area** let you paint. You can only paint inside what the software already allows. Paint cannot make a face safe if the software has rejected it.
- If the software found no area, it says so, and you paint an area from scratch. Next stays off until something is painted. The software still checks every tip you create this way.

**Step 3. Supports.** Supports are built with default settings.
- You can change tip size, density, lift height, raft on or off, and Tree and Brace on or off. Supports are rebuilt after each change. Supports you added by hand are kept. A message tells you what was kept and what was reset.
- You can add a support or delete a selected one.
- The **Label** field is text printed on the support base. The default is `X`. It holds up to 8 characters: letters A to Z, digits 0 to 9 and `-`. Other characters are dropped and letters become capitals.
- **OK** finishes this aligner. **Add another aligner** also finishes it, and sends you back to Step 1 with the same type.
- After OK, all finished aligners stay on the plate as normal objects. Every time you add one, the software moves the aligners so they do not overlap. You can then export an STL or save the project.
- Back is allowed from Step 3 to 2 to 1. It asks first if you would lose supports you edited by hand. Exit leaves the current aligner on the plate with no supports. Aligners you already finished are kept.

## What the colors mean in the review file

The review script writes a 3D file you can open in Blender or another glTF viewer.
- **Blue**: the two strong sections of the outer trim edge.
- **Green**: weaker paths that join the blue sections into one closed line.
- **Red**: the edge of the central opening, if the aligner has one.
- **Teal**: the narrow strip where tips may go.
- **White**: all other faces.
- **Gold**: the supports.

Look at the file from every side. A good-looking file does not prove the supports are safe.

## How the strip is found

1. The software works out which way the aligner opens.
2. It follows the outer trim edge along the mesh. If the model has a central opening, it follows that edge as well.
3. It cuts the surface along these lines. This tells it which side of each line faces the opening.
4. It grows a thin strip from each line, along the mesh, on the other side. By default the strip starts 0.2 mm from the line and ends 1.2 mm from it.
5. It places tips along the strip, by default about every 3 mm on the outer edge and every 2 mm on the central opening. Each tip is moved onto a real face of the scan.

The wide face between the two lines is used only to tell which side is which. It is not a support area. An earlier version used it as one, and it put tips on the wrong surfaces.

## What the safety check does

After the supports are built, the software checks the finished 3D shape against the aligner. It asks whether any support passes through the aligner where it should not. A tip is meant to touch the surface. A shaft is not meant to cut through it.

The answer is always one of three:
- **Clear**: nothing wrong was found.
- **Blocked**: a support cuts through the model. The check says which part, which contact and which face. (Every generic model shows this, because supports always touch the model. It is not a refusal.)
- **Inconclusive**: the software could not decide. This happens when the mesh is too damaged to judge, or when the check ran out of time. Inconclusive never counts as clear.

When something crosses, the software tries a limited number of repairs. It first switches off Tree or Brace if they cross. It moves a crossing support to another allowed spot if the policy provides one (today no policy provides one). Otherwise it leaves that automatic support out and tells you. It never moves or deletes a support you placed by hand. If a hand-placed support crosses the model, it is reported.

## Export is refused in some cases

You cannot export in these cases. You get a message and no file is written:
- The result is out of date (you changed something while the export ran).
- The build returned nothing for an aligner that should have supports.
- The safety verdict is inconclusive.

## Warnings in the problem list

Step 3 has a problem list. Each entry has **Show**, which moves the camera there, and often a **Fix**, which adds a support.
- **Rim gaps**: a stretch of the trim edge where the built tips are more than twice the intended spacing apart. This is a request to look, not a clinical limit.
- **Supports left out**: tips that were not built because they would cross the model.
- **Unsupported island**: a low point of the model that no built support carries to the build plate. It is listed where it is.
- **Could not judge islands on this mesh**: the mesh has defects (for example, edges shared by four triangles), so no island is called supported. There is no Show or Fix. Repair the model and check again. Nothing is called clean in this case.
- **Islands outside the support area**: dental mode only. Low points that lie outside the allowed strip are not offered a fix, because a support there is not allowed. They are grouped into one entry for information. They are not counted as unsupported spots.
- A Check that has no current build says it did not finish. It never reports clean.

On the reference aligner at default settings, most of the low points are listed as unresolved. This is a measurement, not a ruling. Whether low points on the inside of an aligner should count at all is still an open decision for the owner.

## What has been tested, and what has not

Tested:
- One reference aligner, in many random positions.
- The software returns the same answers on that aligner every time.
- Every tip and every second landing lands on a face labeled allowed.

Not tested:
- Any other aligner. The software was tuned on one scan.
- An aligner with no central opening. The software can code for it, but there is no real scan to try. For now, a scan without a clear opening is "inconclusive" and gets no automatic supports.
- Printing. No supports from this software have been judged on a physical print, a printer or a resin.
- Early-layer stability on a printer. The island check is geometric, not a print simulation.

The mode is shown as a preview for these reasons. More scans and physical prints are needed before the label changes.
