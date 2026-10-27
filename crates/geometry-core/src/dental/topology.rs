//! Edge topology of a closed (two-manifold) aligner mesh in the rim frame: edges with their two
//! faces, sharp-edge selection, edge-graph components and weighted shortest routes.

use super::mesh::{Mesh, MinHeap, V3, cross, dot, normalize, sub};
use super::rim::Rim;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug)]
pub struct Edge {
    pub a: u32,
    pub b: u32,
    pub faces: [u32; 2],
    /// `min * vertexCount + max`: the oracle's edge order and identity.
    pub key: u64,
}

pub struct Context<'a> {
    pub mesh: &'a Mesh<'a>,
    pub rim: &'a Rim,
    pub vertices: Vec<V3>,
    pub projected: Vec<[f64; 2]>,
    pub normals: Vec<V3>,
    /// Edges in first-seen order.
    pub edges: Vec<Edge>,
    slot: HashMap<u64, usize>,
    pub extent: [f64; 2],
}

impl<'a> Context<'a> {
    /// `None` for a mesh that is not a closed two-manifold or has a degenerate face.
    pub fn build(mesh: &'a Mesh<'a>, rim: &'a Rim) -> Option<Self> {
        let count = mesh.vertex_count();
        let mut vertices = Vec::with_capacity(count);
        let mut projected = Vec::with_capacity(count);
        let (mut low, mut high) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for index in 0..count as u32 {
            let point = mesh.point(index);
            vertices.push(point);
            let delta = sub(point, rim.centroid);
            let uv = [dot(delta, rim.tangent), dot(delta, rim.bitangent)];
            projected.push(uv);
            for axis in 0..2 {
                low[axis] = low[axis].min(uv[axis]);
                high[axis] = high[axis].max(uv[axis]);
            }
        }
        let mut partial: Vec<(u32, u32, Vec<u32>)> = Vec::new();
        let mut slot: HashMap<u64, usize> = HashMap::new();
        let mut normals = Vec::with_capacity(mesh.face_count());
        let key_of = |a: u32, b: u32| u64::from(a.min(b)) * count as u64 + u64::from(a.max(b));
        for face in 0..mesh.face_count() {
            let ids = [mesh.corner(face, 0), mesh.corner(face, 1), mesh.corner(face, 2)];
            let [a, b, c] = ids.map(|i| vertices[i as usize]);
            let normal = normalize(cross(sub(b, a), sub(c, a)));
            if normal == [0.0; 3] {
                return None;
            }
            normals.push(normal);
            for corner in 0..3 {
                let (x, y) = (ids[corner], ids[(corner + 1) % 3]);
                let key = key_of(x, y);
                match slot.get(&key) {
                    Some(&at) => partial[at].2.push(face as u32),
                    None => {
                        slot.insert(key, partial.len());
                        partial.push((x.min(y), x.max(y), vec![face as u32]));
                    }
                }
            }
        }
        if partial.iter().any(|edge| edge.2.len() != 2) {
            return None;
        }
        let edges = partial.into_iter().map(|(a, b, f)| Edge { a, b, faces: [f[0], f[1]], key: key_of(a, b) }).collect();
        Some(Self { mesh, rim, vertices, projected, normals, edges, slot, extent: [high[0] - low[0], high[1] - low[1]] })
    }

    pub fn edge_between(&self, a: u32, b: u32) -> Option<usize> {
        let key = u64::from(a.min(b)) * self.vertices.len() as u64 + u64::from(a.max(b));
        self.slot.get(&key).copied()
    }

    /// Indices of edges whose faces meet at least `degrees` apart (|dot| <= cos).
    pub fn sharp_edges(&self, degrees: f64) -> Vec<usize> {
        let limit = (degrees * std::f64::consts::PI / 180.0).cos();
        (0..self.edges.len())
            .filter(|&i| dot(self.normals[self.edges[i].faces[0] as usize], self.normals[self.edges[i].faces[1] as usize]).abs() <= limit)
            .collect()
    }
}

/// A connected set of selected edges.
pub struct Component {
    pub edges: Vec<usize>,
    /// Visit order (stack pop), the oracle's `Set` insertion order.
    pub vertices: Vec<u32>,
    pub endpoints: Vec<u32>,
}

/// Connected components of the selected edges, largest first (stable for equal sizes).
pub fn components(context: &Context, selected: &[usize]) -> Vec<Component> {
    let mut graph: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut keys: Vec<u32> = Vec::new();
    for &edge in selected {
        for index in [context.edges[edge].a, context.edges[edge].b] {
            graph
                .entry(index)
                .or_insert_with(|| {
                    keys.push(index);
                    Vec::new()
                })
                .push(edge);
        }
    }
    let mut seen: HashSet<u32> = HashSet::new();
    let mut result: Vec<Component> = Vec::new();
    for &start in &keys {
        if seen.contains(&start) {
            continue;
        }
        let mut queue = vec![start];
        seen.insert(start);
        let mut vertices = Vec::new();
        let mut edges: Vec<usize> = Vec::new();
        let mut edge_seen: HashSet<usize> = HashSet::new();
        while let Some(current) = queue.pop() {
            vertices.push(current);
            for &edge in &graph[&current] {
                if edge_seen.insert(edge) {
                    edges.push(edge);
                }
                let e = &context.edges[edge];
                let next = if e.a == current { e.b } else { e.a };
                if seen.insert(next) {
                    queue.push(next);
                }
            }
        }
        let endpoints = vertices.iter().copied().filter(|v| graph[v].len() == 1).collect();
        result.push(Component { edges, vertices, endpoints });
    }
    result.sort_by(|a, b| b.edges.len().cmp(&a.edges.len()));
    result
}

pub struct Route {
    pub vertices: Vec<u32>,
    pub length: f64,
}

/// Dijkstra over an adjacency list with the oracle's heap, so equal-cost ties resolve the same way.
pub fn shortest_route(graph: &HashMap<u32, Vec<(u32, f64)>>, start: u32, end: u32) -> Option<Route> {
    let mut costs: HashMap<u32, f64> = HashMap::from([(start, 0.0)]);
    let mut prior: HashMap<u32, u32> = HashMap::new();
    let mut heap: MinHeap<u32> = MinHeap::new();
    heap.push(0.0, start);
    while let Some((cost, index)) = heap.pop() {
        if costs.get(&index) != Some(&cost) {
            continue;
        }
        if index == end {
            break;
        }
        for &(next, length) in graph.get(&index).map(|v| v.as_slice()).unwrap_or(&[]) {
            let next_cost = cost + length;
            if next_cost >= costs.get(&next).copied().unwrap_or(f64::INFINITY) {
                continue;
            }
            costs.insert(next, next_cost);
            prior.insert(next, index);
            heap.push(next_cost, next);
        }
    }
    let length = *costs.get(&end)?;
    let mut vertices = vec![end];
    while vertices.last() != Some(&start) {
        vertices.push(*prior.get(vertices.last()?)?);
    }
    vertices.reverse();
    Some(Route { vertices, length })
}
