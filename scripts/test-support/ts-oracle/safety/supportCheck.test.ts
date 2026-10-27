import { describe, expect, it } from 'vitest';
import { checkSupports } from './supportCheck';
import type { TriangleMesh } from '../../../../src/core/analysis/types';

type Vector = [number, number, number];

/** A size³ box with its underside at y = bottom, the bottom face split into a fine grid. */
function box(size: number, bottom: number, grid = 10): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const h = size / 2;
  const add = (p: Vector) => (positions.push(...p), positions.length / 3 - 1);
  // Bottom grid (normal down).
  const id: number[][] = [];
  for (let i = 0; i <= grid; i += 1) {
    id.push([]);
    for (let j = 0; j <= grid; j += 1) id[i]!.push(add([-h + size * i / grid, bottom, -h + size * j / grid]));
  }
  for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
    const [a, b, c, d] = [id[i]![j]!, id[i + 1]![j]!, id[i + 1]![j + 1]!, id[i]![j + 1]!];
    indices.push(a, b, c, a, c, d);
  }
  // Top and sides from the bottom corners.
  const corners = [id[0]![0]!, id[grid]![0]!, id[grid]![grid]!, id[0]![grid]!];
  const top = corners.map((c) => add([positions[c * 3]!, bottom + size, positions[c * 3 + 2]!]));
  indices.push(top[0]!, top[2]!, top[1]!, top[0]!, top[3]!, top[2]!);
  for (let k = 0; k < 4; k += 1) {
    const [a, b] = [corners[k]!, corners[(k + 1) % 4]!];
    const [c, d] = [top[(k + 1) % 4]!, top[k]!];
    indices.push(a, d, c, a, c, b);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const settings = { overhangAngleDegrees: 45, spacing: 2 };

describe('support check', () => {
  it('reports the whole underside of an unsupported box', () => {
    const problems = checkSupports(box(10, 5), [], settings);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.kind === 'island')).toBe(true);
    const area = problems.reduce((sum, problem) => sum + problem.area, 0);
    expect(area).toBeGreaterThan(80);
    problems.forEach((problem) => expect(problem.position[1]).toBeCloseTo(5, 5));
  });

  it('finds nothing when contacts cover the underside', () => {
    const contacts: Vector[] = [];
    for (let x = -4; x <= 4; x += 2) for (let z = -4; z <= 4; z += 2) contacts.push([x, 5, z]);
    const progress: number[] = [];
    expect(checkSupports(box(10, 5), contacts, settings, (fraction) => progress.push(fraction))).toEqual([]);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('points at the uncovered corner when one contact is missing', () => {
    const contacts: Vector[] = [];
    for (let x = -4; x <= 4; x += 2) for (let z = -4; z <= 4; z += 2) if (x < 2 || z < 2) contacts.push([x, 5, z]);
    const problems = checkSupports(box(10, 5), contacts, settings);
    expect(problems.length).toBeGreaterThan(0);
    problems.forEach((problem) => {
      expect(problem.position[0]).toBeGreaterThan(2);
      expect(problem.position[2]).toBeGreaterThan(2);
    });
  });

  it('flags a lone downward point as an island even with the faces around it covered', () => {
    // A box whose bottom grid has one vertex pushed 1 mm down: a local lowest point.
    const mesh = box(10, 5);
    const centre = 5 * 11 + 5;
    mesh.positions[centre * 3 + 1] = 4;
    const contacts: Vector[] = [];
    for (let x = -4; x <= 4; x += 2) for (let z = -4; z <= 4; z += 2) if (Math.hypot(x, z) > 3) contacts.push([x, 5, z]);
    const islands = checkSupports(mesh, contacts, settings).filter((problem) => problem.kind === 'island');
    expect(islands).toHaveLength(1);
    expect(islands[0]!.position).toEqual([0, 4, 0]);
  });
});
