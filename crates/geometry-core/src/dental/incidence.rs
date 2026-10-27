//! Topology evidence for a candidate contour: one simple closed loop of mesh edges, and the two
//! exact incident source faces per edge. Neither face is automatically a safe support surface.

use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IncidenceError {
    NotOneSimpleLoop,
    NotTwoSidedMeshEdge,
}

impl IncidenceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotOneSimpleLoop => "not-one-simple-loop",
            Self::NotTwoSidedMeshEdge => "not-two-sided-mesh-edge",
        }
    }
}

fn key_of(vertex_count: u64, a: u32, b: u32) -> u64 {
    u64::from(a.min(b)) * vertex_count + u64::from(a.max(b))
}

/// `contour` is vertex pairs. On success the result holds two face ids per contour edge, in the
/// order the faces appear in the mesh.
pub fn inspect_contour_incidence(vertex_count: usize, indices: &[u32], contour: &[u32]) -> Result<Vec<u32>, IncidenceError> {
    let count = vertex_count as u64;
    if contour.len() < 6 || contour.len() % 2 != 0 || indices.len() % 3 != 0 {
        return Err(IncidenceError::NotOneSimpleLoop);
    }
    let mut graph: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut first_key: Option<u32> = None;
    let mut keys: HashSet<u64> = HashSet::new();
    for pair in contour.chunks_exact(2) {
        let (a, b) = (pair[0], pair[1]);
        if a as usize >= vertex_count || b as usize >= vertex_count || a == b {
            return Err(IncidenceError::NotOneSimpleLoop);
        }
        if !keys.insert(key_of(count, a, b)) {
            return Err(IncidenceError::NotOneSimpleLoop);
        }
        first_key.get_or_insert(a);
        graph.entry(a).or_default().push(b);
        graph.entry(b).or_default().push(a);
    }
    if graph.len() != keys.len() || graph.values().any(|n| n.len() != 2) {
        return Err(IncidenceError::NotOneSimpleLoop);
    }
    let mut seen: HashSet<u32> = HashSet::new();
    let mut pending = vec![first_key.expect("contour is not empty")];
    while let Some(vertex) = pending.pop() {
        if !seen.insert(vertex) {
            continue;
        }
        pending.extend(graph[&vertex].iter().copied());
    }
    if seen.len() != graph.len() {
        return Err(IncidenceError::NotOneSimpleLoop);
    }
    let mut incident: HashMap<u64, Vec<u32>> = HashMap::new();
    for (face, ids) in indices.chunks_exact(3).enumerate() {
        if ids.iter().any(|&i| i as usize >= vertex_count) {
            return Err(IncidenceError::NotTwoSidedMeshEdge);
        }
        for corner in 0..3 {
            let key = key_of(count, ids[corner], ids[(corner + 1) % 3]);
            if keys.contains(&key) {
                incident.entry(key).or_default().push(face as u32);
            }
        }
    }
    let mut pairs = vec![0u32; contour.len()];
    for (at, pair) in contour.chunks_exact(2).enumerate() {
        match incident.get(&key_of(count, pair[0], pair[1])) {
            Some(faces) if faces.len() == 2 && faces[0] != faces[1] => {
                pairs[at * 2] = faces[0];
                pairs[at * 2 + 1] = faces[1];
            }
            _ => return Err(IncidenceError::NotTwoSidedMeshEdge),
        }
    }
    Ok(pairs)
}
