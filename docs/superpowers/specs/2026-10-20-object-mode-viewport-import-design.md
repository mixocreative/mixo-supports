# Object Mode and Viewport Import Design

## Goal

Make imported meshes behave like selected Blender objects: users can drop supported 3D files directly anywhere in the viewport, then select, translate, and rotate the model with an on-canvas gizmo.

## Interaction

- The viewport is the primary drop zone. A drag overlay provides visible feedback and accepts STL, GLB, and GLTF files.
- A successful import positions the mesh above the build plate, selects it, and enters Object Mode without replacing derived support state until the user regenerates.
- Clicking the visible model selects it. The selected model receives a high-contrast outline and a compact Object Mode status badge.
- A toolbar offers Select, Move, and Rotate. Move and Rotate attach a Drei `TransformControls` gizmo to the selected model.
- While the gizmo is dragging, camera orbit is disabled. On drag completion, the model transform is serialized in project state and geometry-dependent support regeneration is marked stale.

## Boundaries

This increment supports exactly one selected imported model. Source vertex data remains immutable; its transform is stored separately and applied to rendering, analysis, support preview, baking, and export. Existing manual support state is retained; users explicitly regenerate automatic contacts after a transform.

## Verification

Tests cover transform reducer behavior and that a transformed placement request receives transformed positions without mutating source positions. A build verifies the React integration. Manual browser verification covers drop anywhere over the viewport, immediate selection, move/rotate gizmo behavior, and preserved camera orbit outside a gizmo drag.

## Handoff

Future multi-model selection, transform snapping, numeric transform panels, scale gizmos, and hierarchy/outliner behaviors remain separate work. Do not add inactive controls for them.
