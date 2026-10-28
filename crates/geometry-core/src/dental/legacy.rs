//! The legacy (non two-contour) dental placement: a policy without a recomputed contour strip, i.e.
//! an area the operator painted from scratch (`origin: manual-area`) or an older saved project.
//! A contact is permitted by the ordered brush stamps (else the rim footprint) and only where the
//! cavity opening sees the surface first. Allowed contacts of the generic placement are kept and
//! the allowed downward faces are filled at placement spacing. The area is data; nothing here
//! chooses a support structure (docs/SHIP-PLAN.md rule 1).

use super::mesh::Mesh;

use crate::core::vec::{V3, cross, dot, length, normalize, sub};
use super::rim::{BoundaryKind, Rim};
use crate::core::matrix::{Handedness, apply_to_direction, apply_to_point, invert_matrix, placement_matrix, transform_positions};
use crate::supports::overhang::{classify_downward_faces, face_overhang_limit};
use crate::supports::contact_id::position_id;
use crate::supports::policy::AreaStamp;
use std::collections::HashMap;

/// The permitted area of a legacy policy.
pub struct LegacyArea<'a> {
    pub rim: &'a Rim,
    /// An area painted from scratch: only the paint permits, and the rim footprint never does.
    pub manual_area: bool,
    pub stamps: &'a [AreaStamp],
}

/// Whether a unit-local point projects into the cavity visibility footprint.
pub fn rim_contains(rim: &Rim, point: V3) -> bool {
    let delta = sub(point, rim.centroid);
    let (u, v) = (dot(delta, rim.tangent), dot(delta, rim.bitangent));
    let width = rim.visibility_max[0] - rim.visibility_min[0];
    let height = rim.visibility_max[1] - rim.visibility_min[1];
    if !(width > 0.0) || !(height > 0.0) {
        return false;
    }
    let resolution = rim.visibility_resolution as f64;
    let x = (((u - rim.visibility_min[0]) / width) * resolution).floor();
    let y = (((v - rim.visibility_min[1]) / height) * resolution).floor();
    if !(x >= 0.0 && x < resolution && y >= 0.0 && y < resolution) {
        return false;
    }
    rim.visibility_mask.get(y as usize * rim.visibility_resolution + x as usize) == Some(&1)
}

/// Exact first-surface queries along the opening direction: the mesh stays transient, only the
/// footprint belongs in project state.
pub struct OpeningRaycaster<'a> {
    mesh: Mesh<'a>,
    rim: &'a Rim,
    cells: Vec<Vec<u32>>,
}

impl<'a> OpeningRaycaster<'a> {
    pub fn new(mesh: Mesh<'a>, rim: &'a Rim) -> Self {
        let resolution = rim.visibility_resolution;
        let mut cells: Vec<Vec<u32>> = vec![Vec::new(); resolution * resolution];
        let this = Self { mesh, rim, cells: Vec::new() };
        for face in 0..mesh.face_count() {
            let projected = mesh.face_points(face).map(|point| this.project(point));
            let xs = projected.map(|p| this.cell(p[0], 0));
            let ys = projected.map(|p| this.cell(p[1], 1));
            let low = |values: [f64; 3]| values.iter().cloned().fold(f64::INFINITY, f64::min).max(0.0);
            let high = |values: [f64; 3]| values.iter().cloned().fold(f64::NEG_INFINITY, f64::max).min(resolution as f64 - 1.0);
            let (min_x, max_x, min_y, max_y) = (low(xs), high(xs), low(ys), high(ys));
            if min_x > max_x || min_y > max_y || [min_x, max_x, min_y, max_y].iter().any(|v| v.is_nan()) {
                continue;
            }
            for y in min_y as usize..=max_y as usize {
                for x in min_x as usize..=max_x as usize {
                    cells[y * resolution + x].push(face as u32);
                }
            }
        }
        Self { cells, ..this }
    }

    /// True only when `point` is the first mesh surface hit from outside the accepted opening.
    pub fn visible(&self, point: V3) -> bool {
        if !rim_contains(self.rim, point) {
            return false;
        }
        let [u, v, depth] = self.project(point);
        let (x, y) = (self.cell(u, 0), self.cell(v, 1));
        let Some(faces) = self.cells.get(y as usize * self.rim.visibility_resolution + x as usize) else {
            return false;
        };
        if faces.is_empty() {
            return false;
        }
        let mut first_depth = f64::NEG_INFINITY;
        for &face in faces {
            let [a, b, c] = self.mesh.face_points(face as usize).map(|p| self.project(p));
            let denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
            if denominator.abs() < 1e-12 {
                continue;
            }
            let l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
            let l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
            let l3 = 1.0 - l1 - l2;
            if l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7 {
                continue;
            }
            first_depth = first_depth.max(l1 * a[2] + l2 * b[2] + l3 * c[2]);
        }
        first_depth.is_finite() && (depth - first_depth).abs() <= 1e-3
    }

    fn project(&self, point: V3) -> V3 {
        let delta = sub(point, self.rim.centroid);
        [dot(delta, self.rim.tangent), dot(delta, self.rim.bitangent), dot(delta, self.rim.opening_direction)]
    }

