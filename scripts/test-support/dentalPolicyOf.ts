import { withDentalMesh } from '../../src/core/analysis/dentalEngine';
import type { DentalPolicy } from '../../src/core/analysis/dentalPolicy';
import type { TriangleMesh } from '../../src/core/analysis/types';
import type { JobTransform } from '../../src/core/jobs';
import { makeDentalPolicy } from '../../src/dental/placement';

const still: JobTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };

/** What Rust `dental_policy` made of a saved policy, read back for assertions (the handle is freed). */
export function dentalPolicyOf(mesh: TriangleMesh, policy: DentalPolicy, frame: JobTransform = still) {
  return withDentalMesh(mesh, (session, model) => {
    const handle = makeDentalPolicy(session, model, policy, frame);
    try {
      const points = handle.candidate_points();
      const alternatePoints = handle.alternate_points();
      const point = (rows: Float64Array, k: number) => ({ position: [rows[k * 6]!, rows[k * 6 + 1]!, rows[k * 6 + 2]!], normal: [rows[k * 6 + 3]!, rows[k * 6 + 4]!, rows[k * 6 + 5]!] });
      return {
        reproduced: handle.reproduced(), profileId: handle.profile_id(),
        candidates: handle.candidate_ids().map((id, k) => ({ id, face: handle.candidate_faces()[k]!, ...point(points, k) })),
        alternates: handle.alternate_owners().map((owner, k) => ({ owner, face: handle.alternate_faces()[k]!, ...point(alternatePoints, k) })),
        structures: Array.from(handle.structures()), repairBudget: handle.repair_budget(), automatic: handle.automatic(),
        landingRule: handle.landing_rule(), islandsOutside: handle.islands_outside_permitted(),
        permittedFaces: handle.permitted_faces(), rings: handle.ring_count(),
      };
    } finally {
      handle.free();
    }
  });
}
