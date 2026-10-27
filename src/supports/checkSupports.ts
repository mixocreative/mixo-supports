import type { SupportProblem, CheckSettings } from '../core/analysis/supportCheck';
import type { TriangleMesh } from '../core/analysis/types';
import type { Vector } from '../core/vec3';
import { supportEngine } from './supportEngine';

/*
 * Host adapter of the Rust support check (`crates/geometry-core/src/supports/check`): what the
 * contacts leave unsupported, in the frame of the checked mesh (Y up). The overhang-coverage part is
 * a non-gating warning of the generic policy (SHIP-PLAN D1); the gating island answer is the
 * `generate` verdict. Arrays in once, arrays out once; no geometry here.
 */
export function checkSupportProblems(mesh: TriangleMesh, contacts: readonly Vector[], settings: CheckSettings): SupportProblem[] {
  const result = supportEngine().check_support_problems(mesh.positions, mesh.indices, Float64Array.from(contacts.flat()), settings.overhangAngleDegrees, settings.spacing);
  try {
    const kinds = result.take_kinds();
    const positions = result.take_positions();
    const areas = result.take_areas();
    return Array.from(kinds, (kind, k): SupportProblem => ({
      kind: kind === 0 ? 'island' : 'overhang',
      position: [positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!],
      area: areas[k]!,
    }));
  } finally {
    result.free();
  }
}
