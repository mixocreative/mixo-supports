import { describe, expect, it } from 'vitest';
import { assertGeometryVersion, HOST_GEOMETRY_VERSION, runAfterGeometryReady } from './geometryVersion';

describe('geometry WASM contract', () => {
  it('accepts the matching core schema', () => {
    expect(() => assertGeometryVersion(HOST_GEOMETRY_VERSION)).not.toThrow();
  });

  it('rejects a mismatched core before work can start', () => {
    expect(() => assertGeometryVersion(HOST_GEOMETRY_VERSION + 1)).toThrowError(
      'Geometry core schema 8 does not match host schema 7',
    );
  });

  it('does not start a mesh job after initialization rejects', async () => {
    let started = false;
    const mismatch = new Error('Geometry core schema mismatch');
    await expect(runAfterGeometryReady(
      async () => { throw mismatch; },
      () => { started = true; },
    )).rejects.toBe(mismatch);
    expect(started).toBe(false);
  });
});
