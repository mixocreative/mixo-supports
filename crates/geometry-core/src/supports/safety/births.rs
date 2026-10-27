//! Births of connected indexed-surface regions in the lower-star height sweep (Y up, mm): the
//! islands a print has to support (port of TS `topologyBirths.ts`). Beyond the births it records,
//! for every vertex, the lowest birth of the surface component the vertex joined at its own height:
//! what a support landing on the model has to rest on.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct Birth {
    pub height: f64,
    pub vertex: u32,
    pub plateau_vertices: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BirthsResult {
    Ok {
        births: Vec<Birth>,
        /// Per vertex: index into `births` of the lowest birth of its component at its own height
        /// (`u32::MAX` for a vertex no triangle uses).
        component_birth: Vec<u32>,
    },
    Inconclusive(&'static str),
}

pub const NO_BIRTH: u32 = u32::MAX;

pub fn topology_births(positions: &[f32], indices: &[u32], height_tolerance: f64) -> BirthsResult {
    use BirthsResult::Inconclusive;
    let count = positions.len() / 3;
    if positions.is_empty() || positions.len() % 3 != 0 || indices.is_empty() || indices.len() % 3 != 0 {
        return Inconclusive("empty or malformed mesh");
    }
    if !height_tolerance.is_finite() || height_tolerance < 0.0 {
        return Inconclusive("invalid height tolerance");
    }
    if positions.iter().any(|c| !c.is_finite()) {
        return Inconclusive("non-finite vertex");
    }
    let y = |v: usize| f64::from(positions[v * 3 + 1]);
    let mut degree = vec![0u32; count + 1];
    let mut used = vec![false; count];
    // For each undirected edge, the first opposite vertex and its use count (the same opposite
    // vertex on a second use is a duplicate triangle, even if reversed).
    let mut incidence: HashMap<u64, u64> = HashMap::new();
    let mut add_edge = |u: u32, v: u32, opposite: u32| -> Option<&'static str> {
        let key = u64::from(u.min(v)) * count as u64 + u64::from(u.max(v));
        match incidence.get(&key).copied() {
            None => {
                incidence.insert(key, u64::from(opposite) * 4 + 1);
                None
            }
            Some(prior) if prior % 4 == 2 => Some("non-manifold edge"),
            Some(prior) if prior / 4 == u64::from(opposite) => Some("duplicate triangle"),
            Some(prior) => {
                incidence.insert(key, prior + 1);
                None
            }
        }
    };
    for t in indices.chunks_exact(3) {
        let (a, b, c) = (t[0], t[1], t[2]);
        if a as usize >= count || b as usize >= count || c as usize >= count || a == b || b == c || c == a {
            return Inconclusive("invalid triangle index");
        }
        if let Some(fault) = add_edge(a, b, c).or_else(|| add_edge(b, c, a)).or_else(|| add_edge(c, a, b)) {
            return Inconclusive(fault);
        }
        for v in [a, b, c] {
            used[v as usize] = true;
            degree[v as usize + 1] += 2;
        }
    }
    for v in 0..count {
        degree[v + 1] += degree[v];
    }
    let mut neighbors = vec![0u32; degree[count] as usize];
    let mut next: Vec<u32> = degree[..count].to_vec();
    for t in indices.chunks_exact(3) {
        let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
        for (v, p, q) in [(a, t[1], t[2]), (b, t[0], t[2]), (c, t[0], t[1])] {
            neighbors[next[v] as usize] = p;
            neighbors[next[v] as usize + 1] = q;
            next[v] += 2;
        }
    }
    let mut ordered: Vec<usize> = (0..count).filter(|&v| used[v]).collect();
    ordered.sort_by(|&a, &b| y(a).partial_cmp(&y(b)).unwrap().then(a.cmp(&b)));
    let mut parent = vec![-1i64; count];
    let mut bucket_mark = vec![0u32; count];
    let mut root_birth = vec![-1i64; count];
    let mut component_birth = vec![NO_BIRTH; count];
    let mut raw: Vec<Birth> = Vec::new();
    let find = |parent: &mut Vec<i64>, mut v: usize| -> usize {
        while parent[v] != v as i64 {
            let grand = parent[parent[v] as usize];
            parent[v] = grand;
            v = parent[v] as usize;
        }
        v
    };
    let better = |raw: &[Birth], a: i64, b: i64| -> i64 {
        if a < 0 {
            return b;
        }
        if b < 0 {
            return a;
        }
        let (x, y) = (&raw[a as usize], &raw[b as usize]);
        if (x.height, x.vertex) <= (y.height, y.vertex) { a } else { b }
    };
    let mut bucket = 0u32;
    let mut start = 0;
    while start < ordered.len() {
        let height = y(ordered[start]);
        let mut end = start + 1;
        while end < ordered.len() && y(ordered[end]) - height <= height_tolerance {
            end += 1;
        }
        bucket += 1;
        for &v in &ordered[start..end] {
            parent[v] = v as i64;
            bucket_mark[v] = bucket;
            root_birth[v] = -1;
        }
        let join = |parent: &mut Vec<i64>, root_birth: &mut Vec<i64>, raw: &[Birth], a: usize, b: usize| {
            let (left, right) = (find(parent, a), find(parent, b));
            if left != right {
                let (lo, hi) = (left.min(right), left.max(right));
                parent[hi] = lo as i64;
                root_birth[lo] = better(raw, root_birth[lo], root_birth[hi]);
            }
        };
        for &v in &ordered[start..end] {
            for at in degree[v]..degree[v + 1] {
                let w = neighbors[at as usize] as usize;
                if bucket_mark[w] == bucket {
                    join(&mut parent, &mut root_birth, &raw, v, w);
                }
            }
        }
        // Plateaus in order of first appearance of their first vertex (the order of the oracle's Map).
        let mut plateaus: Vec<(usize, Vec<u32>, bool)> = Vec::new();
        let mut slot: HashMap<usize, usize> = HashMap::new();
        for &v in &ordered[start..end] {
            let root = find(&mut parent, v);
            let k = *slot.entry(root).or_insert_with(|| {
                plateaus.push((root, Vec::new(), false));
                plateaus.len() - 1
            });
            plateaus[k].1.push(v as u32);
            for at in degree[v]..degree[v + 1] {
                let w = neighbors[at as usize] as usize;
                if parent[w] >= 0 && bucket_mark[w] != bucket {
                    plateaus[k].2 = true;
                }
            }
        }
        for (root, vertices, lower) in &mut plateaus {
            if !*lower {
                vertices.sort_unstable();
                raw.push(Birth { height, vertex: vertices[0], plateau_vertices: vertices.clone() });
                root_birth[*root] = raw.len() as i64 - 1;
            }
        }
        for &v in &ordered[start..end] {
            for at in degree[v]..degree[v + 1] {
                let w = neighbors[at as usize] as usize;
                if parent[w] >= 0 && bucket_mark[w] != bucket {
                    join(&mut parent, &mut root_birth, &raw, v, w);
                }
            }
        }
        for &v in &ordered[start..end] {
            let root = find(&mut parent, v);
            component_birth[v] = if root_birth[root] < 0 { NO_BIRTH } else { root_birth[root] as u32 };
        }
        start = end;
    }
    // Sort the births (height, vertex) and remap the per-vertex references.
    let mut order: Vec<usize> = (0..raw.len()).collect();
    order.sort_by(|&a, &b| raw[a].height.partial_cmp(&raw[b].height).unwrap().then(raw[a].vertex.cmp(&raw[b].vertex)));
    let mut rank = vec![0u32; raw.len()];
    for (sorted, &old) in order.iter().enumerate() {
        rank[old] = sorted as u32;
    }
    for c in &mut component_birth {
        if (*c as usize) < raw.len() {
            *c = rank[*c as usize];
        }
    }
    let births = order.into_iter().map(|k| raw[k].clone()).collect();
    BirthsResult::Ok { births, component_birth }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn births_of(positions: &[f32], indices: &[u32]) -> Vec<(f64, u32, Vec<u32>)> {
        match topology_births(positions, indices, 1e-5) {
            BirthsResult::Ok { births, .. } => births.into_iter().map(|b| (b.height, b.vertex, b.plateau_vertices)).collect(),
            BirthsResult::Inconclusive(r) => panic!("inconclusive: {r}"),
        }
    }

    #[test]
    fn one_equal_height_bottom_plateau_is_one_birth() {
        let tetra = [-1.0f32, 5.0, -1.0, 1.0, 5.0, -1.0, 0.0, 5.0, 1.0, 0.0, 7.0, 0.0];
        assert_eq!(births_of(&tetra, &[0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]), vec![(5.0, 0, vec![0, 1, 2])]);
    }

    #[test]
    fn a_later_disconnected_birth_is_found_but_not_a_slope_vertex() {
        let two = [-5.0f32, 0.0, 0.0, -4.0, 0.0, 0.0, -4.5, 0.0, 1.0, -4.5, 2.0, 0.0, 4.0, 5.0, 0.0, 5.0, 5.0, 0.0, 4.5, 5.0, 1.0, 4.5, 7.0, 0.0];
        let idx = [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0, 4, 5, 6, 4, 7, 5, 5, 7, 6, 6, 7, 4];
        assert_eq!(births_of(&two, &idx), vec![(0.0, 0, vec![0, 1, 2]), (5.0, 4, vec![4, 5, 6])]);
        let BirthsResult::Ok { component_birth, .. } = topology_births(&two, &idx, 1e-5) else { panic!("ok") };
        assert_eq!(component_birth, vec![0, 0, 0, 0, 1, 1, 1, 1]);
    }

    #[test]
    fn two_minima_are_reported_before_a_higher_saddle_joins_them() {
        let arch = [-2.0f32, 1.0, 0.0, 2.0, 1.0, 0.0, 0.0, 3.0, 0.0, -2.0, 4.0, 1.0, 2.0, 4.0, 1.0];
        assert_eq!(births_of(&arch, &[0, 2, 3, 1, 4, 2, 2, 4, 3]), vec![(1.0, 0, vec![0]), (1.0, 1, vec![1])]);
        let BirthsResult::Ok { component_birth, .. } = topology_births(&arch, &[0, 2, 3, 1, 4, 2, 2, 4, 3], 1e-5) else { panic!("ok") };
        // The saddle joins both minima: its component's lowest birth is the first one.
        assert_eq!(component_birth[2], 0);
    }

    #[test]
    fn malformed_or_non_finite_input_is_inconclusive() {
        let is_inconclusive = |p: &[f32], i: &[u32]| matches!(topology_births(p, i, 1e-5), BirthsResult::Inconclusive(_));
        assert!(is_inconclusive(&[], &[]));
        assert!(is_inconclusive(&[0.0, f32::NAN, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], &[0, 1, 2]));
        assert!(is_inconclusive(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], &[0, 1, 3]));
        assert!(matches!(topology_births(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], &[0, 1, 2], -1.0), BirthsResult::Inconclusive("invalid height tolerance")));
    }

    #[test]
    fn non_manifold_edges_and_duplicate_triangles_are_not_trusted() {
        let points = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0];
        assert_eq!(topology_births(&points, &[0, 1, 2, 1, 0, 3, 0, 1, 4], 1e-5), BirthsResult::Inconclusive("non-manifold edge"));
        assert_eq!(topology_births(&points, &[0, 1, 2, 2, 1, 0], 1e-5), BirthsResult::Inconclusive("duplicate triangle"));
    }
}
