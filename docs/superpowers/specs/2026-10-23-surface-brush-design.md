# Reusable surface brush design

## Purpose

Reuse the no-support-zone surface painting machinery for the dental permitted-area step without
merging their opposite policies. This supports the approved dental sequence: orient, approve or
adjust the permitted area with Paint/Erase, then generate.

## Boundary

`editing/surfaceBrush` will own only viewport mechanics: model-surface ray hits, stroke sampling,
unit-local stamp creation, hover ring state, and incremental overlay invalidation. Its input is a
small profile:

- brush labels and the two tool values;
- radius and active tool;
- a hit-to-unit-local conversion supplied by the viewport;
- `commit(stamps)` and `clear()` supplied by the owning mode;
- overlay colour/material supplied by the owning mode.

The module will not decide what a stamp means, determine eligibility, or create supports.

## Consumers

No-support zones retain `paint | erase` stamps and `zones/add`; their overlay remains the existing
deep-blue denied-surface mark. Dental retains `allow | erase` stamps and `dental/stamps/add`; its
overlay uses one distinct permitted-surface colour and a glowing lower-boundary line. Both stamps
remain ordered, unit-local, undoable scene data.

## UI

The common compact Mixo tool bar contains Paint / Erase, brush size, Undo, optional Clear, and
Done. It uses the existing mode frame and badge. Dental's one red primary action is Done/Continue;
surface colour is content rather than a second UI accent. The existing zone bar becomes a thin
profile of this shared bar rather than a duplicated interaction implementation.

## Safety and tests

Each mode accepts a stroke only when it begins on the active model; empty-space drag remains orbit.
Changing mode cancels pending stroke work and preview. Tests cover shared stroke conversion,
unit-local coordinates after a model transform, ordered erase semantics, zone regression, and a
dental profile that cannot write a zone command.

## Rollout

First extract the pure interaction and overlay interfaces without changing zone behaviour. Then
switch zones to the profile. Finally add the dental profile and three-stage dental UI. Existing
zone tests and the full suite must remain green at each local commit.
