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
| `analysis/types.ts` | `TriangleMesh`, placement settings and results |
| `analysis/mesh.ts` | Downward-face classification, overhang limits, regions, labels |
| `analysis/placement.ts` | Automatic contact placement (remesh minima, islands, edge anchors) |
| `analysis/edgeAnchors.ts`, `analysis/legacyRidges.ts` | Edge and ridge contacts |
| `analysis/supportCheck.ts` | Unsupported-region check |
| `analysis/blenderBvh.ts`, `analysis/kdtree.ts` | Blender-behaviour point BVH (nearest point) and merge-by-distance |
| `analysis/vertexNormals.ts` | Angle-weighted vertex normals in single precision (Blender true normals, bit for bit) |
| `analysis/random.ts` | lookup3 pair hash and drand48 generator for the per-triangle scatter |
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
| `src/supports/selection.ts` | `deleteCommands` returns `SceneCommand`s for `PrintUnit` (state/project). The rest (toggle, paint, prune, brush) is pure and can move once the command part is split off. |
| `src/supports/export.ts` | `PrintScene`/`PrintUnit` and `state/transform` (three). |
| `src/supports/zones.test.ts` | Tests core `zones.ts` but builds orientations with `state/transform` (three); can move after Task 7's `core/transform.ts`. |
| `src/supports/blenderMinima.test.ts`, `src/supports/blenderParity.test.ts` | Build meshes with three `BoxGeometry` and `state/import`. |

`analysis/placement.test.ts` reads the `v-ridge` mesh from `src/goldens/fixtures.ts`, which imports
three's STL loader; the core test passes the scan (it imports no forbidden module itself) but pulls
three in transitively.

## Licence

Independent implementations (Task 10, written from a behavioural spec and public algorithm
descriptions, not from Blender source):

- `analysis/vertexNormals.ts`: Newell face normals and angle-weighted vertex normals.
- `analysis/random.ts`: Bob Jenkins' lookup3 `hashword` (public domain) and the POSIX
  `drand48` generator.

Still translations of Blender C source (GPL-2.0-or-later), pending the owner's decision:

- `analysis/blenderBvh.ts` (`BLI_kdopbvh` point tree) and `analysis/kdtree.ts` (`BLI_kdtree`
  merge by distance). Generic replacements change placement: their tie-breaks (equidistant
  nearest points, points exactly Spacing apart) depend on Blender's exact tree layout, so the
  Blender parity tests and nine goldens move. See the Task 10 report.
- `analysis/legacyRidges.ts` follows named Blender functions (edge order, face normal, quad
  split, angle between normals); not yet reviewed for replacement.

`supports/remesh.ts` ports OpenVDB's `VolumeToMesh` and `meshToVolume` band handling;
`openvdbTables.ts` holds OpenVDB lookup tables (Apache-2.0, Copyright Contributors to the
OpenVDB Project; attribution kept there). Its Blender-specific parts are behaviour of how
Blender calls OpenVDB (voxel size and adaptivity in single precision, grid not tagged as a level
set, triangles before quads, quads split 0-2) and textbook formulas, not translated Blender code.
