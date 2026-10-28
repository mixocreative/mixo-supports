/** Must equal the Rust `engine_version()`; both change together on any ABI change. */
export const HOST_GEOMETRY_VERSION = 8;

export class GeometryVersionMismatch extends Error {
  readonly code = 'geometry-version-mismatch';

  constructor(readonly actual: number) {
    super(`Geometry core schema ${actual} does not match host schema ${HOST_GEOMETRY_VERSION}`);
    this.name = 'GeometryVersionMismatch';
  }
}

export function assertGeometryVersion(actual: number): void {
  if (actual !== HOST_GEOMETRY_VERSION) throw new GeometryVersionMismatch(actual);
}

export async function runAfterGeometryReady<T>(
  ready: () => Promise<unknown>,
  work: () => T | Promise<T>,
): Promise<T> {
  await ready();
  return work();
}
