//! Triangle accumulator for support components (port of TS `MeshBuilder`, the solids columns
//! need: lofts, frustums, tubes, spheres). Raft/roof/label solids join in U4c.

use super::curve::CurveNode;
use super::profile::{P2, basis, circle_ring};
use super::tags::{Component, Tag};
use crate::core::vec::{V3, add, cross, dot, length, normalize_or_down, scale, sub};
use std::f64::consts::PI;

/// Shorter than this (mm), a segment or axis counts as zero length.
pub const MIN_LENGTH: f64 = 1e-4;

#[derive(Default)]
pub struct MeshBuilder {
    pub(super) positions: Vec<f64>,
    pub(super) indices: Vec<u32>,
    components: Vec<Component>,
    current: Option<(Tag, u32)>,
}

pub struct BuiltMesh {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub components: Vec<Component>,
}

impl MeshBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin(&mut self, tag: Tag) {
        self.current = Some((tag, self.indices.len() as u32));
    }

    /// Closes the component. An empty one is dropped; one with negative volume is flipped outward.
    pub fn end(&mut self) {
        let (tag, start) = self.current.take().expect("end without begin");
        let count = self.indices.len() as u32 - start;
        if count == 0 {
            return;
        }
        if self.signed_volume(start, count) < 0.0 {
            let mut offset = start as usize;
            while offset < (start + count) as usize {
                self.indices.swap(offset + 1, offset + 2);
                offset += 3;
            }
        }
        self.components.push(Component { tag, start, count });
    }

    /// Vertices emitted so far: the start of what `raise_from` moves.
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Moves every vertex from `start` on up by `dy` (the plate height of a plate-relative part built
    /// at 0). Nothing changes at 0, so a build on the plate frame keeps its exact bits.
    pub fn raise_from(&mut self, start: usize, dy: f64) {
        if dy == 0.0 {
            return;
        }
        for y in self.positions.iter_mut().skip(start * 3 + 1).step_by(3) {
            *y += dy;
        }
    }

    pub fn finish(self) -> BuiltMesh {
        BuiltMesh {
            positions: self.positions.iter().map(|&v| v as f32).collect(),
            indices: self.indices,
            components: self.components,
        }
    }

    /// Truncated cone between two centres with flat caps.
    pub fn frustum(&mut self, from: V3, to: V3, from_radius: f64, to_radius: f64, segments: usize) {
        let axis = sub(to, from);
        if length(axis) < MIN_LENGTH {
            return;
        }
        let (u, v) = basis(normalize_or_down(axis));
        self.loft(&[circle_ring(from, u, v, from_radius, segments), circle_ring(to, u, v, to_radius, segments)], true);
    }

    /// Closed tube through a polyline with per-node radius (Blender Curve to Tube, flat caps).
    /// `profile` (unit radius, normal / binormal plane) replaces the round cross-section.
    pub fn tube(&mut self, nodes: &[CurveNode], segments: usize, profile: Option<&[P2]>) {
        let path: Vec<&CurveNode> = nodes
            .iter()
            .enumerate()
            .filter(|(index, node)| *index == 0 || length(sub(node.point, nodes[index - 1].point)) > MIN_LENGTH)
            .map(|(_, node)| node)
            .collect();
        if path.len() < 2 {
            return;
        }
        let mut normal = basis(normalize_or_down(sub(path[1].point, path[0].point))).0;
        let mut rings = Vec::with_capacity(path.len());
        for (index, node) in path.iter().enumerate() {
            let back = (index > 0).then(|| normalize_or_down(sub(node.point, path[index - 1].point)));
            let ahead = (index < path.len() - 1).then(|| normalize_or_down(sub(path[index + 1].point, node.point)));
            let tangent = normalize_or_down(match (back, ahead) {
                (Some(b), Some(a)) => add(b, a),
                (Some(b), None) => b,
                (None, Some(a)) => a,
                (None, None) => unreachable!("path has two nodes"),
            });
            // Parallel transport keeps the profile from twisting along the curve.
            normal = normalize_or_down(sub(normal, scale(tangent, dot(normal, tangent))));
            let binormal = cross(tangent, normal);
            rings.push(match profile {
                Some(profile) => profile
                    .iter()
                    .map(|&[a, b]| add(node.point, add(scale(normal, a * node.radius), scale(binormal, b * node.radius))))
                    .collect(),
                None => circle_ring(node.point, normal, binormal, node.radius, segments),
            });
        }
        self.loft(&rings, true);
    }

    pub fn sphere(&mut self, center: V3, radius: f64, segments: usize) {
        let rings = 2.max((segments as f64 / 2.0).round() as usize);
        let top = self.vertex([center[0], center[1] + radius, center[2]]);
        let bottom = self.vertex([center[0], center[1] - radius, center[2]]);
        let mut layers: Vec<Vec<u32>> = Vec::new();
        for layer in 1..rings {
            let polar = (layer as f64 / rings as f64) * PI;
            let ids: Vec<u32> = (0..segments)
                .map(|step| {
                    let azimuth = (step as f64 / segments as f64) * PI * 2.0;
                    self.vertex([
                        center[0] + polar.sin() * azimuth.cos() * radius,
                        center[1] + polar.cos() * radius,
                        center[2] + polar.sin() * azimuth.sin() * radius,
                    ])
                })
                .collect();
            layers.push(ids);
        }
        for step in 0..segments {
            let next = (step + 1) % segments;
            self.indices.extend([top, layers[0][next], layers[0][step]]);
            for layer in 0..layers.len() - 1 {
                let (upper, lower) = (&layers[layer], &layers[layer + 1]);
                self.indices.extend([upper[step], upper[next], lower[next], upper[step], lower[next], lower[step]]);
            }
            let last = &layers[layers.len() - 1];
            self.indices.extend([bottom, last[step], last[next]]);
        }
    }

    /// Joins rings of equal vertex count. `capped` closes the first and last ring with fans;
    /// otherwise the last ring wraps to the first, forming a closed band (a torus topology).
    pub fn loft(&mut self, rings: &[Vec<V3>], capped: bool) {
        let ids: Vec<Vec<u32>> = rings.iter().map(|ring| ring.iter().map(|&p| self.vertex(p)).collect()).collect();
        let count = ids[0].len();
        let bands = if capped { ids.len() - 1 } else { ids.len() };
        for band in 0..bands {
            let (lower, upper) = (&ids[band], &ids[(band + 1) % ids.len()]);
            for step in 0..count {
                let next = (step + 1) % count;
                self.indices.extend([lower[step], lower[next], upper[next], lower[step], upper[next], upper[step]]);
            }
        }
        if !capped {
            return;
        }
        let (first, last) = (&ids[0], &ids[ids.len() - 1]);
        let first_center = self.vertex(centroid(&rings[0]));
        let last_center = self.vertex(centroid(&rings[rings.len() - 1]));
        for step in 0..count {
            let next = (step + 1) % count;
            self.indices.extend([first_center, first[next], first[step]]);
            self.indices.extend([last_center, last[step], last[next]]);
        }
    }

    pub(super) fn vertex(&mut self, point: V3) -> u32 {
        self.positions.extend(point);
        (self.positions.len() / 3 - 1) as u32
    }

    fn signed_volume(&self, start: u32, count: u32) -> f64 {
        let p = |index: u32| {
            let i = index as usize * 3;
            [self.positions[i], self.positions[i + 1], self.positions[i + 2]]
        };
        let mut volume = 0.0;
        let mut offset = start as usize;
        while offset < (start + count) as usize {
            volume += dot(p(self.indices[offset]), cross(p(self.indices[offset + 1]), p(self.indices[offset + 2])));
            offset += 3;
        }
        volume
    }
}

