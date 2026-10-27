//! Arclength sampling of contour contacts: one source face per sample, found by a locally
//! connected search inside the side band. Not a safety certificate (U7 owns collision checks).

use super::incidence::inspect_contour_incidence;
use super::mesh::{Mesh, V3, distance, hypot3};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContourContact {
    pub face: u32,
    pub position: V3,
    pub normal: V3,
    pub distance_along_contour: f64,
    pub distance_from_contour: f64,
}

pub struct Sampled {
    pub contacts: Vec<ContourContact>,
    pub skipped_samples: usize,
    pub perimeter: f64,
}

/// The loop's vertices in walk order from its lowest vertex id, toward its lower neighbour.
fn ordered_vertices(contour: &[u32]) -> Option<Vec<u32>> {
    let mut neighbors: HashMap<u32, Vec<u32>> = HashMap::new();
    for pair in contour.chunks_exact(2) {
        neighbors.entry(pair[0]).or_default().push(pair[1]);
        neighbors.entry(pair[1]).or_default().push(pair[0]);
    }
    let start = *neighbors.keys().min()?;
    let mut ordered = vec![start];
    let mut previous = start;
    let mut current = *neighbors[&start].iter().min()?;
    while current != start && ordered.len() <= neighbors.len() {
        ordered.push(current);
        let pair = neighbors.get(&current)?;
        if pair.len() != 2 {
            return None;
        }
        let next = if pair[0] == previous { pair[1] } else { pair[0] };
        previous = current;
        current = next;
    }
    (current == start && ordered.len() == neighbors.len()).then_some(ordered)
}

fn band_faces(mesh: &Mesh, mask: &[u8]) -> Option<Vec<ContourContact>> {
    let mut result = Vec::new();
    for (face, &flag) in mask.iter().enumerate() {
        if flag == 0 {
            continue;
        }
        if flag != 1 {
            return None;
        }
        let [a, b, c] = mesh.face_points(face);
        let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        let length = hypot3(cross[0], cross[1], cross[2]);
        if !length.is_finite() || length < 1e-12 {
            continue;
        }
        result.push(ContourContact {
            face: face as u32,
            position: [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0, (a[2] + b[2] + c[2]) / 3.0],
            normal: [cross[0] / length, cross[1] / length, cross[2] / length],
            distance_along_contour: 0.0,
            distance_from_contour: 0.0,
        });
    }
    Some(result)
}

/// Face adjacency that stops at the contour: its edges never link two faces.
struct LocalGraph {
    neighbors: Vec<i32>,
    centroids: Vec<f32>,
}

fn face_neighbors(mesh: &Mesh, contour: &[u32]) -> Option<LocalGraph> {
    let vertex_count = mesh.vertex_count() as u64;
    let edge_key = |a: u32, b: u32| u64::from(a.min(b)) * vertex_count + u64::from(a.max(b));
    let blocked: HashSet<u64> = contour.chunks_exact(2).map(|p| edge_key(p[0], p[1])).collect();
    let mut first: HashMap<u64, (usize, usize, u8)> = HashMap::new();
    let mut neighbors = vec![-1i32; mesh.indices.len()];
    let mut centroids = vec![0f32; mesh.indices.len()];
    for face in 0..mesh.face_count() {
        for axis in 0..3 {
            let sum = f64::from(mesh.positions[mesh.corner(face, 0) as usize * 3 + axis])
                + f64::from(mesh.positions[mesh.corner(face, 1) as usize * 3 + axis])
                + f64::from(mesh.positions[mesh.corner(face, 2) as usize * 3 + axis]);
            centroids[face * 3 + axis] = (sum / 3.0) as f32;
        }
        for corner in 0..3 {
            let (a, b) = (mesh.corner(face, corner), mesh.corner(face, (corner + 1) % 3));
            if a as usize >= mesh.vertex_count() || b as usize >= mesh.vertex_count() {
                return None;
            }
            let key = edge_key(a, b);
            match first.get_mut(&key) {
                None => {
                    first.insert(key, (face, corner, 1));
                }
                Some(prior) => {
                    if prior.2 != 1 {
                        return None;
                    }
                    prior.2 = 2;
                    if blocked.contains(&key) {
                        continue;
                    }
                    neighbors[face * 3 + corner] = prior.0 as i32;
                    neighbors[prior.0 * 3 + prior.1] = face as i32;
                }
            }
        }
    }
    Some(LocalGraph { neighbors, centroids })
}

