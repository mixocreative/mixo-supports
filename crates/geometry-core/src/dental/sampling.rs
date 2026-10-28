//! Arclength sampling of contour contacts: one source face per sample, found by a locally
//! connected search inside the side band. Not a safety certificate (U7 owns collision checks).

use super::incidence::inspect_contour_incidence;
use super::mesh::Mesh;
use crate::core::vec::{V3, distance};
use crate::core::jsnum::hypot3;
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
    /// Samples without a unique local side.
    pub skipped_samples: usize,
    /// Samples left out for lying closer than the minimum separation to an accepted contact.
    pub crowded_samples: usize,
    pub perimeter: f64,
}

/// How one contour is sampled: every `spacing` mm of contour length, starting `phase_mm` along
/// (default half a spacing), each contact searched within `max_search` mm, and no contact closer
/// (3D) than `min_separation` mm to an earlier one of this contour or to `keep_clear_of` (the
/// contacts already accepted on the other contour). `min_separation` 0 turns the rule off.
#[derive(Clone, Copy, Debug)]
pub struct SampleSettings<'a> {
    pub spacing: f64,
    pub max_search: f64,
    pub phase_mm: Option<f64>,
    pub min_separation: f64,
    pub keep_clear_of: &'a [ContourContact],
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
        let length = hypot3(cross);
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

/// Samples contacts along one contour (see [`SampleSettings`]). `Err` carries the oracle's reason
/// string.
pub fn sample_contour_contacts(mesh: &Mesh, contour: &[u32], side_band: &[u8], settings: &SampleSettings) -> Result<Sampled, &'static str> {
    let SampleSettings { spacing, max_search, phase_mm, min_separation, keep_clear_of } = *settings;
    let phase = phase_mm.unwrap_or(spacing / 2.0);
    if !spacing.is_finite() || spacing <= 0.0 || !max_search.is_finite() || max_search <= 0.0 || !phase.is_finite() || phase < 0.0 || phase >= spacing || !(min_separation >= 0.0) || !min_separation.is_finite() || side_band.len() != mesh.face_count() {
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
    let mut crowded = 0;
    // Arclength alone does not keep tips apart where the contour folds back on itself (the
    // arch's distal hairpin) or passes close to the other contour: check the 3D distance too.
    let crowds = |position: V3, contacts: &[ContourContact]| keep_clear_of.iter().chain(contacts).any(|c| distance(c.position, position) < min_separation);
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
            Some((contact, _)) if crowds(contact.position, &contacts) => crowded += 1,
            Some((contact, from)) => {
                used.insert(contact.face);
                contacts.push(ContourContact { distance_along_contour: along, distance_from_contour: from, ..contact });
            }
        }
        along += spacing;
    }
    Ok(Sampled { contacts, skipped_samples: skipped, crowded_samples: crowded, perimeter })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A flat 12 x 2 mm grid (0.2 mm cells) with a closed 10 x 0.6 mm rectangle contour: a thin
    /// hairpin whose two long sides lie 0.6 mm apart. The band is every face inside it.
    fn hairpin() -> (Vec<f32>, Vec<u32>, Vec<u32>, Vec<u8>) {
        let (nx, ny) = (61u32, 11u32);
        let id = |i: u32, j: u32| j * nx + i;
        let positions: Vec<f32> = (0..ny).flat_map(|j| (0..nx).flat_map(move |i| [i as f32 * 0.2, j as f32 * 0.2, 0.0])).collect();
        let (mut indices, mut band) = (Vec::new(), Vec::new());
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                indices.extend([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
                let inside = u8::from((5..55).contains(&i) && (3..6).contains(&j));
                band.extend([inside, inside]);
            }
        }
        let mut ring: Vec<u32> = (5..55).map(|i| id(i, 3)).collect();
        ring.extend((3..6).map(|j| id(55, j)));
        ring.extend((6..=55).rev().map(|i| id(i, 6)));
        ring.extend((4..=6).rev().map(|j| id(5, j)));
        let contour = (0..ring.len()).flat_map(|k| [ring[k], ring[(k + 1) % ring.len()]]).collect();
        (positions, indices, contour, band)
    }

    fn closest_pair(contacts: &[ContourContact], others: &[ContourContact]) -> f64 {
        let mut best = f64::INFINITY;
        for (at, a) in contacts.iter().enumerate() {
            for b in contacts[at + 1..].iter().chain(others) {
                best = best.min(distance(a.position, b.position));
            }
        }
        best
    }

    #[test]
    fn a_hairpin_keeps_its_tips_the_minimum_separation_apart() {
        let (positions, indices, contour, band) = hairpin();
        let mesh = Mesh::new(&positions, &indices);
        let settings = SampleSettings { spacing: 1.0, max_search: 1.0, phase_mm: None, min_separation: 0.0, keep_clear_of: &[] };
        let free = sample_contour_contacts(&mesh, &contour, &band, &settings).unwrap();
        assert!(closest_pair(&free.contacts, &[]) < 1.0, "arclength alone puts tips across the hairpin closer than 1 mm");
        assert_eq!(free.crowded_samples, 0);
        let kept = sample_contour_contacts(&mesh, &contour, &band, &SampleSettings { min_separation: 1.0, ..settings }).unwrap();
        assert!(closest_pair(&kept.contacts, &[]) >= 1.0);
        assert!(kept.crowded_samples > 0 && kept.contacts.len() + kept.crowded_samples == free.contacts.len());
        // The other contour's accepted contacts count too.
        let again = sample_contour_contacts(&mesh, &contour, &band, &SampleSettings { min_separation: 1.0, phase_mm: Some(0.0), keep_clear_of: &kept.contacts, ..settings }).unwrap();
        assert!(closest_pair(&again.contacts, &kept.contacts) >= 1.0);
        assert!(sample_contour_contacts(&mesh, &contour, &band, &SampleSettings { min_separation: f64::NAN, ..settings }).is_err());
    }
}