    fn cell(&self, value: f64, axis: usize) -> f64 {
        let min = self.rim.visibility_min[axis];
        let span = self.rim.visibility_max[axis] - min;
        (((value - min) / span) * self.rim.visibility_resolution as f64).floor()
    }
}

impl LegacyArea<'_> {
    /// The baseline footprint and the ordered edits, the last stamp that reaches the point wins.
    pub fn allowed_at(&self, point: V3, normal: Option<V3>) -> bool {
        for stamp in self.stamps.iter().rev() {
            let d = sub(point, stamp.center);
            if d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > stamp.radius * stamp.radius {
                continue;
            }
            if let Some(n) = normal
                && n[0] * stamp.normal[0] + n[1] * stamp.normal[1] + n[2] * stamp.normal[2] <= 0.0
            {
                continue;
            }
            return stamp.allow;
        }
        !self.manual_area && rim_contains(self.rim, point)
    }

    /// The final automatic-contact gate: approval never bypasses the cavity opening's view of the point.
    pub fn support_allowed_at(&self, opening: &OpeningRaycaster, point: V3, normal: Option<V3>) -> bool {
        (self.manual_area || self.rim.boundary_kind == BoundaryKind::LowerEdgeLoop) && self.allowed_at(point, normal) && opening.visible(point)
    }

    /// One byte per vertex of the allowed-area overlay (positions and normals in the unit frame).
    pub fn allowed_vertices(&self, mesh: Mesh, normals: &[f32]) -> Vec<u8> {
        let opening = OpeningRaycaster::new(mesh, self.rim);
        (0..mesh.vertex_count())
            .map(|vertex| {
                let point = mesh.point(vertex as u32);
                let at = vertex * 3;
                let normal = normals.get(at..at + 3).map(|n| [f64::from(n[0]), f64::from(n[1]), f64::from(n[2])]);
                u8::from(self.support_allowed_at(&opening, point, normal))
            })
            .collect()
    }
}

/// What the fill needs besides the area.
pub struct FillInput<'a> {
    pub mesh: Mesh<'a>,
    /// The unit orientation, Euler XYZ radians (no translation): contacts live in the turned frame.
    pub rotation: [f64; 3],
    pub spacing: f64,
    pub overhang_angle_degrees: f64,
    /// Generic automatic contacts in the turned frame (xyz triples), tried before the face fill.
    pub initial_positions: &'a [f64],
    pub initial_normals: &'a [f64],
}

/// The kept generic contacts (indices into the input, in order) then the contacts the fill added.
#[derive(Debug, Default)]
pub struct Fill {
    pub kept_initial: Vec<u32>,
    pub positions: Vec<f64>,
    pub normals: Vec<f64>,
    pub ids: Vec<String>,
}

struct Spacer {
    spacing: f64,
    radius2: f64,
    cells: HashMap<(i64, i64, i64), Vec<V3>>,
}

