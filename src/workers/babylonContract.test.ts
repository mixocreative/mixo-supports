import { describe, expect, it } from 'vitest';
import { fromLeftHanded, fromLeftHandedMatrix, toLeftHanded, toLeftHandedMatrix } from '../core/handedness';
import { placementMatrix, transformPositions } from '../core/transform';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { supportedUnit } from '../goldens/pipeline';
import { runSupportJob } from '../supports/jobRunner';
import { generationTransform, supportJobOf } from '../supports/unitSupports';

/*
 * Babylon contract smoke (U8). A left-handed host (Babylon with its default `useRightHandedSystem =
 * false`) mirrors Z once at the boundary and keeps the triangle order (core/handedness.ts). This
 * drives the whole result path as such a host would: the model and the unit's placement live in the
 * host's frame, cross back to the core frame, `generate` runs, and the supports return mirrored.
 * Babylon itself is not loaded; the contract is the arithmetic and the winding it relies on.
 */

const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const minus = (a: ArrayLike<number>, at: number, b: ArrayLike<number>, bt: number) => [a[at]! - b[bt]!, a[at + 1]! - b[bt + 1]!, a[at + 2]! - b[bt + 2]!];

for (const name of ['cube-overhang', 'knot']) {
  describe(`left-handed host contract: ${name}`, () => {
    const fixture = GOLDEN_FIXTURES.find((entry) => entry.name === name)!;
    const unit = supportedUnit(fixture, 'default');
    const frame = placementMatrix(generationTransform(unit));

    it('the host frame crosses the boundary exactly and generate returns the same result', () => {
      const job = supportJobOf(unit, 0, 'export');
      const direct = runSupportJob(job, undefined, 1);
      // The host holds the mirrored model and the conjugated placement ...
      const hostModel = toLeftHanded(unit.source);
      const hostFrame = toLeftHandedMatrix(frame);
      // ... and converts both back at the boundary: sign flips only, so exactly.
      const model = fromLeftHanded(hostModel);
      expect(model.positions).toEqual(unit.source.positions);
      expect(Array.from(fromLeftHandedMatrix(hostFrame))).toEqual(Array.from(frame));
      const viaHost = runSupportJob({ ...job, mesh: model }, undefined, 1);
      expect(viaHost.indices).toEqual(direct.indices);
      expect(viaHost.positions).toEqual(direct.positions);
      expect(viaHost.components.map((c) => [c.part, c.contactId])).toEqual(direct.components.map((c) => [c.part, c.contactId]));
      expect(viaHost.verdict?.status).toBe(direct.verdict?.status);
      expect(viaHost.dropped).toEqual(direct.dropped);
    }, 60_000);

    it('the supports come back mirrored: same triangle order, the plate-space positions are the mirror, normals stay outward', () => {
      const result = runSupportJob(supportJobOf(unit, 0, 'export'), undefined, 1);
      const hostSupports = toLeftHanded(result);
      expect(hostSupports.indices).toBe(result.indices);
      // Through the host's conjugated placement equals the mirror of the core's plate-space mesh.
      const plate = transformPositions(result.positions, frame);
      const hostPlate = transformPositions(hostSupports.positions, toLeftHandedMatrix(frame));
      const mirrored = toLeftHanded({ positions: plate, indices: result.indices }).positions;
      let worst = 0;
      for (let k = 0; k < mirrored.length; k += 1) worst = Math.max(worst, Math.abs(mirrored[k]! - hostPlate[k]!));
      expect(worst).toBeLessThan(1e-4);
      // Babylon's normal (a - b) x (c - b) on the mirrored triangle is the mirror of the core's outward one.
      let checked = 0;
      for (let t = 0; t < result.indices.length && checked < 400; t += 3 * 17, checked += 1) {
        const [a, b, c] = [result.indices[t]! * 3, result.indices[t + 1]! * 3, result.indices[t + 2]! * 3];
        const core = cross(minus(result.positions, b, result.positions, a), minus(result.positions, c, result.positions, a));
        const host = cross(minus(hostSupports.positions, a, hostSupports.positions, b), minus(hostSupports.positions, c, hostSupports.positions, b));
        expect(host[0]).toBeCloseTo(core[0]!, 4);
        expect(host[1]).toBeCloseTo(core[1]!, 4);
        expect(host[2]).toBeCloseTo(-core[2]!, 4);
      }
      expect(checked).toBeGreaterThan(0);
    }, 60_000);
  });
}
