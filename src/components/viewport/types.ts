import type { SupportProblem } from '../../core/analysis/supportCheck';
import type { GeneratedSupportMesh } from '../../core/supports/mesh';
import type { ZoneStamp } from '../../core/supports/zones';
import type { Vector } from '../../core/vec3';
import type { BrushMode, EditMode, EditTool, SelectStyle, ZoneKind } from '../../editing/types';
import type { PrintScene } from '../../state/project';
import type { ModelTransform } from '../../state/transform';

export type GizmoMode = 'none' | 'translate' | 'rotate';

export interface ObjectViewportProps {
  scene: PrintScene;
  supportMeshes: ReadonlyMap<string, GeneratedSupportMesh>;
  editMode: EditMode;
  gizmoMode: GizmoMode;
  modelVisible: boolean;
  wireframe: boolean;
  onSelect: (unitId: string | null, additive: boolean) => void;
  onTransform: (unitId: string, transform: ModelTransform) => void;
  onAddContact: (unitId: string, point: Vector, normal: Vector) => void;
  onRemoveContact: (unitId: string, contactId: string) => void;
  onErase: (unitId: string, point: Vector) => void;
  /** A Support Edit Mode click that hit neither the model nor a support. */
  onEditMiss: () => void;
  editTool: EditTool;
  /**
   * The edit tool as it is now. The canvas renders a step behind the DOM, so a click right after a
   * tool switch would otherwise act with the previous tool; clicks read this instead of `editTool`.
   */
  liveTool?: () => { tool: EditTool; selectStyle: SelectStyle };
  /** Present only while Select supports drags over supports (circle radius in screen px). */
  brush?: { radius: number; mode: BrushMode };
  /** Selected contact ids of the active object. */
  selection: ReadonlySet<string>;
  onToggleContact: (unitId: string, contactId: string) => void;
  /** Drag over: the contacts whose supports the circle passed over (editing/screenBrush). */
  onPaint: (unitId: string, ids: readonly string[], mode: BrushMode) => void;
  /** Present only in zones mode: the zone brush (radius in mm). */
  zoneBrush?: { radius: number; kind: ZoneKind };
  /** How strongly the no-support zone layer shows on the active object. */
  showZones: 'off' | 'faint' | 'full';
  /** One finished zone stroke on a unit, stamps in unit-local space. */
  onZoneStroke: (unitId: string, stamps: ZoneStamp[]) => void;
  /** Support check findings to mark, positions in their unit's local frame. */
  problems: readonly (SupportProblem & { unitId: string })[];
  /** Check finding to frame (Show me): point in plate space, its area in mm²; a new `seq` repeats the move. */
  focus?: { point: Vector; area: number; seq: number };
  /** A new `seq` turns the camera to look straight up at the selection (or every object). */
  viewRequest?: ViewRequest;
  /** Show only the contact tips (the host decides: editing/view `tipsShown`). */
  tipsView: boolean;
  /** The camera went below the plate (or back above it). */
  onBelowPlate: (below: boolean) => void;
}

/** `bottom` looks straight up at the selection; `fit` frames it from the current angle. */
export interface ViewRequest { kind: 'bottom' | 'fit'; seq: number }