impl Spacer {
    fn cell(&self, p: V3) -> (i64, i64, i64) {
        let c = |v: f64| (v / self.spacing).floor() as i64;
        (c(p[0]), c(p[1]), c(p[2]))
    }
    /// Accepts the point unless one already accepted lies within the spacing.
    fn add(&mut self, point: V3) -> bool {
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
}

fn triple(values: &[f64], k: usize) -> V3 {
    [values[k * 3], values[k * 3 + 1], values[k * 3 + 2]]
}

/// Keeps the generic contacts the area permits, then fills the downward faces at `spacing`.
pub fn fill_legacy_dental(area: &LegacyArea, input: &FillInput) -> Fill {
    let mesh = input.mesh;
    let turn = placement_matrix([0.0; 3], input.rotation);
    let unturn = invert_matrix(&turn);
    let opening = OpeningRaycaster::new(mesh, area.rim);
    let mut spacer = Spacer { spacing: input.spacing, radius2: input.spacing * input.spacing, cells: HashMap::new() };
    let mut out = Fill::default();
    for k in 0..input.initial_positions.len() / 3 {
        let (position, normal) = (triple(input.initial_positions, k), triple(input.initial_normals, k));
        let local = apply_to_point(&unturn, position[0], position[1], position[2]);
        let local_normal = apply_to_direction(&unturn, normal[0], normal[1], normal[2]);
        if area.support_allowed_at(&opening, local, Some(local_normal)) && spacer.add(position) {
            out.kept_initial.push(k as u32);
        }
    }
    let turned = transform_positions(mesh.positions, &turn, Handedness::Right);
    let downward = classify_downward_faces(&turned, mesh.indices, face_overhang_limit(input.overhang_angle_degrees));
    for face in (0..mesh.face_count()).filter(|&f| downward[f]) {
        let [p0, p1, p2] = mesh.face_points(face);
        let normal = normalize(cross(sub(p1, p0), sub(p2, p0)));
        if !normal[0].is_finite() {
            continue;
        }
        let longest = length(sub(p1, p0)).max(length(sub(p2, p1))).max(length(sub(p0, p2)));
        let divisions = ((longest / input.spacing).ceil()).max(1.0) as usize;
        for row in 0..divisions {
            for column in 0..divisions - row {
                let b = (row as f64 + 1.0 / 3.0) / divisions as f64;
                let c = (column as f64 + 1.0 / 3.0) / divisions as f64;
                let a = 1.0 - b - c;
                let unit = [
                    a * p0[0] + b * p1[0] + c * p2[0],
                    a * p0[1] + b * p1[1] + c * p2[1],
                    a * p0[2] + b * p1[2] + c * p2[2],
                ];
                if !area.support_allowed_at(&opening, unit, Some(normal)) {
                    continue;
                }
                let position = apply_to_point(&turn, unit[0], unit[1], unit[2]);
                if !spacer.add(position) {
                    continue;
                }
                let turned_normal = apply_to_direction(&turn, normal[0], normal[1], normal[2]);
                out.ids.push(position_id(position));
                out.positions.extend(position);
                out.normals.extend(turned_normal);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A square plate of two triangles facing down with a matching rim footprint above it.
    fn plate() -> (Vec<f32>, Vec<u32>, Rim) {
        let positions = vec![0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 10.0, 10.0, 0.0, 10.0];
        let indices = vec![0, 1, 2, 2, 1, 3];
        // Opening direction -y (looking up at the underside), frame tangent x, bitangent z.
        let rim = Rim {
            boundary_kind: BoundaryKind::LowerEdgeLoop,
            points: Vec::new(),
            opening_direction: [0.0, -1.0, 0.0],
            centroid: [5.0, 0.0, 5.0],
            tangent: [1.0, 0.0, 0.0],
            bitangent: [0.0, 0.0, 1.0],
            visibility_mask: vec![1; 16],
            visibility_resolution: 4,
            visibility_min: [-6.0, -6.0],
            visibility_max: [6.0, 6.0],
        };
        (positions, indices, rim)
    }

    #[test]
    fn the_fill_stands_on_the_footprint_and_keeps_its_spacing() {
        let (positions, indices, rim) = plate();
        let area = LegacyArea { rim: &rim, manual_area: false, stamps: &[] };
        let input = FillInput { mesh: Mesh::new(&positions, &indices), rotation: [0.0; 3], spacing: 3.0, overhang_angle_degrees: 45.0, initial_positions: &[], initial_normals: &[] };
        let fill = fill_legacy_dental(&area, &input);
        assert!(!fill.ids.is_empty());
        let points: Vec<V3> = fill.positions.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
        for (i, a) in points.iter().enumerate() {
            for b in &points[i + 1..] {
                assert!(length(sub(*a, *b)) >= 3.0 - 1e-9);
            }
        }
    }

    #[test]
    fn a_manual_area_needs_paint_and_an_erase_stamp_removes_it_again() {
        let (positions, indices, rim) = plate();
        let mesh = Mesh::new(&positions, &indices);
        let input = |mesh| FillInput { mesh, rotation: [0.0; 3], spacing: 3.0, overhang_angle_degrees: 45.0, initial_positions: &[], initial_normals: &[] };
        let none = LegacyArea { rim: &rim, manual_area: true, stamps: &[] };
        assert!(fill_legacy_dental(&none, &input(mesh)).ids.is_empty());
        let paint = AreaStamp { center: [5.0, 0.0, 5.0], radius: 20.0, normal: [0.0, -1.0, 0.0], allow: true };
        let erase = AreaStamp { allow: false, ..paint };
        let painted = LegacyArea { rim: &rim, manual_area: true, stamps: &[paint] };
        assert!(!fill_legacy_dental(&painted, &input(mesh)).ids.is_empty());
        let erased = LegacyArea { rim: &rim, manual_area: true, stamps: &[paint, erase] };
        assert!(fill_legacy_dental(&erased, &input(mesh)).ids.is_empty());
    }

    #[test]
    fn a_projection_fallback_rim_never_authorises_a_detected_area() {
        let (positions, indices, mut rim) = plate();
        rim.boundary_kind = BoundaryKind::ProjectionFallback;
        let area = LegacyArea { rim: &rim, manual_area: false, stamps: &[] };
        let input = FillInput { mesh: Mesh::new(&positions, &indices), rotation: [0.0; 3], spacing: 3.0, overhang_angle_degrees: 45.0, initial_positions: &[], initial_normals: &[] };
        assert!(fill_legacy_dental(&area, &input).ids.is_empty());
    }

    #[test]
    fn a_covered_surface_is_not_visible_from_the_opening() {
        let (mut positions, mut indices, rim) = plate();
        // A second plate below the first (towards the opening): it hides the first.
        let base = (positions.len() / 3) as u32;
        positions.extend([0.0, -2.0, 0.0, 10.0, -2.0, 0.0, 0.0, -2.0, 10.0, 10.0, -2.0, 10.0]);
        indices.extend([base, base + 1, base + 2, base + 2, base + 1, base + 3]);
        let mesh = Mesh::new(&positions, &indices);
        let opening = OpeningRaycaster::new(mesh, &rim);
        assert!(opening.visible([5.0, -2.0, 5.0]));
        assert!(!opening.visible([5.0, 0.0, 5.0]));
    }
}
