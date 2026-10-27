import type { SupportProblem } from '../core/analysis/supportCheck';
import type { IslandReport } from '../core/supports/mesh';

/**
 * The island part of the support check, from the `generate` island verdict (Rust, built-path
 * graph; SHIP-PLAN D1 replaced the old distance heuristic with it):
 *   - `unresolved` islands are listed at their lowest vertex of `positions` (the unit's mesh, the one
 *     `generate` was given; the vertex index is into it);
 *   - `resolved` ones, and ones resolved only through a manual support, are not problems;
 *   - an `inconclusive` verdict is one `unjudged` entry: no island is called resolved, and the list says so;
 *   - no verdict (the build is not current) lists nothing; the re-check that follows the build asks again.
 */
export function islandProblems(report: IslandReport | undefined, positions: Float32Array): SupportProblem[] {
  if (!report) return [];
  if (report.status === 'inconclusive') return [{ kind: 'unjudged', position: [0, 0, 0], area: 0 }];
  return report.islands.flatMap((island): SupportProblem[] => {
    if (island.status !== 'unresolved') return [];
    const o = island.vertex * 3;
    return o + 2 < positions.length ? [{ kind: 'island', position: [positions[o]!, positions[o + 1]!, positions[o + 2]!], area: 0 }] : [];
  });
}
