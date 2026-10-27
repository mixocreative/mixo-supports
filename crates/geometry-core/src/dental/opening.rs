//! Central opening: present, absent or ambiguous. Two raster resolutions must agree, and an
//! ambiguous answer never becomes `absent`; neither grants support permission.

use super::mesh::dot;
use super::profiles::AlignerProfile;
use super::topology::{Context, components};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq)]
pub enum Opening {
    /// Edge indices of the opening loop.
    Present(Vec<usize>),
    Absent,
    Ambiguous(&'static str),
}

enum Hole {
    Present { labels: Vec<i32>, id: i32, pixels: Vec<[f64; 2]> },
    Absent,
    Ambiguous(&'static str),
}

fn opening_hole(context: &Context, size: usize, profile: &AlignerProfile) -> Hole {
    let (mut low, mut high) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for point in &context.projected {
        for axis in 0..2 {
            low[axis] = low[axis].min(point[axis]);
            high[axis] = high[axis].max(point[axis]);
        }
    }
    let scale = (size as f64 - 4.0) / (high[0] - low[0]).max(high[1] - low[1]);
    let pixels: Vec<[f64; 2]> = context.projected.iter().map(|p| [(p[0] - low[0]) * scale + 2.0, (p[1] - low[1]) * scale + 2.0]).collect();
    let mut filled = vec![0u8; size * size];
    let last = size as f64 - 1.0;
    for face in 0..context.mesh.face_count() {
        let a = pixels[context.mesh.corner(face, 0) as usize];
        let b = pixels[context.mesh.corner(face, 1) as usize];
        let c = pixels[context.mesh.corner(face, 2) as usize];
        let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if area.abs() < 1e-8 {
            continue;
        }
        let x0 = a[0].min(b[0]).min(c[0]).floor().max(0.0);
        let x1 = a[0].max(b[0]).max(c[0]).ceil().min(last);
        let y0 = a[1].min(b[1]).min(c[1]).floor().max(0.0);
        let y1 = a[1].max(b[1]).max(c[1]).ceil().min(last);
        if x1 < x0 || y1 < y0 {
            continue;
        }
        for y in y0 as usize..=y1 as usize {
            for x in x0 as usize..=x1 as usize {
                let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                let u = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
                let v = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
                if u >= -1e-8 && v >= -1e-8 && 1.0 - u - v >= -1e-8 {
                    filled[y * size + x] = 1;
                }
            }
        }
    }
    let mut labels = vec![0i32; size * size];
    let mut id = 0i32;
    let mut holes: Vec<(i32, usize)> = Vec::new();
    for start in 0..labels.len() {
        if filled[start] != 0 || labels[start] != 0 {
            continue;
        }
        id += 1;
        let mut queue = vec![start];
        labels[start] = id;
        let mut exterior = false;
        let mut head = 0;
        while head < queue.len() {
            let cell = queue[head];
            head += 1;
            let (x, y) = (cell % size, cell / size);
            if x == 0 || y == 0 || x == size - 1 || y == size - 1 {
                exterior = true;
            }
            for (dx, dy) in [(-1i64, 0i64), (1, 0), (0, -1), (0, 1)] {
                let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                if nx < 0 || ny < 0 || nx >= size as i64 || ny >= size as i64 {
                    continue;
                }
                let next = ny as usize * size + nx as usize;
                if filled[next] == 0 && labels[next] == 0 {
                    labels[next] = id;
                    queue.push(next);
                }
            }
        }
        if !exterior {
            holes.push((id, queue.len()));
        }
    }
    if holes.is_empty() {
        return Hole::Absent;
    }
    if holes.len() != 1 || (holes[0].1 as f64) < (size * size) as f64 * profile.thresholds.opening_hole_min_fraction {
        return Hole::Ambiguous("projected-holes-uncertain");
    }
    Hole::Present { labels, id: holes[0].0, pixels }
}

fn js_round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

fn opening_contour(context: &Context, size: usize, profile: &AlignerProfile) -> Opening {
    let (labels, id, pixels) = match opening_hole(context, size, profile) {
        Hole::Present { labels, id, pixels } => (labels, id, pixels),
        Hole::Absent => return Opening::Absent,
        Hole::Ambiguous(reason) => return Opening::Ambiguous(reason),
    };
    let direction = context.rim.opening_direction;
    let mut selected: Vec<usize> = Vec::new();
    for (index, edge) in context.edges.iter().enumerate() {
        let first = dot(context.normals[edge.faces[0] as usize], direction);
        let second = dot(context.normals[edge.faces[1] as usize], direction);
        if first * second > 0.0 {
            continue;
        }
        let (a, b) = (pixels[edge.a as usize], pixels[edge.b as usize]);
        let (x, y) = (js_round((a[0] + b[0]) / 2.0), js_round((a[1] + b[1]) / 2.0));
        let mut near = false;
        'scan: for dy in -2..=2 {
            for dx in -2..=2 {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && nx < size as i64 && ny >= 0 && ny < size as i64 && labels[ny as usize * size + nx as usize] == id {
                    near = true;
                    break 'scan;
                }
            }
        }
        if near {
            selected.push(index);
        }
    }
    let mut graph: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut keys: Vec<u32> = Vec::new();
    for &edge in &selected {
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
    let branch: Vec<u32> = keys.iter().copied().filter(|k| graph[k].len() > 2).collect();
    if branch.len() > 1 || graph.values().any(|incident| incident.len() != 2 && incident.len() != 4) {
        return Opening::Ambiguous("opening-loop-branched");
    }
    let minimum = profile.thresholds.opening_loop_min_edges;
    if branch.is_empty() {
        return if selected.len() > minimum && components(context, &selected).len() == 1 {
            Opening::Present(selected)
        } else {
            Opening::Ambiguous("opening-loop-not-closed")
        };
    }
    let centre = branch[0];
    let mut visited: HashSet<usize> = HashSet::new();
    let mut loops: Vec<Vec<usize>> = Vec::new();
    for &start_edge in &graph[&centre] {
        if visited.contains(&start_edge) {
            continue;
        }
        let mut path: Vec<usize> = Vec::new();
        let other = |edge: usize, from: u32| if context.edges[edge].a == from { context.edges[edge].b } else { context.edges[edge].a };
        let mut current = other(start_edge, centre);
        let mut edge = start_edge;
        while !visited.contains(&edge) {
            visited.insert(edge);
            path.push(edge);
            if current == centre {
                break;
            }
            let Some(&next) = graph[&current].iter().find(|&&candidate| candidate != edge) else { break };
            edge = next;
            current = other(next, current);
        }
        if current == centre {
            loops.push(path);
        }
    }
    loops.sort_by(|a, b| b.len().cmp(&a.len()));
    if loops.is_empty() || loops[0].len() < minimum || loops.len() > 2 || loops.get(1).is_some_and(|l| l.len() > 10) {
        return Opening::Ambiguous("opening-loop-not-isolated");
    }
    Opening::Present(loops.swap_remove(0))
}

/// Present only when both resolutions find the same loop; a disagreement is ambiguous.
pub fn central_opening(context: &Context, profile: &AlignerProfile) -> Opening {
    let low = opening_contour(context, profile.thresholds.opening_resolution_low, profile);
    let high = opening_contour(context, profile.thresholds.opening_resolution_high, profile);
    match (low, high) {
        (Opening::Absent, Opening::Absent) => Opening::Absent,
        (Opening::Present(a), Opening::Present(b)) => {
            let same = a.len() == b.len() && {
                let set: HashSet<usize> = b.iter().copied().collect();
                a.iter().all(|e| set.contains(e))
            };
            if same { Opening::Present(b) } else { Opening::Ambiguous("opening-contour-unstable") }
        }
        _ => Opening::Ambiguous("opening-resolution-disagreement"),
    }
}
