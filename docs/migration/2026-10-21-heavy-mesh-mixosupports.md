# Heavy meshes in mixosupports — measurements and budgets

Shared contract (budgets pattern, tiers, pre-parse refusal, memory model, progress UX): mixomesh
`docs/superpowers/specs/2026-10-21-heavy-mesh-handling.md` (branch `feat/heavy-mesh`). This note holds
the mixosupports side; the controller merges these numbers into the shared spec.

Fixtures: `npx vite-node scripts/make-heavy-meshes.ts` (bumpy closed spheres, binary STL, written to the
git-ignored `.playwright-mcp/heavy/`). Harness: `node scripts/measure-heavy.mjs [--runtime desktop]` (Vite
on 5202 + a private Chromium from the Playwright cache, real file input, renderer/GPU private bytes
sampled every 100 ms). Machine: Windows 11, 64 GB RAM, RTX 3090.

| Fixture | Runtime | Import | Longest main-thread block | Generate (place + preview) | Peak renderer | Peak GPU process | JS heap after |
|---|---|---|---|---|---|---|---|
| 2.0M binary STL (95 MiB) | web | 2.0 s | 56 ms | 42.9 s | 1.89 GB | 237 MB | 93 MB |
| 5.0M binary STL (238 MiB) | web | 3.7 s | 91 ms | 110 s | 4.13 GB | 260 MB | 151 MB |
| 10M binary STL (476 MiB) | web | refused before parsing, 245 ms | 0 | — | 122 MB | 206 MB | — |
| 10M binary STL | desktop (budget then 6M) | 10.0 s | 0 | page stopped responding at 210 s (placement 65 %) | 6.47 GB | 367 MB | — |

Import pipeline alone (Node, same code as the import worker): 10M welds in 2.4 s at 388 MB peak RSS;
three's STLLoader + `mergeVertices` took 16.7 s and 2.19 GB for the same file (same 4,995,958 vertices).

Budgets (`src/core/budget.ts`): **web and desktop both warn at 1.5M and refuse above 6M.** Import is cheap,
but Generate costs about 0.85 GB of renderer memory per million triangles, and 10M stopped the tab, so
the refusal line follows generation, not import. A desktop shell runs the same Chromium renderer, so it
gets the same numbers until placement memory drops. mixomesh (import and editing only) measured web
2.5M / 10M and desktop 6M / 24M.

Differences from the shared wording: the refusal omits "or use the desktop app" (mixosupports has none).

Guards added after review (Task 9 fix round 1): the plate may hold at most 6M triangles (`plate-full`
at import); placements, preview builds and exports start only while running heavy jobs plus their own
stay within 6M (`src/core/jobGate.ts`, shown as "Queued"); Generate is refused when what can run at
once × 850 MiB/M exceeds half of `navigator.deviceMemory` (Chrome reports at most 8 GB, so on Chrome
this caps a single Generate at about 4.9M triangles at a time).
