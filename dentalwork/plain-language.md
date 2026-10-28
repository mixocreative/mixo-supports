# How Mixo Supports handles an aligner, in plain language

This page is for dentists and technicians. It has no code. For the engineering detail, see [the technical algorithm](technical-algorithm.md).

**Dental mode is a preview. It is not clinically validated.** It was built and tested on one aligner scan. Check every result yourself before you print.

## What the software does

You give it a scan of an aligner. It finds the trim edge of the aligner. It then places small support tips along that edge, builds the supports, and checks that the supports do not cut through the aligner.

By default the supports are placed only on a narrow area next to the trim edge, on the outside face. The software never puts them on the inner surface that touches the teeth by itself. You can move that area, widen it, and paint more area anywhere (see Step 2); painting is your decision.

## The four steps

Dental mode dims the rest of the editor so you can focus on one aligner at a time.

**Step 0. Aligner type.** You pick a card for the type of aligner. Each card shows a line drawing, a name and one sentence. Today there is one type, the reference aligner. The card is still shown, so the steps are always the same. The last type you chose is highlighted.

**Step 1. Aligner.** Drop or upload the STL file.
- The software first checks the mesh. If it has holes or broken geometry, it warns you and marks the detection as unreliable.
- It then turns the aligner into a good print position by itself.
- If the scan does not match the type you chose (for example, no central opening was found on a type that has one), it says "This looks like a different aligner type: no central opening was found." and offers **Switch to** each other type that has no central opening, and **Keep** the type you chose. It does not carry on silently. Today there is only one type, so only **Keep** is shown.
- You can turn the aligner by hand with the gizmo, then press Next.
- If the software is not sure about the position, it says so and keeps the pose you dropped it in. You then turn it yourself.
- If the file is wrong, broken or too large, you get a clear message and stay in Step 1.

**Step 2. Support area.** The support area is shown in teal: by default a narrow band along each detected edge, on its outer side. The proposed support tips are shown as dots and follow every change within about a second.
- **Area width** makes the area wider or narrower around its middle line (0.2 to 2.4 mm; default 0.5 mm). Widening never spreads the area across the edge onto the inner surface.
- **Area position** moves the area's middle line: higher values move it farther onto the outer surface, lower values toward the edge and, below 0, across it (from -0.4 to 2.5 mm; default 0.25 mm, so the tips sit about 0.25 mm onto the outer face). The tips sit on the middle line, so they move with the area.
- **Support density** changes how close together the tips are (0.5 to 2 times; at 1 the tips are about 3 mm apart on the outer edge and 4 mm apart on the central opening).
- **Paint** adds support area anywhere on the aligner, inside or outside the band. Painted area away from the band gets its own tips, spaced like the band's tips (about 3 mm at density 1) and kept that far from the band's tips. Only faces that face down in the print position get tips. **Erase** removes area anywhere, and the tips on it. The last stroke over a place wins. **Brush size** is the brush radius.
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
- **Gold**: the supports, without their tips. **Orange**: the final support tips (the thin end that touches the aligner). These two layers appear only when the review is made with supports.
- **Red markers** (folder review only): a place where a support cuts through the aligner. **Amber markers**: a crossing the check could not judge. **Purple markers**: a low point with no support.

Look at the file from every side. A good-looking file does not prove the supports are safe.

## How the strip is found

1. The software works out which way the aligner opens.
2. It follows the outer trim edge along the mesh. If the model has a central opening, it follows that edge as well.
3. It cuts the surface along these lines. This tells it which side of each line faces the opening.
4. It measures, along the surface, how far every face is from each line, on both sides. The support area is the faces whose distance is within half the area width of the area position. By default that is from the line to 0.5 mm from it, on the outer side.
5. It places tips along each line, by default about every 3 mm on the outer edge and every 4 mm on the central opening. Each tip goes to the face of the area that lies on the area's middle line, straight off the line (by default 0.25 mm from it). Two tips are never closer than 0.6 mm.

