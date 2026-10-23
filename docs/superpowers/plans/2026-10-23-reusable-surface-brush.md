# Reusable Surface Brush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse model-surface painting and overlays for zones and dental permits without sharing their business rules.

**Architecture:** A neutral surface-stamp helper copies unit-local hits into ordered strokes. Zone and dental modes retain separate stamp kinds, reducers, colors, and generation policies; the shared UI receives a profile rather than a scene command.

**Tech Stack:** TypeScript, React, React Three Fiber, Vitest.

---

### Task 1: Pure shared stamp helper

**Files:** Create `src/editing/surfaceBrush.ts`; create `src/editing/surfaceBrush.test.ts`.

- [ ] Write a failing test:

```ts
expect(appendSurfaceStamps('allow', 2, [{ point: [1, 2, 3], normal: [0, -1, 0] }]))
  .toEqual([{ center: [1, 2, 3], normal: [0, -1, 0], radius: 2, kind: 'allow' }]);
```

- [ ] Run `npm test -- --run src/editing/surfaceBrush.test.ts`; expect an import failure.
- [ ] Implement `SurfaceHit`, generic `SurfaceStamp<K>`, and `appendSurfaceStamps<K>(kind, radius, hits)`. Reject a non-positive radius; copy arrays so a pointer buffer cannot mutate persisted data.
- [ ] Re-run the test; expect pass. Commit `feat(editing): add reusable surface stamp contract`.

### Task 2: Reuse the contract in zones without behavior change

**Files:** Modify `src/core/supports/zones.ts`; modify `src/supports/zones.test.ts`.

- [ ] Write a failing test asserting a `paint` stroke converted by `appendSurfaceStamps` gives the same `zonedAt` answer as a literal `ZoneStamp`.
- [ ] Run `npm test -- --run src/supports/zones.test.ts`; expect failure until the generic type is accepted.
- [ ] Accept `SurfaceStamp<'paint' | 'erase'>` where `ZoneStamp` is consumed, without changing the ordered last-stamp-wins evaluator.
- [ ] Re-run focused zones and stamp tests; expect pass. Commit `refactor(zones): use shared surface stamp contract`.

### Task 3: Dental profile uses the same contract, not zone commands

**Files:** Modify `src/core/analysis/dentalPolicy.ts`; modify `src/state/project.ts`; modify `src/state/project.test.ts`.

- [ ] Write a failing reducer test that a dental `allow` stroke appends to `unit.dental.stamps` while `unit.zones` remains unchanged.
- [ ] Run `npm test -- --run src/state/project.test.ts`; expect failure if the generic stamp type does not assign to dental stamps.
- [ ] Type `DentalAllowStamp` as a specialized surface stamp and preserve `dental/stamps/add` as the only dental writer.
- [ ] Re-run the focused test; expect pass. Commit `refactor(dental): share surface stamp contract`.

### Task 4: Profiled UI extraction at the dental-flow stage

**Files:** Create `src/components/SurfaceBrushBar.tsx`; modify `src/components/ZonesBar.tsx`; modify `src/App.tsx`; modify `src/components/viewport/supportLayers.tsx`.

- [ ] Write a component test that the zone profile renders Paint, Erase, brush size, Clear, and Done; add a dental profile test that renders Paint, Erase, brush size, and Continue.
- [ ] Run the component test; expect an import failure for `SurfaceBrushBar`.
- [ ] Implement a profile prop with labels, tool values, optional Clear action, completion action, and surface colour. Retain the existing Mixo compact bar, blue zone content mark, and orbit-on-empty-space behavior. Dental's profile emits only dental events.
- [ ] Re-run focused UI tests and then `npm test; npm run build`; expect all pass. Commit `feat(dental): reuse surface brush UI`.

### Task 5: Verification and trail

**Files:** Modify `C:/Users/DCT/.claude/orchestrate/dental-auto-generate/trail/handoff.md`; modify `C:/Users/DCT/.claude/orchestrate/dental-auto-generate/trail/decisions.tsv`.

- [ ] Run `npm test; npm run build; git diff --check`; expect no regression.
- [ ] Record commit SHAs, test totals, build result, screenshot/performance evidence, and the local-only release status. Do not commit or upload `Aligner.stl`.