fn local_candidate(seed: usize, point: V3, graph: &LocalGraph, face_data: &HashMap<u32, ContourContact>, used: &HashSet<u32>, max_distance: f64) -> Option<(ContourContact, f64)> {
    let centre = |face: usize| -> V3 { [f64::from(graph.centroids[face * 3]), f64::from(graph.centroids[face * 3 + 1]), f64::from(graph.centroids[face * 3 + 2])] };
    let path_limit = max_distance * 2.0;
    let seed_path = distance(point, centre(seed));
    let mut pending: Vec<(usize, f64)> = vec![(seed, seed_path)];
    let mut distances: HashMap<usize, f64> = HashMap::from([(seed, seed_path)]);
    let mut closest: Option<(ContourContact, f64)> = None;
    while !pending.is_empty() {
        let mut best = 0;
        for at in 1..pending.len() {
            if pending[at].1 < pending[best].1 {
                best = at;
            }
        }
        let (face, path) = pending.remove(best);
        if distances.get(&face) != Some(&path) {
            continue;
        }
        if let Some(contact) = face_data.get(&(face as u32)).filter(|_| !used.contains(&(face as u32))) {
            let from_contour = distance(point, contact.position);
            if from_contour <= max_distance
                && closest.as_ref().is_none_or(|c| from_contour < c.1 || (from_contour == c.1 && (face as u32) < c.0.face))
            {
                closest = Some((*contact, from_contour));
            }
        }
        for corner in 0..3 {
            let next = graph.neighbors[face * 3 + corner];
            if next < 0 {
                continue;
            }
            let next = next as usize;
            // A face outside the band may bridge the small crest setback, but never walk farther
            // than the local 3D budget or across a blocked contour edge.
            let next_path = path + distance(centre(face), centre(next));
            if next_path > path_limit || next_path >= distances.get(&next).copied().unwrap_or(f64::INFINITY) {
                continue;
            }
            distances.insert(next, next_path);
            pending.push((next, next_path));
        }
    }
    closest
}

/// Samples contacts every `spacing` mm of contour length, starting `phase_mm` along (default
/// half a spacing). `Err` carries the oracle's reason string.
pub fn sample_contour_contacts(mesh: &Mesh, contour: &[u32], side_band: &[u8], spacing: f64, max_search: f64, phase_mm: Option<f64>) -> Result<Sampled, &'static str> {
    let phase = phase_mm.unwrap_or(spacing / 2.0);
    if !spacing.is_finite() || spacing <= 0.0 || !max_search.is_finite() || max_search <= 0.0 || !phase.is_finite() || phase < 0.0 || phase >= spacing || side_band.len() != mesh.face_count() {
        return Err("invalid-sampling-input");
    }
    let pairs = inspect_contour_incidence(mesh.vertex_count(), mesh.indices, contour).map_err(|_| "invalid-contour")?;
    let ordered = ordered_vertices(contour);
    let faces = band_faces(mesh, side_band);
    let neighbors = face_neighbors(mesh, contour);
    let (Some(ordered), Some(faces), Some(neighbors)) = (ordered, faces, neighbors) else { return Err("empty-or-invalid-band") };
    if faces.is_empty() {
        return Err("empty-or-invalid-band");
    }
    let face_data: HashMap<u32, ContourContact> = faces.iter().map(|f| (f.face, *f)).collect();
    let vertex_count = mesh.vertex_count() as u64;
    let edge_key = |a: u32, b: u32| u64::from(a.min(b)) * vertex_count + u64::from(a.max(b));
    let incident: HashMap<u64, [u32; 2]> = contour.chunks_exact(2).enumerate().map(|(at, p)| (edge_key(p[0], p[1]), [pairs[at * 2], pairs[at * 2 + 1]])).collect();
    struct Segment {
        a: V3,
        b: V3,
        length: f64,
        sides: [u32; 2],
    }
    let segments: Vec<Segment> = ordered
        .iter()
        .enumerate()
        .map(|(index, &id)| {
            let next = ordered[(index + 1) % ordered.len()];
            let (a, b) = (mesh.point(id), mesh.point(next));
            Segment { a, b, length: distance(a, b), sides: incident[&edge_key(id, next)] }
        })
        .collect();
    let perimeter = segments.iter().fold(0.0, |sum, s| sum + s.length);
    if !perimeter.is_finite() || perimeter < spacing {
        return Err("invalid-perimeter");
    }
    let mut contacts = Vec::new();
    let mut used: HashSet<u32> = HashSet::new();
    let mut skipped = 0;
    let (mut segment_index, mut segment_start) = (0usize, 0.0f64);
    let mut along = phase;
    while along < perimeter {
        while segment_index < segments.len() - 1 && segment_start + segments[segment_index].length < along {
            segment_start += segments[segment_index].length;
            segment_index += 1;
        }
        let segment = &segments[segment_index];
        let t = if segment.length != 0.0 { (along - segment_start) / segment.length } else { 0.0 };
        let point: V3 = std::array::from_fn(|axis| segment.a[axis] + (segment.b[axis] - segment.a[axis]) * t);
        let one = local_candidate(segment.sides[0] as usize, point, &neighbors, &face_data, &used, max_search);
        let two = local_candidate(segment.sides[1] as usize, point, &neighbors, &face_data, &used, max_search);
        // Without a unique local side, the band has not established which surface is intended.
        let chosen = match (one, two) {
            (Some(c), None) | (None, Some(c)) => Some(c),
            _ => None,
        };
        match chosen {
            None => skipped += 1,
            Some((contact, from)) => {
                used.insert(contact.face);
                contacts.push(ContourContact { distance_along_contour: along, distance_from_contour: from, ..contact });
            }
        }
        along += spacing;
    }
    Ok(Sampled { contacts, skipped_samples: skipped, perimeter })
}
