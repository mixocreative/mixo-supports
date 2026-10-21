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
| `jobs.ts` | `SupportJob`, `PlacementJob`, `CheckJob`: plain job inputs (unit-local mesh, transform, settings, contact edits, label), and `jobContacts` (final contacts from the edits) |
| `budget.ts` | Heavy-mesh budgets (warn 1x, refuse 4x per runtime), tiers (full / large / heavy), `assertTriangleCapacity`, memory estimate and cap |
| `decimate.ts` | Deterministic vertex-clustering simplification, for the display copy of a heavy mesh only |
| `import/stl.ts` | Chunked binary/ASCII STL straight into a welded Y-up mesh (identical to three's STLLoader + rotateX + mergeVertices) |
| `import/weld.ts` | Typed-array vertex weld (open addressing, no string keys), bit-identical to `mergeVertices(geometry, 1e-4)` |
| `import/estimate.ts` | Triangle count before parsing: binary STL exact from size, ASCII STL sampled, glTF/GLB from the JSON |
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
| `src/supports/unitSupports.ts` | App glue: the only `PrintUnit` → `SupportJob` / `PlacementJob` / `CheckJob` adapter, plus the per-unit caches the UI reads. |
| `src/supports/jobRunner.ts` | Runs the core jobs (any thread). Uses three-based `state/transform`; moves into the core with a three-free transform module. |
| `src/supports/selection.ts` | `deleteCommands` returns `SceneCommand`s for `PrintUnit` (state/project). The rest (toggle, paint, prune, brush) is pure and can move once the command part is split off. |
| `src/supports/export.ts` | `PrintScene`/`PrintUnit` and `state/transform` (three). |
| `src/supports/zones.test.ts` | Tests core `zones.ts` but builds orientations with `state/transform` (three); can move after Task 7's `core/transform.ts`. |
| `src/supports/blenderMinima.test.ts`, `src/supports/blenderParity.test.ts` | Build meshes with three `BoxGeometry` and `state/import`. |

`analysis/placement.test.ts` reads the `v-ridge` mesh from `src/goldens/fixtures.ts`, which imports
three's STL loader; the core test passes the scan (it imports no forbidden module itself) but pulls
three in transitively.

## Licence

`blenderBvh.ts`, `kdtree.ts`, the Blender hash in `placement.ts` and the Blender-behaviour parts of
`remesh.ts` are translations of Blender C source (GPL-2.0-or-later); Task 10 replaces them.
`openvdbTables.ts` is OpenVDB-derived (attribution).

## Jobs and workers

The app runs the jobs in Web Workers through `src/workers/WorkerTask.ts`, a port of mixomesh's
`WorkerTask`/`serveTask` contract (factory injection, progress, AbortSignal, timeout, revision echo,
crash isolation, fallback); worker factories live only in `src/workers/factories.ts`.

Model copies: placement and check jobs carry a copy of the model that is transferred to the worker
and dropped with the job. The preview support-mesh worker keeps one model per unit in a token cache
(`src/workers/sourceCache.ts`) so rebuilds keep their remesh caches warm; entries are freed when the
unit is removed (`forget`, which also drops that unit's queued builds) and the cache caps model
bytes at 512 MiB (least recently used first; an evicted model is sent again on demand). The remesh
and raft caches derived from a model are not counted; they go with the evicted model. Exports run in a per-job worker that ends with the export.
