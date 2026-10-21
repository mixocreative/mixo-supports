/**
 * Coordinate conventions every support-core module assumes. A host with other conventions
 * (Babylon.js is left-handed by default) converts at its boundary, never inside the core.
 */

/** World up axis: +Y. Build plate at y = 0, supports grow down from the model to it. */
export const UP = [0, 1, 0] as const;

/** Length unit for positions, radii, spacing and every distance setting. */
export const UNITS = 'mm';

/** Coordinate system handedness (x right, y up, z towards the viewer). */
export const HANDEDNESS = 'right';

/** Triangle winding: counter-clockwise seen from outside, so normals point outward. */
export const WINDING = 'ccw-outward';

/** Euler angle order for model rotations (radians), as three.js `Euler` 'XYZ'. */
export const EULER_ORDER = 'XYZ';
