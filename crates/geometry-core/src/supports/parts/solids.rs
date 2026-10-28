//! Raft, roof and label solids on the mesh builder (port of the TS `MeshBuilder` methods
//! `prism`, `strip`, `extrudeGlyph`, `sweep`, `closedTube`, with the ear-clipped caps).

use super::builder::MeshBuilder;
use super::profile::{P2, basis, circle_ring};
use crate::core::vec::{V3, add, cross, dot, normalize_or_down, scale, sub};
use std::collections::HashMap;

/// Ear clipping of a simple polygon (either orientation); index triples in the polygon's orientation.
pub fn ear_clip(polygon: &[P2]) -> Vec<[usize; 3]> {
    let n = polygon.len();
    let signed: f64 = (0..n)
        .map(|i| {
            let (p, q) = (polygon[i], polygon[(i + 1) % n]);
            p[0] * q[1] - q[0] * p[1]
        })
        .sum();
    let orientation = if signed < 0.0 { -1.0 } else { 1.0 };
    let mut remaining: Vec<usize> = (0..n).collect();
    let mut triangles = Vec::new();
    let cross2 = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut guard = 0;
    while remaining.len() > 3 && guard < n * n {
        guard += 1;
        let mut clipped = false;
        for k in 0..remaining.len() {
            let len = remaining.len();
            let (ia, ib, ic) = (remaining[(k + len - 1) % len], remaining[k], remaining[(k + 1) % len]);
            let (a, b, c) = (polygon[ia], polygon[ib], polygon[ic]);
            if cross2(a, b, c) * orientation <= 1e-12 {
                continue;
            }
            let contains = remaining.iter().any(|&other| {
                if other == ia || other == ib || other == ic {
                    return false;
                }
                let p = polygon[other];
                cross2(a, b, p) * orientation >= 0.0 && cross2(b, c, p) * orientation >= 0.0 && cross2(c, a, p) * orientation >= 0.0
            });
            if contains {
                continue;
            }
            triangles.push([ia, ib, ic]);
            remaining.remove(k);
            clipped = true;
            break;
        }
        if !clipped {
            break;
        }
    }
    if remaining.len() == 3 {
        triangles.push([remaining[0], remaining[1], remaining[2]]);
    } else {
        for k in 1..remaining.len().saturating_sub(1) {
            triangles.push([remaining[0], remaining[k], remaining[k + 1]]);
        }
    }
    triangles
}

impl MeshBuilder {
    fn ids(&mut self, points: &[V3]) -> Vec<u32> {
        points.iter().map(|&p| self.vertex(p)).collect()
    }

    /// Closed prism between two rings of equal count, with ear-clipped (possibly concave) caps.
    pub fn prism(&mut self, bottom: &[V3], top: &[V3]) {
        let b = self.ids(bottom);
        let t = self.ids(top);
        let count = b.len();
        for step in 0..count {
            let next = (step + 1) % count;
            self.indices.extend([b[step], b[next], t[next], b[step], t[next], t[step]]);
        }
        let plan: Vec<P2> = bottom.iter().map(|p| [p[0], p[2]]).collect();
        for [a, c, d] in ear_clip(&plan) {
            self.indices.extend([b[a], b[d], b[c]]);
            self.indices.extend([t[a], t[c], t[d]]);
        }
    }

    /// Closed solid over a run of corners: bottom and top strips joined by outer, inner and end walls.
    pub fn strip(&mut self, outer_bottom: &[V3], inner_bottom: &[V3], outer_top: &[V3], inner_top: &[V3]) {
        let ob = self.ids(outer_bottom);
        let ib = self.ids(inner_bottom);
        let ot = self.ids(outer_top);
        let it = self.ids(inner_top);
        for k in 0..ob.len() - 1 {
            self.indices.extend([ob[k], ib[k], ib[k + 1], ob[k], ib[k + 1], ob[k + 1]]);
            self.indices.extend([ot[k], ot[k + 1], it[k + 1], ot[k], it[k + 1], it[k]]);
            self.indices.extend([ob[k], ob[k + 1], ot[k + 1], ob[k], ot[k + 1], ot[k]]);
            self.indices.extend([ib[k], it[k], it[k + 1], ib[k], it[k + 1], ib[k + 1]]);
        }
        let last = ob.len() - 1;
        self.indices.extend([ob[0], ot[0], it[0], ob[0], it[0], ib[0]]);
        self.indices.extend([ob[last], ib[last], it[last], ob[last], it[last], ot[last]]);
    }

