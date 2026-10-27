import { approxArray, exactArray } from './golden';

/*
 * The comparable shape of a support build, for the recorded builder goldens (SHIP-PLAN U9, rule 7):
 *   indices   exact (count + hash)
 *   positions strided sample, within tolerance
 *   tags      every discrete field (strings, integers, booleans, structure) exact as one hash + list length;
 *             the non-integer numbers (intent points, normals, reach) as a sample within tolerance
 *   dropped   exact lists of contact IDs
 */

export interface SnapshotInput {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  components: readonly unknown[];
  dropped: readonly string[];
  droppedByZones?: readonly string[];
  parts?: unknown;
}

export const stride = (count: number): number => Math.max(37, Math.ceil(count / 3000));

function split(value: unknown, floats: number[]): unknown {
  if (typeof value === 'number') {
    if (Math.abs(value - Math.round(value)) < 1e-9) return Math.round(value) + 0;
    floats.push(value);
    return '#';
  }
  if (Array.isArray(value)) return value.map((item) => split(item, floats));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined && key !== 'origin') out[key] = split(item, floats);
    }
    return out;
  }
  return value;
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function buildSnapshot(build: SnapshotInput) {
  const floats: number[] = [];
  const tags = build.components.map((component) => split(JSON.parse(JSON.stringify(component)), floats));
  return {
    indices: exactArray(build.indices),
    positions: approxArray(build.positions, stride(build.positions.length)),
    tags: { count: tags.length, hash: hashText(JSON.stringify(tags)) },
    tagFloats: approxArray(floats, stride(floats.length)),
    dropped: build.dropped,
    ...(build.droppedByZones ? { droppedByZones: build.droppedByZones } : {}),
    ...(build.parts !== undefined ? { parts: build.parts } : {}),
  };
}
