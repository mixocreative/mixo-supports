//! Output checks 1–3 (every output) and 6–8 (unit tests only).

#[cfg(test)]
use crate::geom::{Label, Solid, V3, cross, dot, length, signed_volume, sub, triangle_area};
use std::collections::{HashMap, HashSet};

/// Check 1: every undirected edge used exactly twice, with opposite winding. Returns the edge count.
pub fn check_edges(triangles: &[[u32; 3]]) -> Result<usize, String> {
    let mut directed: HashMap<(u32, u32), u32> = HashMap::with_capacity(triangles.len() * 3);
    for t in triangles {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            if a == b {
                return Err(format!("degenerate triangle {t:?}"));
            }
            *directed.entry((a, b)).or_insert(0) += 1;
        }
    }
    for (&(a, b), &count) in &directed {
        if count != 1 {
            return Err(format!("directed edge {a}->{b} used {count} times"));
        }
        if !directed.contains_key(&(b, a)) {
            return Err(format!("edge {a}-{b} has no opposite use (boundary or flipped winding)"));
        }
    }
    Ok(directed.len() / 2)
}

/// Check 2: every vertex has a single fan of faces. Assumes check 1 passed.
pub fn check_fans(vertex_count: usize, triangles: &[[u32; 3]]) -> Result<(), String> {
    // The link of v: for each triangle (v, b, c) the directed link edge b -> c.
    let mut start = vec![0u32; vertex_count + 1];
    for t in triangles {
        for &v in t {
            start[v as usize + 1] += 1;
        }
    }
    for i in 0..vertex_count {
        start[i + 1] += start[i];
    }
    let mut fill = start.clone();
    let mut links = vec![(0u32, 0u32); triangles.len() * 3];
    for t in triangles {
        for k in 0..3 {
            let v = t[k] as usize;
            links[fill[v] as usize] = (t[(k + 1) % 3], t[(k + 2) % 3]);
            fill[v] += 1;
        }
    }
    for v in 0..vertex_count {
        let link = &links[start[v] as usize..start[v + 1] as usize];
        if link.is_empty() {
            return Err(format!("vertex {v} is used by no triangle"));
        }
        let next: HashMap<u32, u32> = link.iter().copied().collect();
        if next.len() != link.len() {
            return Err(format!("vertex {v}: link is not a single cycle"));
        }
        let first = link[0].0;
        let mut at = first;
        let mut steps = 0;
        loop {
            at = match next.get(&at) {
                Some(&n) => n,
                None => return Err(format!("vertex {v}: open fan")),
            };
            steps += 1;
            if at == first || steps > link.len() {
                break;
            }
        }
        if at != first || steps != link.len() {
            return Err(format!("vertex {v} has more than one fan of faces"));
        }
    }
    Ok(())
}

/// Checks 1–3; returns χ = V − E + F.
pub fn check_topology(vertex_count: usize, triangles: &[[u32; 3]], expected_chi: i64) -> Result<i64, String> {
    let edges = check_edges(triangles).map_err(|e| format!("check 1 (edges): {e}"))?;
    check_fans(vertex_count, triangles).map_err(|e| format!("check 2 (fans): {e}"))?;
    let chi = vertex_count as i64 - edges as i64 + triangles.len() as i64;
    if chi != expected_chi {
        return Err(format!("check 3 (Euler characteristic): χ {chi}, expected {expected_chi}"));
    }
    Ok(chi)
}

/// χ = V − E + F without other checks (the unmodified reference, measured at run time).
pub fn euler(vertex_count: usize, triangles: &[[u32; 3]]) -> i64 {
    let mut edges = HashSet::with_capacity(triangles.len() * 3 / 2);
    for t in triangles {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            edges.insert((a.min(b), a.max(b)));
        }
    }
    vertex_count as i64 - edges.len() as i64 + triangles.len() as i64
}

#[cfg(test)]
/// Check 6: signed volume > 0 and within 15 % of (mean of the F and G areas) × t.
pub fn check_volume(solid: &Solid, thickness: f64) -> Result<(), String> {
    let volume = signed_volume(&solid.positions, &solid.triangles);
    let area = |label: Label| -> f64 {
        solid.triangles.iter().zip(&solid.labels).filter(|(_, l)| **l == label).map(|(t, _)| triangle_area(&solid.positions, *t)).sum()
    };
    let expected = (area(Label::F) + area(Label::G)) / 2.0 * thickness;
    if volume <= 0.0 {
        return Err(format!("check 6: signed volume {volume} is not positive"));
    }
    if (volume - expected).abs() > 0.15 * expected {
        return Err(format!("check 6: volume {volume:.3} vs (mean area × t) {expected:.3}, beyond 15 %"));
    }
    Ok(())
}

