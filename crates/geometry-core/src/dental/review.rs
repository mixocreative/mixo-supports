//! Review layers: the geometry of the diagnostic GLB, one layer per role with its colour, so the
//! Node review script (and any other host) only writes what Rust hands back. Colours follow the
//! contour spec (docs/superpowers/specs/2026-10-25-dental-contour-contacts.md, verification gates):
//! strong ridge blue, connectors green, central opening red, the contact strip teal, excluded
//! faces neutral, candidate bands in distinct colours, sampled contacts and final tips apart.
//! Review only: nothing here is support permission.

use super::mesh::{Mesh, cross, normalize, sub};

pub const TEAL: u32 = 0x1aa998;
pub const NEUTRAL: u32 = 0xeceae5;
pub const BLUE: u32 = 0x007ed3;
pub const GREEN: u32 = 0x16b34f;
pub const RED: u32 = 0xee1938;
pub const VIOLET: u32 = 0x8844cc;
pub const AMBER: u32 = 0xffa000;
pub const CYAN: u32 = 0x00c7dd;
pub const MAGENTA: u32 = 0xe33fa9;
pub const LIME: u32 = 0xb8f500;
pub const PINK: u32 = 0xff61b8;
pub const GOLD: u32 = 0xb99b59;
pub const ORANGE: u32 = 0xff7a1a;

const TUBE_RADIUS: f64 = 0.23;
const TUBE_SIDES: usize = 6;
const BAND_OFFSET: f64 = 0.08;
const MARKER_RADIUS: f64 = 0.35;
const MARKER_LIFT: f64 = 0.12;

/// One coloured layer: `indices` empty means a triangle soup in `positions`.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub name: &'static str,
    pub color: u32,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

/// Diagnostic strips of the two contours, in this order: outer opening side, outer other side,
/// inner opening side, inner other side.
pub type Bands<'a> = [&'a [u8]; 4];

pub struct SupportMesh<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
    /// One byte per support triangle: 1 for a final tip.
    pub tip_flags: &'a [u8],
}

pub struct ReviewInput<'a> {
    pub mesh: Mesh<'a>,
    pub contact_faces: &'a [u8],
    pub outer_ridge: &'a [u32],
    pub connectors: &'a [u32],
    pub opening: &'a [u32],
    pub bands: Option<Bands<'a>>,
    /// Sampled contacts, position then normal (6 numbers each).
    pub outer_contacts: &'a [f64],
    pub inner_contacts: &'a [f64],
    pub support: Option<SupportMesh<'a>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReviewError {
    ContactMaskMismatch,
    BandMismatch,
    SupportMismatch,
    EdgeOutOfRange,
}

fn faces_where(mesh: &Mesh, mask: &[u8], selected: bool) -> Vec<u32> {
    (0..mask.len()).filter(|&f| (mask[f] != 0) == selected).flat_map(|f| (0..3).map(move |c| mesh.corner(f, c))).collect()
}

/// The faces of `mask`, each pushed `offset` along its own normal, as a triangle soup.
fn offset_faces(mesh: &Mesh, mask: &[u8], offset: f64) -> Vec<f32> {
    let mut out = Vec::new();
    for face in (0..mask.len()).filter(|&f| mask[f] != 0) {
        let points = mesh.face_points(face);
        let normal = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
        for p in points {
            out.extend((0..3).map(|a| (p[a] + normal[a] * offset) as f32));
        }
    }
    out
}

