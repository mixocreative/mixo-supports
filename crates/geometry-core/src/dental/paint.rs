//! The operator's paint: which faces the ordered brush stamps paint (last stamp wins), and the
//! suggested tips of a two-contour area (`fill_candidates`: every face reachable from below, which
//! paint reveals). The legacy area (`legacy::fill_legacy_dental`) shares the face sampling: points on
//! each face at the contact spacing, greedily kept `spacing` apart in 3D. Data only; the engine
//! checks every contact.

use super::mesh::Mesh;
use super::sampling::ContourContact;
use crate::core::vec::{V3, add, cross, dot, length, normalize, scale, sub};
use crate::supports::policy::AreaStamp;
use std::collections::HashMap;

/// Keeps accepted points at least `spacing` apart (3D), on a hash grid of `spacing` cells.
pub struct Spacer {
    spacing: f64,
    radius2: f64,
    cells: HashMap<(i64, i64, i64), Vec<V3>>,
}

impl Spacer {
    pub fn new(spacing: f64) -> Self {
        Self { spacing, radius2: spacing * spacing, cells: HashMap::new() }
    }

    fn cell(&self, p: V3) -> (i64, i64, i64) {
        let c = |v: f64| (v / self.spacing).floor() as i64;
        (c(p[0]), c(p[1]), c(p[2]))
    }

    /// Accepts the point unless one already accepted lies within the spacing.
    pub fn add(&mut self, point: V3) -> bool {
        let at = self.cell(point);
        for x in at.0 - 1..=at.0 + 1 {
            for y in at.1 - 1..=at.1 + 1 {
                for z in at.2 - 1..=at.2 + 1 {
                    for prior in self.cells.get(&(x, y, z)).into_iter().flatten() {
                        let (dx, dy, dz) = (point[0] - prior[0], point[1] - prior[1], point[2] - prior[2]);
                        if dx * dx + dy * dy + dz * dz < self.radius2 {
                            return false;
                        }
                    }
                }
            }
        }
        self.cells.entry(at).or_default().push(point);
        true
    }

    /// Records a point that must be kept clear of without testing it (an existing contact).
    pub fn seed(&mut self, point: V3) {
        let at = self.cell(point);
        self.cells.entry(at).or_default().push(point);
    }
}

/// Points spread over one triangle at about `spacing`: a barycentric grid with `ceil(longest edge /
/// spacing)` divisions (one point, the centroid, on a face smaller than the spacing).
pub fn face_samples([p0, p1, p2]: [V3; 3], spacing: f64) -> Vec<V3> {
    let longest = length(sub(p1, p0)).max(length(sub(p2, p1))).max(length(sub(p0, p2)));
    let divisions = ((longest / spacing).ceil()).max(1.0) as usize;
    let mut points = Vec::new();
    for row in 0..divisions {
        for column in 0..divisions - row {
            let b = (row as f64 + 1.0 / 3.0) / divisions as f64;
            let c = (column as f64 + 1.0 / 3.0) / divisions as f64;
            let a = 1.0 - b - c;
            points.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1], a * p0[2] + b * p1[2] + c * p2[2]]);
        }
    }
    points
}

/// Faces an ordered stroke list paints: a stamp reaches a face when its centroid is inside the
/// sphere and the face normal points the same way as the stamp normal (a thin wall never paints
/// its far side).
pub fn faces_painted_by_stamps(mesh: &Mesh, stamps: &[AreaStamp]) -> Vec<u32> {
    if !stamps.iter().any(|s| s.allow) {
        return Vec::new();
    }
    // Faces outside every stamp's box are reached by none: skip them without the stamp walk.
    let margin = 1e-9;
    let low: V3 = std::array::from_fn(|axis| stamps.iter().map(|s| s.center[axis] - s.radius).fold(f64::INFINITY, f64::min) - margin);
    let high: V3 = std::array::from_fn(|axis| stamps.iter().map(|s| s.center[axis] + s.radius).fold(f64::NEG_INFINITY, f64::max) + margin);
    let mut painted = Vec::new();
    for face in 0..mesh.face_count() {
        let [a, b, c] = mesh.face_points(face);
        let centroid = scale(add(add(add([0.0; 3], a), b), c), 1.0 / 3.0);
        if (0..3).any(|axis| centroid[axis] < low[axis] || centroid[axis] > high[axis]) {
            continue;
        }
        let normal = normalize(cross(sub(b, a), sub(c, a)));
        if AreaStamp::resolve(stamps, centroid, Some(normal)) == Some(true) {
            painted.push(face as u32);
        }
    }
    painted
}