pub(super) fn centroid(points: &[V3]) -> V3 {
    let sum = points.iter().fold([0.0; 3], |total, &point| add(total, point));
    scale(sum, 1.0 / points.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::parts::tags::Part;

    fn volume_of(mesh: &BuiltMesh) -> f64 {
        mesh.indices
            .chunks(3)
            .map(|t| {
                let p = |i: u32| {
                    let i = i as usize * 3;
                    [f64::from(mesh.positions[i]), f64::from(mesh.positions[i + 1]), f64::from(mesh.positions[i + 2])]
                };
                dot(p(t[0]), cross(p(t[1]), p(t[2]))) / 6.0
            })
            .sum()
    }

    #[test]
    fn tube_is_closed_outward_and_has_the_expected_volume() {
        let mut builder = MeshBuilder::new();
        builder.begin(Tag::new(Part::Pillar));
        let nodes = [CurveNode { point: [0.0, 0.0, 0.0], radius: 1.0 }, CurveNode { point: [0.0, 10.0, 0.0], radius: 1.0 }];
        builder.tube(&nodes, 64, None);
        builder.end();
        let mesh = builder.finish();
        assert_eq!(mesh.components.len(), 1);
        assert!((volume_of(&mesh) - PI * 10.0).abs() < 0.2);
    }

    #[test]
    fn zero_length_frustum_and_short_tube_emit_nothing() {
        let mut builder = MeshBuilder::new();
        builder.begin(Tag::new(Part::Foot));
        builder.frustum([0.0; 3], [0.0, 1e-5, 0.0], 1.0, 1.0, 8);
        builder.end();
        builder.begin(Tag::new(Part::Neck));
        builder.tube(&[CurveNode { point: [0.0; 3], radius: 1.0 }], 8, None);
        builder.end();
        assert!(builder.finish().components.is_empty());
    }

    #[test]
    fn sphere_volume_is_positive() {
        let mut builder = MeshBuilder::new();
        builder.begin(Tag::new(Part::Tip));
        builder.sphere([0.0; 3], 1.0, 24);
        builder.end();
        assert!(volume_of(&builder.finish()) > 3.5);
    }
}