/// Six-sided tube around every edge pair (vertex index pairs).
fn edge_tubes(mesh: &Mesh, pairs: &[u32], radius: f64) -> Result<(Vec<f32>, Vec<u32>), ReviewError> {
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for pair in pairs.chunks_exact(2) {
        if pair.iter().any(|&i| i as usize >= mesh.vertex_count()) {
            return Err(ReviewError::EdgeOutOfRange);
        }
        let (a, b) = (mesh.point(pair[0]), mesh.point(pair[1]));
        let axis = normalize(sub(b, a));
        if !axis[0].is_finite() || axis == [0.0; 3] {
            continue;
        }
        let reference = if axis[2].abs() < 0.9 { [0.0, 0.0, 1.0] } else { [0.0, 1.0, 0.0] };
        let u = normalize(cross(axis, reference));
        let v = normalize(cross(axis, u));
        let base = (positions.len() / 3) as u32;
        for centre in [a, b] {
            for side in 0..TUBE_SIDES {
                let angle = side as f64 * std::f64::consts::PI * 2.0 / TUBE_SIDES as f64;
                let (c, s) = (angle.cos() * radius, angle.sin() * radius);
                positions.extend((0..3).map(|k| (centre[k] + u[k] * c + v[k] * s) as f32));
            }
        }
        let n = TUBE_SIDES as u32;
        for side in 0..n {
            let next = (side + 1) % n;
            indices.extend([base + side, base + next, base + n + side, base + next, base + n + next, base + n + side]);
        }
    }
    Ok((positions, indices))
}

/// Octahedron marker per contact, lifted off the surface along its normal.
fn contact_markers(contacts: &[f64]) -> (Vec<f32>, Vec<u32>) {
    const DIRECTIONS: [[f64; 3]; 6] = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]];
    const TRIANGLES: [[u32; 3]; 8] = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for contact in contacts.chunks_exact(6) {
        let base = (positions.len() / 3) as u32;
        for d in DIRECTIONS {
            positions.extend((0..3).map(|a| (contact[a] + contact[3 + a] * MARKER_LIFT + d[a] * MARKER_RADIUS) as f32));
        }
        for t in TRIANGLES {
            indices.extend(t.map(|i| base + i));
        }
    }
    (positions, indices)
}

pub fn review_layers(input: &ReviewInput) -> Result<Vec<Layer>, ReviewError> {
    let mesh = input.mesh;
    if input.contact_faces.len() != mesh.face_count() {
        return Err(ReviewError::ContactMaskMismatch);
    }
    let shared = || mesh.positions.to_vec();
    let mut layers = vec![
        Layer { name: "TEAL current narrow contact mask", color: TEAL, positions: shared(), indices: faces_where(&mesh, input.contact_faces, true) },
        Layer { name: "NEUTRAL faces outside contact mask", color: NEUTRAL, positions: shared(), indices: faces_where(&mesh, input.contact_faces, false) },
    ];
    for (name, color, pairs) in [
        ("BLUE outer sharp-ridge contour", BLUE, input.outer_ridge),
        ("GREEN outer ridge connector paths", GREEN, input.connectors),
        ("RED central opening contour", RED, input.opening),
    ] {
        let (positions, indices) = edge_tubes(&mesh, pairs, TUBE_RADIUS)?;
        layers.push(Layer { name, color, positions, indices });
    }
    if let Some(bands) = input.bands {
        if bands.iter().any(|b| b.len() != mesh.face_count()) {
            return Err(ReviewError::BandMismatch);
        }
        for (name, color, band) in [
            ("VIOLET diagnostic outer opening-side strip", VIOLET, bands[0]),
            ("AMBER diagnostic outer other-side strip", AMBER, bands[1]),
            ("CYAN diagnostic inner opening-side strip", CYAN, bands[2]),
            ("MAGENTA diagnostic inner other-side strip", MAGENTA, bands[3]),
        ] {
            layers.push(Layer { name, color, positions: offset_faces(&mesh, band, BAND_OFFSET), indices: Vec::new() });
        }
    }
    for (name, color, contacts) in [
        ("LIME diagnostic outer sampled contacts NOT generated", LIME, input.outer_contacts),
        ("PINK diagnostic inner sampled contacts NOT generated", PINK, input.inner_contacts),
    ] {
        if contacts.is_empty() {
            continue;
        }
        let (positions, indices) = contact_markers(contacts);
        layers.push(Layer { name, color, positions, indices });
    }
    if let Some(support) = &input.support {
        if support.tip_flags.len() != support.indices.len() / 3 {
            return Err(ReviewError::SupportMismatch);
        }
        let pick = |tip: bool| -> Vec<u32> {
            support.tip_flags.iter().enumerate().filter(|(_, f)| (**f != 0) == tip).flat_map(|(t, _)| support.indices[t * 3..t * 3 + 3].to_vec()).collect()
        };
        layers.push(Layer { name: "GOLD app-generated support mesh", color: GOLD, positions: support.positions.to_vec(), indices: pick(false) });
        layers.push(Layer { name: "ORANGE final support tips", color: ORANGE, positions: support.positions.to_vec(), indices: pick(true) });
    }
    Ok(layers)
}

