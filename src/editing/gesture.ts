import type { Brush } from './brushScheduler';
import { effectiveBrushMode } from './selection';
import type { EditSession } from './session';
import type { EditMode, ZoneKind } from './types';

/**
 * What a press or a drag on the canvas does now: nothing special outside the modes, the zone brush
 * while painting zones, and in Support Edit Mode one of its three ways of working (Add supports;
 * Select supports by Click, `pick`; Select supports by Drag over, `drag`, with the circle).
 */
export type Gesture =
  | { kind: 'none' }
  | { kind: 'zones'; brush: { radius: number; kind: ZoneKind } }
  /** `remove`: a click removes the support it hits instead of adding one. */
  | { kind: 'add'; remove: boolean }
  | { kind: 'pick' }
  /** `brush.mode` is what a stroke does now (Shift flips the switch); `sizing`: the circle's size slider is held or was just moved. */
  | { kind: 'drag'; brush: Brush; sizing: boolean };

export type GestureKind = Gesture['kind'];

export function gesture(session: EditSession): Gesture {
  switch (session.mode) {
    case 'off': return { kind: 'none' };
    case 'zones': return { kind: 'zones', brush: { radius: session.zoneRadius, kind: session.zoneKind } };
    case 'edit':
      if (session.tool === 'add') return { kind: 'add', remove: session.addAction === 'remove' };
      return session.selectStyle === 'click' ? { kind: 'pick' } : { kind: 'drag', brush: { radius: session.brushRadius, mode: effectiveBrushMode(session.brushMode, session.shiftHeld) }, sizing: session.brushSizing };
  }
}

/** The mode a gesture belongs to. */
export function gestureMode(gesture: Gesture): EditMode {
  return gesture.kind === 'none' ? 'off' : gesture.kind === 'zones' ? 'zones' : 'edit';
}
