# src/core — portable support core

Pure TypeScript that a host app (this React/three.js editor today, the Babylon.js app mixomesh
later) calls to place, build and check resin supports. No React, three.js, DOM, Vite-only syntax,
i18n or app state; `imports.test.ts` enforces that for `src/core/**` and `src/editing/**`: a
relative import must resolve inside those two trees (or to JSON under `tools/`; tests may also
read `src/goldens/`).

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
| `analysis/edgeAnchors.ts`, `analysis/legacyRidges.ts` | Edge contacts and legacy ridge points (edges in first-use order, signed dihedral angle) |
| `analysis/supportCheck.ts` | Unsupported-region check |
| `analysis/nearestPoint.ts` | Exact nearest-point search (single precision, 2^-23-padded boxes) |
| `analysis/mergeByDistance.ts` | Merge by Distance in index order |
| `analysis/vertexNormals.ts` | Angle-weighted vertex normals in single precision (Blender true normals, bit for bit) |
| `analysis/random.ts` | lookup3 pair hash and drand48 generator for the per-triangle scatter |
| `analysis/parity.testkit.ts` | Tie-aware comparisons with Resin UV's stage dumps (tests only) |
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

## Defined tie rules

The island-minima stream follows Resin UV's stages but defines its own answers where Blender's
depend on its internal tree layouts:

- Nearest point (`NearestPoint`): exact single-precision minimum; an exact distance tie goes to
  the lowest point index.
- Merge by Distance: points exactly Spacing apart merge (`distance² <= Spacing²` in single
  precision, for every pair).
- Legacy ridge edges: first-use order (faces in order, each loop from its closing edge); an
  edge's convexity is judged by face 2's centroid against face 1's plane.

The Blender parity tests (`blenderMinima`, `blenderRidges`, `blenderParity`) check these
stages against Resin UV's dumps. A result may differ from Blender's only where it is an equally
valid answer under these rules: an exact distance tie, a pair exactly Spacing apart, a
nearest-vertex tie, or a quad whose convexity is ambiguous. Everything else must match bit for bit.

## Licence

`src/core` is independent code. It was written from behavioural specs and public algorithm
descriptions, not from Blender source (Task 10 replaced the earlier GPL-derived BVH, k-d tree,
hash, RNG, vertex normals and legacy ridge code). The public sources used are Bob Jenkins'
lookup3 (public domain), POSIX `drand48`, Newell normals, angle-weighted vertex normals, and
standard branch-and-bound nearest search.

The one exception is attribution: `supports/remesh.ts` ports OpenVDB's `VolumeToMesh` and
`meshToVolume` band handling, and `supports/openvdbTables.ts` holds OpenVDB lookup tables
(Apache-2.0, Copyright Contributors to the OpenVDB Project). Keep that notice.

The licence of the Bfont outline data (`supports/bfont.json`) is a separate check.