On the reference aligner at default settings this gives 71 tips on the outer edge (about 217 mm long) and 23 on the central opening (about 90 mm long). An earlier version put 45 tips on the central opening, 2 mm apart.

The wide face between the two lines is used only to tell which side is which. It is not a support area. An earlier version used it as one, and it put tips on the wrong surfaces.

## What the safety check does

After the supports are built, the software checks the finished 3D shape against the aligner. It asks whether any support passes through the aligner where it should not. A tip is meant to touch the surface. A shaft is not meant to cut through it.

The answer is always one of three:
- **Clear**: nothing wrong was found.
- **Blocked**: a support cuts through the model. A tip touching the surface it was placed on does not count, even on a fine mesh or where the tip sits over a thin edge such as the aligner rim. The result records which part, which contact (if one owns it) and which model face, but the app does not list these in the problem list. Automatic supports whose shaft crossed are left out and shown as "Supports left out" (see below); a tip whose neck crosses is not yet removed, so it stays and keeps the result blocked. Blocked is a warning, not a refusal: export still works. On the reference aligner 9 tips do this at default settings; the folder review shows where.
- **Inconclusive**: the software could not decide. This happens when a support end has no face to judge it against, when the mesh is too damaged to judge, when a rim cannot be measured, or when the check ran out of time. A timeout is always inconclusive: even a crossing found before the time ran out is not reported as blocked, because the scan may be partial. Inconclusive never counts as clear.

When something crosses, the software tries a limited number of repairs. Each rebuild counts against the budget (8 for the dental mode; 0 for a generic model, which only reports). It first switches off Tree or Brace if they cross. It then moves a crossing automatic support to another allowed spot if the aligner type offers one: in dental mode the alternates are spare spots in the gaps between the normal ones, and each spare spot is offered to only one support, so two supports never move to the same place. Otherwise it leaves that automatic support out and tells you. The last step builds only your hand-placed supports. It never moves or deletes a support you placed by hand. If a hand-placed support crosses the model, it is reported.

## Export is refused in some cases

You cannot export in these cases. You get a message and no file is written:
- The result is out of date (you changed something while the export ran).
- The build returned nothing for an aligner that should have supports.
- The safety verdict is inconclusive.

## Warnings in the problem list

Step 3 has a problem list. Each entry has **Show**, which moves the camera there, and often a **Fix**, which adds a support.
- **Rim gaps**: a stretch of the trim edge where the built tips are more than twice the intended spacing apart. This is a request to look, not a clinical limit.
- **Supports left out**: one entry that counts the automatic supports the build did not make: they would cross the model, broke a placement rule (for example, a second landing on a face that is not allowed), or the repair took them out. It reads "1 support was left out because it would cross the model or break a placement rule." (or "N supports were ..."). Show frames the first of them on the model and Fix opens Support Edit Mode so you can add a support by hand. It is information, not a counted unsupported spot. Supports that your own no-support zones took out are not in this entry, because you asked for that.
- **Unsupported island**: a low point of the model that no built support carries to the build plate. It is listed where it is.
- **Could not judge islands on this mesh**: the mesh has defects (for example, edges shared by four triangles), so no island is called supported. There is no Show or Fix. Repair the model and check again. Nothing is called clean in this case.
- **Islands outside the support area**: dental mode only. Low points that lie outside the allowed strip are not offered a fix, because a support there is not allowed. They are grouped into one entry for information. They are not counted as unsupported spots. An upward-facing plateau is not an island at all.
- A Check that has no current build says it did not finish. It never reports clean.

On the reference aligner at default settings, the check finds 54 low points. A built chain of supports carries 6 of them to the plate. 5 lie on the allowed strip and are listed as unsupported islands, each with Show and Fix. The other 43 lie outside the strip, where a support is not allowed, and are grouped in one information entry. This is a measurement, not a ruling. Whether low points on the inside of an aligner should count at all is still an open decision for the owner.

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
