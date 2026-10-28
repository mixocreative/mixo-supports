//! The operator's paint: which faces the ordered brush stamps paint (last stamp wins), and the
//! contacts that fill painted faces. One fill serves the two-contour area (paint outside the detected
//! strip) and the legacy area (`legacy::fill_legacy_dental`): points on each face at the contact
//! spacing, greedily kept `spacing` apart in 3D. Data only; the engine checks every contact.

use super::mesh::Mesh;
use super::sampling::ContourContact;
use crate::core::matrix::{Matrix4, apply_to_direction};
use crate::core::vec::{V3, add, cross, length, normalize, scale, sub};
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

/// What the paint fill of a two-contour area needs.
pub struct PaintFill<'a> {
    pub mesh: &'a Mesh<'a>,
    /// Unit-local stamps, in stroke order.
    pub stamps: &'a [AreaStamp],
    /// The faces painted by `stamps` (`faces_painted_by_stamps`).
    pub painted: &'a [u32],
    /// Faces already covered by the contour sampling (the strip): not filled again.
    pub skip: &'a [u8],
    /// Unit-local to the output frame: a filled face must face down there.
    pub frame: &'a Matrix4,
    pub spacing: f64,
    /// Accepted contacts (unit-local) the fill keeps `spacing` clear of.
    pub keep_clear_of: &'a [V3],
}

/// Contacts on the painted faces outside the strip that face down in the output frame, each at
/// least `spacing` (3D) from the others and from `keep_clear_of`, in face order. Unit-local.
pub fn paint_contacts(fill: &PaintFill) -> Vec<ContourContact> {
    let mut spacer = Spacer::new(fill.spacing);
    for &point in fill.keep_clear_of {
        spacer.seed(point);
    }
    let mut contacts = Vec::new();
    for &face in fill.painted {
        if fill.skip.get(face as usize) == Some(&1) {
            continue;
        }
        let points = fill.mesh.face_points(face as usize);
        let normal = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
        if !normal[0].is_finite() || apply_to_direction(fill.frame, normal[0], normal[1], normal[2])[1] >= -1e-6 {
            continue;
        }
        for point in face_samples(points, fill.spacing) {
            if AreaStamp::resolve(fill.stamps, point, Some(normal)) == Some(true) && spacer.add(point) {
                contacts.push(ContourContact { face, position: point, normal, distance_along_contour: 0.0, distance_from_contour: 0.0 });
            }
        }
    }
    contacts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::matrix::placement_matrix;

    /// A 10 x 10 mm plate at y = 0 split into 0.5 mm cells, normals down (-y).
    fn plate() -> (Vec<f32>, Vec<u32>) {
        let n = 21u32;
        let positions = (0..n).flat_map(|j| (0..n).flat_map(move |i| [i as f32 * 0.5, 0.0, j as f32 * 0.5])).collect();
        let id = |i: u32, j: u32| j * n + i;
        let indices = (0..n - 1).flat_map(|j| (0..n - 1).flat_map(move |i| [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)])).collect();
        (positions, indices)
    }

    #[test]
    fn the_fill_covers_the_paint_at_the_spacing_and_keeps_clear_of_given_contacts() {
        let (positions, indices) = plate();
        let mesh = Mesh::new(&positions, &indices);
        let down = [0.0, -1.0, 0.0];
        let paint = AreaStamp { center: [5.0, 0.0, 5.0], radius: 3.0, normal: down, allow: true };
        let painted = faces_painted_by_stamps(&mesh, &[paint]);
        assert!(!painted.is_empty());
        let frame = placement_matrix([0.0; 3], [0.0; 3]);
        let skip = vec![0u8; mesh.face_count()];
        let keep = [[5.0, 0.0, 5.0]];
        let fill = PaintFill { mesh: &mesh, stamps: &[paint], painted: &painted, skip: &skip, frame: &frame, spacing: 1.5, keep_clear_of: &keep };
        let contacts = paint_contacts(&fill);
        assert!(contacts.len() > 4);
        let points: Vec<V3> = contacts.iter().map(|c| c.position).chain(keep).collect();
        for (at, a) in points.iter().enumerate() {
            for b in &points[at + 1..] {
                assert!(length(sub(*a, *b)) >= 1.5 - 1e-9);
            }
        }
        assert!(contacts.iter().all(|c| length(sub(c.position, paint.center)) <= 3.0 + 0.5));
        // An erase stamp after the paint removes it; a face that faces up in the frame gets nothing.
        let erase = AreaStamp { allow: false, ..paint };
        assert!(faces_painted_by_stamps(&mesh, &[paint, erase]).is_empty());
        let flipped = placement_matrix([0.0; 3], [std::f64::consts::PI, 0.0, 0.0]);
        assert!(paint_contacts(&PaintFill { frame: &flipped, ..fill }).is_empty());
    }
}