/// The suggested tips of a two-contour area (docs/ROADMAP.md B2): every face a support reaches from
/// below (its normal at least `tip_min_from_up_deg` from `up`, the plate normal in the mesh frame) is
/// sampled with [`face_samples`] at `spacing`, the points kept `spacing` apart (3D, [`Spacer`]), in
/// face-index order. Index K in the list is the candidate `dental-fill-K`; which of them the policy
/// offers is decided per run (`policy::contacts_of`). Unit-local.
pub fn fill_candidates(mesh: &Mesh, up: V3, spacing: f64, tip_min_from_up_deg: f64) -> Vec<ContourContact> {
    let size = length(up);
    if !size.is_finite() || size < 1e-12 || !spacing.is_finite() || spacing <= 0.0 {
        return Vec::new();
    }
    let up = scale(up, 1.0 / size);
    let max_up = tip_min_from_up_deg.to_radians().cos();
    let mut spacer = Spacer::new(spacing);
    let mut contacts = Vec::new();
    for face in 0..mesh.face_count() {
        let points = mesh.face_points(face);
        let normal = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
        if !normal.iter().all(|v| v.is_finite()) || dot(normal, up) > max_up {
            continue;
        }
        for point in face_samples(points, spacing) {
            if spacer.add(point) {
                contacts.push(ContourContact { face: face as u32, position: point, normal, distance_along_contour: 0.0, distance_from_contour: 0.0 });
            }
        }
    }
    contacts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 10 x 10 mm plate at y = 0 split into 0.5 mm cells, normals down (-y).
    fn plate() -> (Vec<f32>, Vec<u32>) {
        let n = 21u32;
        let positions = (0..n).flat_map(|j| (0..n).flat_map(move |i| [i as f32 * 0.5, 0.0, j as f32 * 0.5])).collect();
        let id = |i: u32, j: u32| j * n + i;
        let indices = (0..n - 1).flat_map(|j| (0..n - 1).flat_map(move |i| [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)])).collect();
        (positions, indices)
    }

    #[test]
    fn suggested_tips_cover_every_face_reached_from_below_at_the_spacing_in_face_order() {
        let (positions, indices) = plate();
        let mesh = Mesh::new(&positions, &indices);
        // The plate's normals point down (-y): with the plate normal +y every face is reached from below.
        let all = fill_candidates(&mesh, [0.0, 1.0, 0.0], 1.5, 110.0);
        assert!(all.len() > 20);
        for (at, a) in all.iter().enumerate() {
            for b in &all[at + 1..] {
                assert!(length(sub(a.position, b.position)) >= 1.5 - 1e-9);
            }
        }
        assert!(all.windows(2).all(|w| w[0].face <= w[1].face), "face-index order");
        assert_eq!(fill_candidates(&mesh, [0.0, 7.0, 0.0], 1.5, 110.0), all, "up is a direction");
        // Turned over (plate normal -y) the faces look up: no tip.
        assert!(fill_candidates(&mesh, [0.0, -1.0, 0.0], 1.5, 110.0).is_empty());
        // Tilted 30 degrees the faces are 150 degrees from up: still reached; a 160-degree rule refuses them.
        let tilted = [0.5, 3f64.sqrt() / 2.0, 0.0];
        assert_eq!(fill_candidates(&mesh, tilted, 1.5, 110.0).len(), all.len());
        assert!(fill_candidates(&mesh, tilted, 1.5, 160.0).is_empty());
    }
}