#[cfg(test)]
mod tests {
    use super::*;

    const POSITIONS: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
    const INDICES: [u32; 6] = [0, 1, 2, 2, 1, 3];

    fn input<'a>(mask: &'a [u8], support: Option<SupportMesh<'a>>) -> ReviewInput<'a> {
        ReviewInput {
            mesh: Mesh::new(&POSITIONS, &INDICES),
            contact_faces: mask,
            outer_ridge: &[0, 1],
            connectors: &[1, 2],
            opening: &[2, 3],
            bands: Some([&[1, 0], &[0, 1], &[1, 1], &[0, 0]]),
            outer_contacts: &[0.2, 0.2, 0.0, 0.0, 0.0, 1.0],
            inner_contacts: &[0.7, 0.7, 0.0, 0.0, 0.0, 1.0],
            support,
        }
    }

    #[test]
    fn every_role_has_its_contour_spec_colour() {
        let layers = review_layers(&input(&[1, 0], None)).unwrap();
        let colour = |prefix: &str| layers.iter().find(|l| l.name.starts_with(prefix)).unwrap().color;
        assert_eq!(colour("TEAL"), TEAL);
        assert_eq!(colour("NEUTRAL"), NEUTRAL);
        assert_eq!(colour("BLUE"), BLUE);
        assert_eq!(colour("GREEN"), GREEN);
        assert_eq!(colour("RED"), RED);
        assert_eq!(colour("VIOLET"), VIOLET);
        assert_eq!(colour("AMBER"), AMBER);
        assert_eq!(colour("CYAN"), CYAN);
        assert_eq!(colour("MAGENTA"), MAGENTA);
        assert_eq!(colour("LIME"), LIME);
        assert_eq!(colour("PINK"), PINK);
        let teal = layers.iter().find(|l| l.color == TEAL).unwrap();
        let neutral = layers.iter().find(|l| l.color == NEUTRAL).unwrap();
        assert_eq!(teal.indices, vec![0, 1, 2]);
        assert_eq!(neutral.indices, vec![2, 1, 3]);
    }

    #[test]
    fn tubes_are_closed_rings_and_markers_are_octahedra() {
        let layers = review_layers(&input(&[1, 0], None)).unwrap();
        let blue = layers.iter().find(|l| l.color == BLUE).unwrap();
        assert_eq!(blue.positions.len(), 12 * 3);
        assert_eq!(blue.indices.len(), 6 * 6);
        let lime = layers.iter().find(|l| l.color == LIME).unwrap();
        assert_eq!((lime.positions.len(), lime.indices.len()), (6 * 3, 8 * 3));
    }

    #[test]
    fn tips_are_a_separate_layer_from_the_rest_of_the_support_mesh() {
        let support = SupportMesh { positions: &POSITIONS, indices: &INDICES, tip_flags: &[1, 0] };
        let layers = review_layers(&input(&[1, 0], Some(support))).unwrap();
        let gold = layers.iter().find(|l| l.color == GOLD).unwrap();
        let orange = layers.iter().find(|l| l.color == ORANGE).unwrap();
        assert_eq!((gold.indices.clone(), orange.indices.clone()), (vec![2, 1, 3], vec![0, 1, 2]));
    }

    #[test]
    fn a_mask_that_does_not_fit_the_mesh_is_refused() {
        assert_eq!(review_layers(&input(&[1], None)).unwrap_err(), ReviewError::ContactMaskMismatch);
        let mut bad = input(&[1, 0], None);
        bad.opening = &[0, 9];
        assert_eq!(review_layers(&bad).unwrap_err(), ReviewError::EdgeOutOfRange);
    }
}
