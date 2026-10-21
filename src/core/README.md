# src/core — portable support core

Pure TypeScript that a host app (this React/three.js editor today, the Babylon.js app mixomesh
later) calls to place, build and check resin supports. No React, three.js, DOM, Vite-only syntax,
i18n or app state; `imports.test.ts` enforces that for `src/core/**` and `src/editing/**`.

## Conventions

See `conventions.ts`: +Y up, millimetres, right-handed, counter-clockwise outward triangles, Euler
'XYZ' in radians. Vectors are plain `[x, y, z]` tuples (`Vector` in `vec3.ts`). A host with other
conventions converts at its boundary.

## Modules

| Path | Role |
|---|---|
| `vec3.ts` | Shared vector helpers (`add`, `subtract`, `scale`, `dot`, `cross`, `length`, `lengthSq`, `distance`, `distanceSq`, `normalize`) |
| `conventions.ts` | Coordinate convention constants |
| `transform.ts` | Placement matrix (Euler XYZ), inverse, point/direction/positions transforms (three.js-exact arithmetic) |
| `analysis/types.ts` | `TriangleMesh`, placement settings and results |
| `analysis/mesh.ts` | Downward-face classification, overhang limits, regions, labels |
| `analysis/placement.ts` | Automatic contact placement (remesh minima, islands, edge anchors) |
| `analysis/edgeAnchors.ts`, `analysis/legacyRidges.ts` | Edge and ridge contacts |
| `analysis/supportCheck.ts` | Unsupported-region check |
| `analysis/blenderBvh.ts`, `analysis/kdtree.ts` | Blender-behaviour BVH and merge-by-distance |
| `supports/settings.ts` | Live support settings, presets, limits |
| `supports/mesh.ts` | Support mesh builder (contacts, columns, trees, braces, raft, label) and picking helpers |
| `supports/remesh.ts`, `supports/openvdbTables.ts` | Voxel remesh used as the placement and tree surface |
| `supports/autotree.ts`, `supports/roof.ts`, `supports/raft.ts` | Tree layout, roof cage, raft outline |
| `supports/bfont.ts`, `supports/bfont.json` | Label font outlines |
| `supports/zones.ts`, `supports/overlayMesh.ts` | No-support zones and their overlay mesh |

## Not yet portable

Kept outside `src/core` because they import app modules or three.js:

| Module | Reason |
|---|---|
| `src/supports/unitSupports.ts` | App glue: `PrintUnit`/`SupportSettings` (state/project) and three-based `state/transform`. Task 8 makes it the only `PrintUnit → SupportJob` adapter. |
| `src/supports/selection.ts` | `deleteCommands` returns `SceneCommand`s for `PrintUnit` (state/project). The pure selection rules (toggle, paint, prune, brush) live in `src/editing/selection.ts`. |
| `src/supports/export.ts` | `PrintScene`/`PrintUnit` and `state/transform` (three). |
| `src/supports/zones.test.ts` | Tests core `zones.ts` but builds orientations with `state/transform` (app module; three-free since Task 7). Could move by switching it to `core/transform.ts`. |
| `src/supports/blenderMinima.test.ts`, `src/supports/blenderParity.test.ts` | Build meshes with three `BoxGeometry` and `state/import`. |

`analysis/placement.test.ts` reads the `v-ridge` mesh from `src/goldens/fixtures.ts`, which imports
three's STL loader; the core test passes the scan (it imports no forbidden module itself) but pulls
three in transitively.

## Licence

`blenderBvh.ts`, `kdtree.ts`, the Blender hash in `placement.ts` and the Blender-behaviour parts of
`remesh.ts` are translations of Blender C source (GPL-2.0-or-later); Task 10 replaces them.
`openvdbTables.ts` is OpenVDB-derived (attribution).
