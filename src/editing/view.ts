type Vector = [number, number, number];

/** Viewing direction used when the camera sits on its target (the app's start view). */
const START_DIRECTION: Vector = [70, 60, 90];
/** Smallest horizontal share of the direction, so the orbit's up axis (+Y) stays defined. */
const MIN_HORIZONTAL = 1e-3;

/**
 * Unit direction from the framed centre to the camera for Fit view: the current one (target to
 * camera), the start view when there is none, and a hair off vertical when it looks straight
 * down or up, with the front of the plate at the bottom (as Bottom view does).
 */
export function fitDirection(direction: Vector): Vector {
  let [x, y, z] = direction;
  let length = Math.hypot(x, y, z);
  if (!(length > 0) || !Number.isFinite(length)) {
    [x, y, z] = START_DIRECTION;
    length = Math.hypot(x, y, z);
  }
  if (Math.hypot(x, z) < length * MIN_HORIZONTAL) {
    x = 0;
    z = Math.abs(y) * MIN_HORIZONTAL;
    length = Math.hypot(y, z);
  }
  return [x / length, y / length, z / length];
}
