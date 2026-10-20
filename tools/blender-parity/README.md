# Blender parity harness

The goal: the same settings give the same supports in Resin UV (Blender) and in the web editor.

1. `probe.py` runs inside Blender with the `mixo3d` add-on. It generates supports on a downward pyramid for a matrix of settings and records:
   - every contact and its touch sphere
   - the support piece each contact grows (foot centre and radius, column top)
   - the raft profile
2. The output is committed as `reference.json`.
3. `src/supports/blenderCases.test.ts` feeds each case's contacts (with their true surface normals) and settings through the web generator, then compares every number. It runs in `npm test` and does not need Blender.

Regenerate after changing the add-on:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup `
  --python tools/blender-parity/probe.py -- S:/ai/mixo3dtool tools/blender-parity/reference.json
npm test
```

Rules confirmed by the probe:

- **Column:** foot frustum from Bottom Ø to Middle Ø, from the plate up to Bottom Thickness. Then a vertical pillar at Middle Ø.
- **Neck:** a cone from Middle Ø to Upper Ø that ends at the contact. It follows the surface normal, tilted at most Connection Angle from straight down.
  - Edge anchors and the apex get vertical necks.
  - Contact Depth sinks the tip along the normal. The neck's bottom stays Connection Length from the contact.
- **Touch sphere:** Contact Ø, centred on the sunk tip.
- **Edge anchors:** inset Contact Ø/2 + 0.05 mm from the edge (`EDGE_INSET_MARGIN`).
- **Raft:**
  - It follows the model outline on the plate grown by Expand Width. At 64 voxels the edge sits 1.00 mm further out per mm of Expand Width.
  - The floor edge and the rim both flare outward going up at the Wall Angle. The rim is Wall Thickness wide.
  - At 16 and 32 voxels SLASG quantises the edge by up to about 0.9 mm.

Not replicated yet: SLASG's pillar-repulsion step. When 45° necks crowd each other, Blender turns or shortens them; on the probe model this affects 3 to 6 of 17 supports, and none at a 30° Connection Angle. The test counts these supports instead of comparing them.
