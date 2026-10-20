# Blender Parity Checklist

Reference: Resin UV `SLA Supports` panel in `S:/ai/mixo3dtool/mixo3d` (`properties.py`, `helpers/slasg_map.py`, `ops/support_manual.py`). Parity is judged by behaviour, contact counts, dimensions and bounding boxes. Exact Geometry Nodes vertex output is out of scope.

| Panel feature | Blender behaviour | Web implementation | Evidence |
|---|---|---|---|
| Generate | Places live supports on the selected units | `App.generate` runs one worker job per unit (`supportWorker.ts`). The unit is lifted so its lowest point sits at Lift Height. | Browser: 4 units generated (178/145/73/52 contacts) |
| Presets Light/Middle/Heavy | `slasg_map.PRESETS`; editing a preset value switches to Custom; Support Spacing is not part of a preset | `supports/settings.ts` `presetValues`, `updateSetting`, `PRESET_KEYS` | `settings.test.ts`; browser: Heavy applied live |
| Contact / neck / pillar / foot settings | Contact Ø, Contact Depth, Upper Ø, Connection Length/Angle, Middle Ø, Bottom Ø/Thickness | `mesh.ts` tip sphere, neck frustum clamped to `maxNeckAngle`, transition cone, pillar, foot | `mesh.test.ts` (plate at y=0, neck angle, foot on raft floor) |
| Bracing | Braces, Ø, angle, Z spacing, start height, top spacing, distance limit | `mesh.ts` `addBraces` (nearest-neighbour zigzag) | `mesh.test.ts` brace on/off and height gating |
| Raft | Raft on/off, expand width, floor thickness, wall height/thickness/angle | `mesh.ts`: floor at Expand Width from the foot centres; rim Wall Thickness wide, leaning **outward going up** by Wall Height x tan(Wall Angle); feet stand on the plate inside the floor | Measured in Blender 5.2: `blenderParity.test.ts` (rim edge 13.06 at the bottom and 13.92 at the top vs web 12.90 and 13.77) |
| Roof / Cage | Off/Roof/Cage, mode defaults seeded on first use, columns, cross bars, roof braces, rings | `setRoofMode` + `addStructures` | `settings.test.ts`, `mesh.test.ts`; browser: roof and cage rendered |
| Letter label | Pad centred on the raft's front-right vertex, frustum from the plate to Wall Height flaring at Wall Angle, letters on top | `font.ts` 5x7 glyph runs + `addLabel` | `mesh.test.ts`; side-by-side render against a Blender STL export |
| Tree supports | Auto Tree, merge distance, branch descent, section increment | `tree.ts` topology + trunk radius growth in `mesh.ts` | `tree.test.ts`, `mesh.test.ts`; browser: tree rendered |
| Auto placement | Stock scatter field plus edge anchors inset 0.3 mm at 2 mm spacing; priority minima > edges > surface | Deterministic Poisson-disk interior (minimum gap 1.2 x spacing) after island and edge anchors | `blenderParity.test.ts`: web 91 contacts (cap 81, stem 10) vs Blender 100 (92, 8) |
| Preview / low poly / resolution | Only Tip preview; low poly; resolution; export always Full | `buildSupportMesh` `mode: 'export'` ignores preview and low poly | `mesh.test.ts` |
| Manual add | Click adds a contact | Support edit mode **Add**: click the model | Browser: 0 → 1 manual |
| Manual remove | Ctrl+Click / right-click removes; erase radius | Right-click or Ctrl+click a support; Ctrl+click the model (or **Remove** mode) erases within Erase Radius | Browser: right-click 178 → 177 automatic, 1 removed |
| Removed points persist | Hidden markers list of removed auto points | Automatic IDs are quantised positions, so suppressions follow the spot through any regeneration | `placement.test.ts`; browser: suppression kept after move and regenerate |
| Clear manual edits | Restores automatic points, drops manual ones | `supports/clear-manual` | `project.test.ts`; browser |
| Remove supports | Deletes supports, model untouched | `supports/remove` keeps manual edits and suppressions for regeneration | `project.test.ts`; browser |
| Multi-unit transforms | Model and supports move together | One parent group per unit; supports stored in unit space plus their generation frame | `unitSupports.test.ts`, `transform.test.ts`; browser move and rotate |
| Undo / redo | Blender undo stack | Snapshot history (100 steps); one step per command, batch or gizmo drag | `history.test.ts`; browser Ctrl+Z / Ctrl+Y |
| Export | OBJ/STL/3MF of the safe copies, with or without the model | Binary STL: active printable, active supports only, each unit printable, each unit supports only, whole scene | `export.test.ts`; browser: all 5 modes valid (84 + 50·n bytes) |

## Intentionally excluded

- **Bake Supports** (frozen copies of generated supports).
- **Hidden original/proxy copies**: lifted proxy objects, `MARKERS` and `EDGE_CANDIDATES` objects, and the `Show Model` toggle. Printable vs supports-only export replaces `Show Model`.
- Blender collections and datablocks, and OBJ/3MF export formats.
- Vertex-for-vertex Geometry Nodes output.

## Known differences

- Blender's default raft is voxelised at 16 voxels, which pulls its edge about 0.7 mm inward compared with 64 voxels. The web raft matches the 64-voxel profile and ignores Voxel Resolution.
- Interior contact positions differ, because Geometry Nodes uses a random seed. Counts, edge anchors and spacing match.

- Rafts, roofs and cages follow the convex hull of the feet, so a concave footprint gets a convex raft.
- Tree layout is a deterministic approximation of SLASG Auto Tree.
- Generate does not re-pack units on the plate (Blender `ARRANGE_GAP` packing). Imports are placed 3 mm apart, so rafts of neighbouring units can overlap until a unit is moved.
- `autoSnap` and `scatterSafeDistance` are stored but have no web effect yet.
