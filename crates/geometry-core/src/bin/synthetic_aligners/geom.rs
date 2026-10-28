//! Shared geometry: vectors, the indexed solid, vertex normals, the pose and binary STL I/O.

use crate::rng::SplitMix64;
use mixo_geometry_core::core::stl::BinaryStlStream;

pub type V3 = [f64; 3];

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(v: V3, s: f64) -> V3 {
    [v[0] * s, v[1] * s, v[2] * s]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn length(v: V3) -> f64 {
    dot(v, v).sqrt()
}
pub fn unit(v: V3) -> V3 {
    let size = length(v);
    if size == 0.0 { [0.0; 3] } else { scale(v, 1.0 / size) }
}

/// What a triangle belongs to (used by the unit tests' dihedral and volume checks).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Label {
    /// Fitting surface (tooth-facing).
    F,
    /// Outer surface.
    G,
    CutWall,
    RoundWall,
    /// Mode C: the reference's triangles (no F/G split).
    Shell,
}

#[derive(Clone)]
pub struct Solid {
    pub positions: Vec<V3>,
    pub triangles: Vec<[u32; 3]>,
    pub labels: Vec<Label>,
}

impl Solid {
    pub fn point(&self, index: u32) -> V3 {
        self.positions[index as usize]
    }
}

/// Area-weighted vertex normals of the given triangles (unit; zero where no triangle touches).
pub fn vertex_normals(positions: &[V3], triangles: &[[u32; 3]]) -> Vec<V3> {
    let mut normals = vec![[0.0; 3]; positions.len()];
    for t in triangles {
        let [a, b, c] = t.map(|i| positions[i as usize]);
        let n = cross(sub(b, a), sub(c, a));
        for &v in t {
            normals[v as usize] = add(normals[v as usize], n);
        }
    }
    normals.into_iter().map(unit).collect()
}

#[cfg(test)]
pub fn triangle_area(positions: &[V3], t: [u32; 3]) -> f64 {
    let [a, b, c] = t.map(|i| positions[i as usize]);
    length(cross(sub(b, a), sub(c, a))) / 2.0
}

#[cfg(test)]
/// Copied from `supports/parts/builder.rs` (`signed_volume`, private there), divided by 6 so it
/// is a volume in mm³.
pub fn signed_volume(positions: &[V3], triangles: &[[u32; 3]]) -> f64 {
    let mut volume = 0.0;
    for t in triangles {
        let [a, b, c] = t.map(|i| positions[i as usize]);
        volume += dot(a, cross(b, c));
    }
    volume / 6.0
}

/// Rigid pose: p' = R p + t.
#[derive(Clone, Copy, Debug)]
pub struct Pose {
    pub rotation: [[f64; 3]; 3],
    pub translation: V3,
}

impl Pose {
    /// Axis uniform on the sphere (two draws), angle uniform 0–360° (one draw), translation
    /// uniform ± 50 mm per axis (three draws).
    pub fn draw(rng: &mut SplitMix64) -> Self {
        let z = rng.symmetric();
        let phi = 2.0 * std::f64::consts::PI * rng.uniform();
        let ring = (1.0 - z * z).max(0.0).sqrt();
        let axis = [ring * phi.cos(), ring * phi.sin(), z];
        let angle = 2.0 * std::f64::consts::PI * rng.uniform();
        let translation = [rng.symmetric() * 50.0, rng.symmetric() * 50.0, rng.symmetric() * 50.0];
        Self { rotation: rodrigues(axis, angle), translation }
    }

    pub fn direction(&self, d: V3) -> V3 {
        let r = &self.rotation;
        [dot(r[0], d), dot(r[1], d), dot(r[2], d)]
    }

    pub fn point(&self, p: V3) -> V3 {
        add(self.direction(p), self.translation)
    }

    /// Row-major 4 × 4.
    pub fn matrix(&self) -> [f64; 16] {
        let r = &self.rotation;
        let t = self.translation;
        [r[0][0], r[0][1], r[0][2], t[0], r[1][0], r[1][1], r[1][2], t[1], r[2][0], r[2][1], r[2][2], t[2], 0.0, 0.0, 0.0, 1.0]
    }

    pub fn apply(&self, solid: &mut Solid) {
        for p in &mut solid.positions {
            *p = self.point(*p);
        }
    }
}

fn rodrigues(axis: V3, angle: f64) -> [[f64; 3]; 3] {
    let (s, c) = angle.sin_cos();
    let k = 1.0 - c;
    let [x, y, z] = axis;
    [
        [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
        [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
        [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
    ]
}

/// Binary STL: 80-byte header, u32 count, 50-byte records (normal, three vertices, u16 0).
pub fn stl_bytes(header: &str, solid: &Solid) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(84 + 50 * solid.triangles.len());
    let mut head = [0u8; 80];
    for (slot, byte) in head.iter_mut().zip(header.bytes()) {
        *slot = byte;
    }
    bytes.extend_from_slice(&head);
    bytes.extend_from_slice(&(solid.triangles.len() as u32).to_le_bytes());
    for t in &solid.triangles {
        let corners = t.map(|i| solid.positions[i as usize].map(|c| c as f32));
        let wide = corners.map(|p| p.map(f64::from));
        let normal = unit(cross(sub(wide[1], wide[0]), sub(wide[2], wide[0])));
        for c in normal {
            bytes.extend_from_slice(&(c as f32).to_le_bytes());
        }
        for p in corners {
            for c in p {
                bytes.extend_from_slice(&c.to_le_bytes());
            }
        }
        bytes.extend_from_slice(&0u16.to_le_bytes());
    }
    bytes
}

/// Welded positions (as f32) and triangles, as `BinaryStlStream` reads them (reader frame, Y up).
pub fn read_stl(bytes: &[u8]) -> Result<(Vec<f32>, Vec<u32>), String> {
    if bytes.len() < 84 {
        return Err("STL shorter than its header".into());
    }
    let count = u32::from_le_bytes(bytes[80..84].try_into().unwrap());
    let mut stream = BinaryStlStream::new(count).map_err(|e| format!("{e:?}"))?;
    stream.push(bytes).map_err(|e| format!("{e:?}"))?;
    let mesh = stream.finish().map_err(|e| format!("{e:?}"))?;
    Ok((mesh.positions, mesh.indices))
}

/// Undo the reader's −90° turn about X as an exact permutation: (x, y, z) → (x, −z, y).
pub fn undo_reader_rotation(positions: &mut [f32]) {
    for p in positions.chunks_exact_mut(3) {
        let (y, z) = (p[1], p[2]);
        p[1] = -z;
        p[2] = y;
    }
}

/// The same permutation on a direction (the reader frame → the file frame, +90° about X).
pub fn reader_to_file(d: V3) -> V3 {
    [d[0], -d[2], d[1]]
}

pub fn to_solid(positions: &[f32], indices: &[u32], label: Label) -> Solid {
    Solid {
        positions: positions.chunks_exact(3).map(|p| [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])]).collect(),
        triangles: indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect(),
        labels: vec![label; indices.len() / 3],
    }
}
