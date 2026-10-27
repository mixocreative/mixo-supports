//! Cavity-opening detection: the opening axis (least-variance direction, terminal-area test) and
//! its trimmed rim. Port of the oracle's `proposeDentalOrientation`; thresholds come from the profile.

use super::mesh::{Mesh, V3, add, cross, dot, length, normalize, scale, sub, sum_points};
use super::profiles::AlignerProfile;
use super::rim::{Rim, trace_rim};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Diagnostics {
    pub confidence: f64,
    pub terminal_area_ratio: f64,
    pub axial_variance_ratio: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    InvalidMesh,
    NoCavity,
    AmbiguousCavity,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidMesh => "invalid-mesh",
            Self::NoCavity => "no-cavity",
            Self::AmbiguousCavity => "ambiguous-cavity",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Proposal {
    Proposal { rim: Rim, diagnostics: Diagnostics },
    Inconclusive { reason: Reason, diagnostics: Diagnostics },
}

const ZERO: Diagnostics = Diagnostics { confidence: 0.0, terminal_area_ratio: 0.0, axial_variance_ratio: 0.0 };

/// Finds a candidate cavity opening from a thick shell. Geometry is in the mesh's own frame.
pub fn propose_orientation(mesh: &Mesh, profile: &AlignerProfile) -> Proposal {
    if !mesh.is_valid() {
        return Proposal::Inconclusive { reason: Reason::InvalidMesh, diagnostics: ZERO };
    }
    let t = &profile.thresholds;
    let vertices: Vec<V3> = (0..mesh.vertex_count() as u32).map(|i| mesh.point(i)).collect();
    let (centre, axis, axial_variance_ratio) = least_variance_axis(&vertices);
    if axial_variance_ratio > t.axial_variance_max {
        return Proposal::Inconclusive { reason: Reason::NoCavity, diagnostics: Diagnostics { axial_variance_ratio, ..ZERO } };
    }
    let (negative, positive) = terminal_areas(mesh, &vertices, axis, centre, t.terminal_band_fraction);
    let total = negative + positive;
    let terminal_area_ratio = if total == 0.0 { 0.0 } else { (positive - negative).abs() / total };
    if terminal_area_ratio < t.terminal_area_ratio_min {
        return Proposal::Inconclusive {
            reason: Reason::AmbiguousCavity,
            diagnostics: Diagnostics { confidence: terminal_area_ratio, terminal_area_ratio, axial_variance_ratio },
        };
    }
    // A cavity mouth has less terminal material than its closed floor.
    let opening_direction = scale(axis, if positive < negative { 1.0 } else { -1.0 });
    let Some(rim) = trace_rim(mesh, &vertices, centre, opening_direction, profile) else {
        return Proposal::Inconclusive {
            reason: Reason::NoCavity,
            diagnostics: Diagnostics { confidence: terminal_area_ratio, terminal_area_ratio, axial_variance_ratio },
        };
    };
    let confidence = terminal_area_ratio * (1.0 - axial_variance_ratio);
    let diagnostics = Diagnostics { confidence, terminal_area_ratio, axial_variance_ratio };
    if confidence < t.confidence_min {
        return Proposal::Inconclusive { reason: Reason::NoCavity, diagnostics };
    }
    Proposal::Proposal { rim, diagnostics }
}

fn least_variance_axis(vertices: &[V3]) -> (V3, V3, f64) {
    let centre = scale(sum_points(vertices.iter().copied()), 1.0 / vertices.len() as f64);
    let mut covariance = [[0.0f64; 3]; 3];
    for point in vertices {
        let delta = sub(*point, centre);
        for (row, line) in covariance.iter_mut().enumerate() {
            for (column, cell) in line.iter_mut().enumerate() {
                *cell += delta[row] * delta[column];
            }
        }
    }
    let (values, vectors) = symmetric_eigen(covariance);
    let minimum = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let index = values.iter().position(|&v| v == minimum).unwrap_or(0);
    let maximum = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let ratio = if maximum == 0.0 { 1.0 } else { values[index] / maximum };
    (centre, normalize(vectors[index]), ratio)
}

fn terminal_areas(mesh: &Mesh, vertices: &[V3], axis: V3, centre: V3, band_fraction: f64) -> (f64, f64) {
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for point in vertices {
        let value = dot(sub(*point, centre), axis);
        minimum = minimum.min(value);
        maximum = maximum.max(value);
    }
    let band = (maximum - minimum) * band_fraction;
    let (mut negative, mut positive) = (0.0, 0.0);
    for face in 0..mesh.face_count() {
        let [a, b, c] = mesh.face_points(face);
        let centroid = scale(add(add(add([0.0; 3], a), b), c), 1.0 / 3.0);
        let projection = dot(sub(centroid, centre), axis);
        let area = length(cross(sub(b, a), sub(c, a))) / 2.0;
        if projection <= minimum + band {
            negative += area;
        }
        if projection >= maximum - band {
            positive += area;
        }
    }
    (negative, positive)
}

/// Jacobi diagonalisation for a real symmetric 3x3 matrix (same sweep rule as the oracle).
fn symmetric_eigen(matrix: [[f64; 3]; 3]) -> ([f64; 3], [V3; 3]) {
    let mut a = matrix;
    let mut v = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..16 {
        let (mut row, mut column) = (0usize, 1usize);
        if a[0][2].abs() > a[row][column].abs() {
            (row, column) = (0, 2);
        }
        if a[1][2].abs() > a[row][column].abs() {
            (row, column) = (1, 2);
        }
        if a[row][column].abs() < 1e-10 {
            break;
        }
        let angle = 0.5 * (2.0 * a[row][column]).atan2(a[column][column] - a[row][row]);
        let (cosine, sine) = (angle.cos(), angle.sin());
        for index in 0..3 {
            let (left, right) = (a[index][row], a[index][column]);
            a[index][row] = cosine * left - sine * right;
            a[index][column] = sine * left + cosine * right;
        }
        for index in 0..3 {
            let (left, right) = (a[row][index], a[column][index]);
            a[row][index] = cosine * left - sine * right;
            a[column][index] = sine * left + cosine * right;
            let (vector_left, vector_right) = (v[index][row], v[index][column]);
            v[index][row] = cosine * vector_left - sine * vector_right;
            v[index][column] = sine * vector_left + cosine * vector_right;
        }
    }
    ([a[0][0], a[1][1], a[2][2]], [[v[0][0], v[1][0], v[2][0]], [v[0][1], v[1][1], v[2][1]], [v[0][2], v[1][2], v[2][2]]])
}
