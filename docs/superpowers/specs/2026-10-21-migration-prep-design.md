# Release 2 — bug sweep and migration prep (design)

Date: 2026-10-21. Owner: "fix them all, all bugs, and make them modular enough to be cleanly
prepared for migration" to mixomesh (Babylon.js). Owner delegated choices ("your pick for best
maintenance"): workers match mixomesh's `WorkerTask` contract; the shared heavy-mesh spec lives in
mixomesh docs, linked from here.

Inputs: `docs/migration/2026-10-21-babylon-review.md` (file:line map), `docs/migration/release-2-backlog.md`.

## Goals

1. **No behaviour change unless it fixes a bug**, proven by exact golden tests written first.
2. **Every known bug fixed** (backlog + ridge angle).
3. **Portable layers:**
   - `src/core/` — pure TS support core: vec3, transforms, conventions, placement, support mesh,
     check, zones, selection. No React, three, DOM, Vite, i18n, or app types (`PrintUnit`).
   - `src/editing/` — pure editing rules: session reducer, keys, stroke, pick, view framing, status
     keys.
   - `src/workers/` — job runner with the mixomesh `WorkerTask` contract (factory injection,
     progress, AbortSignal, timeout, revision echo, failure isolation, fallback), hosting the core.
   - React/three — thin view over the above.
4. **Licence-clean core:** GPL-derived code (`blenderBvh.ts`, `kdtree.ts`, Blender hash, any
   Blender-behaviour remesh parts) replaced by independent implementations with goldens unchanged;
   if exact parity proves impossible for a part, stop and ask the owner.
5. **Heavy meshes handled** with mixomesh-aligned budgets: web 1.5M / desktop 6M triangles; hard
   refusal above 4× budget with a clear message; tiers: full (< 300k), large (300k–budget: tips-only
   preview default, no overlay refinement), heavy (> budget: simplified display copy, export full,
   warning). One model copy per process at most; no long-lived per-worker copies. Memory estimate
   before import; refuse cleanly instead of crashing.
6. **Coordinate conventions in one module** (Y-up, mm, right-handed, CCW outward, Euler XYZ) with a
   documented Babylon adapter (`useRightHandedSystem` or one mirror at the boundary).
7. **UI spec for re-implementation** (state diagram, key/pick tables, status keys EN/zh-Hant/ja,
   colour/opacity table, numbers).
8. Heavy-mesh UX designed with the `impeccable` skill (harden); end-of-release `cia` audit.

## Out of scope

Actual Babylon port; add-on changes; new features.
