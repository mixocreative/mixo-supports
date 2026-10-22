import type { Brush, BrushScheduler } from './brushScheduler';
import type { Stroke } from './stroke';
import type { Point } from './strokeQueue';

/** A pointer move: whether the left button is held and whether the pointer is over the canvas. */
export interface PointerState {
  held: boolean;
  onCanvas: boolean;
}

/**
 * Drag over's pointer rules (framework-free): what a press, a move and a leave mean for the stroke
 * and the frame loop. The host turns its events into canvas points, passes the brush as it is now,
 * and shows the circle where these say it shows.
 */
export interface DragOver {
  /** A press: the left button starts a stroke (`onStrokeStart`) sampled first at `at`. False for other buttons. */
  down(button: number, at: Point, brush: Brush): boolean;
  /**
   * A move: samples the stroke while the left button is held, otherwise previews a hover. False
   * when the pointer is off the canvas outside a stroke: the hover is cleared and the circle hides.
   * A stroke keeps going off the canvas.
   */
  move(at: Point, pointer: PointerState, brush: Brush): boolean;
  /** The pointer left the canvas: outside a stroke the hover is cleared. True when the circle hides. */
  leave(): boolean;
}

export function createDragOver(stroke: Stroke, scheduler: BrushScheduler, onStrokeStart: () => void): DragOver {
  return {
    down(button, at, brush) {
      if (!stroke.begin(button)) return false;
      onStrokeStart();
      scheduler.press();
      scheduler.sample(at, brush);
      return true;
    },
    move(at, { held, onCanvas }, brush) {
      if (!onCanvas && !stroke.active) {
        scheduler.clearHover();
        return false;
      }
      const state = stroke.move(held);
      if (state === 'sample') scheduler.sample(at, brush);
      else if (state === 'idle') scheduler.hover(at, brush);
      return true;
    },
    leave() {
      if (stroke.active) return false;
      scheduler.clearHover();
      return true;
    },
  };
}
