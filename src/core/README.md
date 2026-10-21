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
| `transform.ts` | Placement matrix (Euler XYZ), inverse, point/direction/positions transforms (three.js-exact arithmetic) |
| `analysis/types.ts` | `TriangleMesh`, placement settings and results |
| `analysis/mesh.ts` | Downward-face classification, overhang limits, regions, labels |
| `analysis/placement.ts` | Automatic contact placement (remesh minima, islands, edge anchors) |
| `analysis/edgeAnchors.ts`, `analysis/legacyRidges.ts` | Edge contacts and legacy ridge points (edges in first-use order, signed dihedral angle) |
| `analysis/supportCheck.ts` | Unsupported-region check |
| `analysis/nearestPoint.ts` | Exact nearest-point search (single precision, 2^-23-padded boxes) |
| `analysis/mergeByDistance.ts` | Merge by Distance in index order |
| `acosf.ts` | Single-precision arccos (FreeBSD msun port, engine-independent) |
| `analysis/vertexNormals.ts` | Angle-weighted vertex normals in single precision (Blender true normals up to the arccos) |
| `analysis/random.ts` | lookup3 pair hash and drand48 generator for the per-triangle scatter |
| `analysis/parity.testkit.ts` | Tie-aware comparisons with Resin UV's stage dumps (tests only) |
| `supports/settings.ts` | Live support settings, presets, limits |
| `supports/mesh.ts` | Support mesh builder (contacts, columns, trees, braces, raft, label) and picking helpers |
| `supports/remesh.ts`, `supports/openvdbTables.ts` | Voxel remesh used as the placement and tree surface |
| `supports/autotree.ts`, `supports/roof.ts`, `supports/raft.ts` | Tree layout, roof cage, raft outline |
| `supports/labelFont.ts`, `supports/labelFont.json` | Label letters (Inter Regular, OFL-1.1) |
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

## Defined tie rules

The island-minima stream follows Resin UV's stages but defines its own answers where Blender's
depend on its internal tree layouts:

- Nearest point (`NearestPoint`): exact single-precision minimum; an exact distance tie goes to
  the lowest point index.
- Merge by Distance: points exactly Spacing apart merge (`distance² <= Spacing²` in single
  precision, for every pair).
- Legacy ridge edges: first-use order (faces in order, each loop from its closing edge); an
  edge's convexity is judged by face 2's centroid against face 1's plane.
- Vertex normals: corner angles from `acosf` (single precision, `core/acosf.ts`); Blender uses
  a polynomial approximation, so normals agree to about 1e-5 rad, and a normal at exactly
  Overhang angle (a 90° box edge at 45°) may be kept by one and dropped by the other.

The Blender parity tests (`blenderMinima`, `blenderRidges`, `blenderParity`) check these
stages against Resin UV's dumps. A result may differ from Blender's only where it is an
equally valid answer under these rules:
- an exact distance tie;
- a pair exactly Spacing apart;
- a nearest-vertex tie;
- a quad whose convexity is ambiguous;
- a vertex normal within 2^-15 rad of Blender's;
- a keep verdict on such a knife-edge normal.

Edge order on an R of 1000+ faces is a different kind of exception, by design and not a
tie: Blender splits edges over 8 hash maps there, so the ridge points enter the merge in a
different order. The web order is pinned. Everything else must match bit for bit.

## Licence

**How it was written.** Task 10 replaced the earlier GPL-derived code: the point BVH, k-d tree
merge, hash, RNG, vertex normals and legacy ridges. The replacement was a single-person clean
room. The same agent read the GPL-derived files, wrote a behavioural spec of their public
interfaces and observable outputs, and then wrote the new code from that spec and the public
sources below, without reopening the old bodies.
(`.superpowers/sdd/2026-10-21-migration-prep/task-10-cleanroom-spec.md`).
Some formulas follow the spec statement for statement because bit parity forced it:
- the lookup3 mix;
- the srand48 LCG;
- Newell face normals and the angle-weighted sum in single precision.

For a stricter process, someone who has not seen the old code can re-implement from the spec.

**Independently written** (no Blender source):
- `analysis/nearestPoint.ts` (branch-and-bound k-d tree);
- `analysis/mergeByDistance.ts` (uniform grid);
- `analysis/legacyRidges.ts`;
- `analysis/vertexNormals.ts`;
- `analysis/random.ts`;
- the stage helpers in `analysis/placement.ts`.

**Sources:**
- Bob Jenkins, lookup3.c `hashword` (public domain).
- POSIX `srand48`/`lrand48` (the 48-bit LCG constants are the standard's).
- Newell's method for polygon normals.
- Angle-weighted vertex normals (Thürmer and Wüthrich, 1998).
- Bentley's k-d tree with branch-and-bound nearest search.
- Uniform-grid neighbour search.

**Third-party code that needs attribution:**
- `core/acosf.ts` is ported from FreeBSD msun `e_acosf.c`. Its notice is kept in the file:
  "Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunPro, a Sun
  Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software is
  freely granted, provided that this notice is preserved." The float conversion is by Ian
  Lance Taylor, Cygnus Support.
- `supports/remesh.ts` ports OpenVDB's `VolumeToMesh` and its `meshToVolume` band handling.
  `supports/openvdbTables.ts` holds OpenVDB lookup tables (Apache-2.0, Copyright Contributors
  to the OpenVDB Project). Keep that notice.

**Label font.** `supports/labelFont.json` holds Inter Regular glyph outlines exported by
`tools/fonts/export_label_font.py`. The source is the official Inter 4.1 static TTF
(SIL OFL-1.1, Copyright (c) 2016 The Inter Project Authors). The licence text is in
`tools/fonts/LICENSE-Inter.txt`; version, hashes and the reason the static file is used are in
`tools/fonts/README.md`. The add-on's MIXO_Label uses the same file. This replaces Blender's
built-in "Bfont", whose licence could not be established.