    /// Closed solid from a triangulated glyph: bottom and top copies joined along boundary edges.
    pub fn extrude_glyph(&mut self, bottom: &[V3], top: &[V3], triangles: &[[u32; 3]]) {
        let b = self.ids(bottom);
        let t = self.ids(top);
        let key = |p: u32, q: u32| if p < q { (p, q) } else { (q, p) };
        let mut uses: HashMap<(u32, u32), u32> = HashMap::new();
        for &[i, j, k] in triangles {
            self.indices.extend([t[i as usize], t[j as usize], t[k as usize]]);
            self.indices.extend([b[i as usize], b[k as usize], b[j as usize]]);
            for (p, q) in [(i, j), (j, k), (k, i)] {
                *uses.entry(key(p, q)).or_insert(0) += 1;
            }
        }
        for &[i, j, k] in triangles {
            for (p, q) in [(i, j), (j, k), (k, i)] {
                if uses[&key(p, q)] != 1 {
                    continue;
                }
                let (p, q) = (p as usize, q as usize);
                self.indices.extend([t[q], t[p], b[p], t[q], b[p], b[q]]);
            }
        }
    }

    /// Planar polygon extruded along `offset` (closed solid, ear-clipped caps in the polygon's plane).
    pub fn sweep(&mut self, polygon: &[V3], offset: V3) {
        let bottom = self.ids(polygon);
        let lifted: Vec<V3> = polygon.iter().map(|&p| add(p, offset)).collect();
        let top = self.ids(&lifted);
        let count = polygon.len();
        for step in 0..count {
            let next = (step + 1) % count;
            self.indices.extend([bottom[step], bottom[next], top[next], bottom[step], top[next], top[step]]);
        }
        let mut normal = [0.0; 3];
        for (i, point) in polygon.iter().enumerate() {
            let next = polygon[(i + 1) % count];
            normal = add(normal, [
                (point[1] - next[1]) * (point[2] + next[2]),
                (point[2] - next[2]) * (point[0] + next[0]),
                (point[0] - next[0]) * (point[1] + next[1]),
            ]);
        }
        let (u, v) = basis(normalize_or_down(normal));
        let plane: Vec<P2> = polygon.iter().map(|&p| [dot(p, u), dot(p, v)]).collect();
        for [a, c, d] in ear_clip(&plane) {
            self.indices.extend([bottom[a], bottom[d], bottom[c]]);
            self.indices.extend([top[a], top[c], top[d]]);
        }
    }

    /// Closed tube following a closed polyline (Curve to Mesh of a cyclic curve with a circle profile).
    pub fn closed_tube(&mut self, points: &[V3], radius: f64, segments: usize) {
        let count = points.len();
        let mut normal = basis(normalize_or_down(sub(points[1], points[0]))).0;
        let mut rings: Vec<Vec<V3>> = Vec::with_capacity(count);
        for (index, &point) in points.iter().enumerate() {
            let back = normalize_or_down(sub(point, points[(index + count - 1) % count]));
            let ahead = normalize_or_down(sub(points[(index + 1) % count], point));
            let tangent = normalize_or_down(add(back, ahead));
            normal = normalize_or_down(sub(normal, scale(tangent, dot(normal, tangent))));
            let binormal = cross(tangent, normal);
            rings.push(circle_ring(point, normal, binormal, radius, segments));
        }
        self.loft(&rings, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::parts::tags::{Part, Tag};

    #[test]
    fn ear_clip_triangulates_a_concave_polygon_into_n_minus_2_triangles() {
        let l: Vec<P2> = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 1.0], [1.0, 1.0], [1.0, 4.0], [0.0, 4.0]];
        let tris = ear_clip(&l);
        assert_eq!(tris.len(), 4);
        let area: f64 = tris
            .iter()
            .map(|t| {
                let (a, b, c) = (l[t[0]], l[t[1]], l[t[2]]);
                ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs() / 2.0
            })
            .sum();
        assert!((area - 7.0).abs() < 1e-9);
    }

    #[test]
    fn prism_of_a_square_is_a_closed_solid() {
        let ring = |y: f64| vec![[0.0, y, 0.0], [2.0, y, 0.0], [2.0, y, 2.0], [0.0, y, 2.0]];
        let mut builder = MeshBuilder::new();
        builder.begin(Tag::new(Part::Raft));
        builder.prism(&ring(0.0), &ring(1.0));
        builder.end();
        let mesh = builder.finish();
        assert_eq!(mesh.components.len(), 1);
        assert_eq!(mesh.indices.len() / 3, 12);
    }
}