#[cfg(test)]
/// Check 7: minimum edge ≥ 0.05 mm, minimum angle ≥ 5°.
pub fn check_quality(solid: &Solid) -> Result<(), String> {
    for (index, t) in solid.triangles.iter().enumerate() {
        let p = t.map(|i| solid.point(i));
        for k in 0..3 {
            let a = sub(p[(k + 1) % 3], p[k]);
            let b = sub(p[(k + 2) % 3], p[k]);
            if length(a) < 0.05 {
                return Err(format!("check 7: edge {:.4} mm < 0.05 in triangle {index} ({:?}) at {:?}", length(a), solid.labels[index], p[k]));
            }
            let cosine = (dot(a, b) / (length(a) * length(b))).clamp(-1.0, 1.0);
            let degrees = cosine.acos().to_degrees();
            if degrees < 5.0 {
                return Err(format!("check 7: angle {degrees:.2}° < 5° in triangle {index} ({:?}) at {:?}", solid.labels[index], p[k]));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
/// Check 8: no two non-adjacent triangles (no shared vertex) intersect. Uniform hash of `cell` mm.
pub fn find_self_intersection(solid: &Solid, cell: f64) -> Option<(usize, usize)> {
    let key = |v: f64| (v / cell).floor() as i64;
    let mut grid: HashMap<(i64, i64, i64), Vec<u32>> = HashMap::new();
    for (index, t) in solid.triangles.iter().enumerate() {
        let p = t.map(|i| solid.point(i));
        let lo: [i64; 3] = std::array::from_fn(|a| key(p[0][a].min(p[1][a]).min(p[2][a])));
        let hi: [i64; 3] = std::array::from_fn(|a| key(p[0][a].max(p[1][a]).max(p[2][a])));
        for x in lo[0]..=hi[0] {
            for y in lo[1]..=hi[1] {
                for z in lo[2]..=hi[2] {
                    grid.entry((x, y, z)).or_default().push(index as u32);
                }
            }
        }
    }
    let mut tested: HashSet<(u32, u32)> = HashSet::new();
    let mut cells: Vec<_> = grid.into_iter().collect();
    cells.sort_unstable_by_key(|(k, _)| *k);
    for (_, members) in cells {
        for (n, &a) in members.iter().enumerate() {
            for &b in &members[n + 1..] {
                let ta = solid.triangles[a as usize];
                let tb = solid.triangles[b as usize];
                if ta.iter().any(|v| tb.contains(v)) || !tested.insert((a.min(b), a.max(b))) {
                    continue;
                }
                if triangles_intersect(ta.map(|i| solid.point(i)), tb.map(|i| solid.point(i))) {
                    return Some((a as usize, b as usize));
                }
            }
        }
    }
    None
}

#[cfg(test)]
pub fn triangles_intersect(a: [V3; 3], b: [V3; 3]) -> bool {
    (0..3).any(|k| segment_hits_triangle(a[k], a[(k + 1) % 3], b)) || (0..3).any(|k| segment_hits_triangle(b[k], b[(k + 1) % 3], a))
}

#[cfg(test)]
/// Moller-Trumbore on the segment p -> q.
fn segment_hits_triangle(p: V3, q: V3, t: [V3; 3]) -> bool {
    let d = sub(q, p);
    let e1 = sub(t[1], t[0]);
    let e2 = sub(t[2], t[0]);
    let h = cross(d, e2);
    let det = dot(e1, h);
    if det.abs() < 1e-14 {
        return false;
    }
    let inv = 1.0 / det;
    let s = sub(p, t[0]);
    let u = dot(s, h) * inv;
    if !(0.0..=1.0).contains(&u) {
        return false;
    }
    let qv = cross(s, e1);
    let v = dot(d, qv) * inv;
    if v < 0.0 || u + v > 1.0 {
        return false;
    }
    let along = dot(e2, qv) * inv;
    (0.0..=1.0).contains(&along)
}
