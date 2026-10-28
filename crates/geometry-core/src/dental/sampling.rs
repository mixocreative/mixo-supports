//! Arclength sampling of contour contacts: one source face per sample, found by a locally
//! connected search inside the side band. Not a safety certificate (U7 owns collision checks).

use super::bands::{FaceGraph, face_graph};
use super::incidence::inspect_contour_incidence;
use super::mesh::{Mesh, MinHeap};
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
/// (default half a spacing), each contact searched within `max_search` mm (plus the tip line's
/// distance), and no contact closer (3D) than `min_separation` mm to an earlier one of this contour
/// or to `keep_clear_of` (the contacts already accepted on the other contour). `min_separation` 0
/// turns the rule off.
#[derive(Clone, Copy, Debug)]
pub struct SampleSettings<'a> {
    pub spacing: f64,
    pub max_search: f64,
    pub phase_mm: Option<f64>,
    pub min_separation: f64,
    pub keep_clear_of: &'a [ContourContact],
    /// Where on the band a tip goes. `None`: the band face nearest the sample point.
    pub tip_line: Option<TipLine<'a>>,
}

/// The area's middle line: tips go to the band face whose signed contour distance is closest to
/// `at` and that lies straight off the sample point (least sideways offset along the contour).
#[derive(Clone, Copy, Debug)]
pub struct TipLine<'a> {
    pub at: f64,
    /// Signed distance per face (`field::ContourField::signed`).
    pub signed: &'a [f64],
    /// The band crosses the edge: both sides may hold it, the better tip wins.
    pub either_side: bool,
}

impl TipLine<'_> {
    /// Sideways offset squared plus the miss from the line squared (mm squared).
    fn score(&self, face: u32, from_point: f64) -> f64 {
        let s = self.signed[face as usize];
        (from_point * from_point - s * s).max(0.0) + (s - self.at) * (s - self.at)
    }
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

/// The face graph with the contour cut: no walk crosses a face pair in `blocked`.
pub struct Walk<'a> {
    pub graph: &'a FaceGraph,
    pub blocked: &'a HashSet<(u32, u32)>,
}

/// The best band face reachable from `seed` within `max_distance` of `point`: (contact, its
/// distance from the point, its score). The lowest score wins, then the lower face id.
fn local_candidate(seed: usize, point: V3, walk: &Walk, face_data: &HashMap<u32, ContourContact>, used: &HashSet<u32>, max_distance: f64, line: Option<&TipLine>) -> Option<(ContourContact, f64, f64)> {
    let graph = walk.graph;
    let centre = |face: usize| -> V3 { [f64::from(graph.centroids[face * 3]), f64::from(graph.centroids[face * 3 + 1]), f64::from(graph.centroids[face * 3 + 2])] };
    let path_limit = max_distance * 2.0;
    let seed_path = distance(point, centre(seed));
    let mut pending: MinHeap<usize> = MinHeap::new();
    pending.push(seed_path, seed);
    let mut distances: HashMap<usize, f64> = HashMap::from([(seed, seed_path)]);
    let mut closest: Option<(ContourContact, f64, f64)> = None;
    while let Some((path, face)) = pending.pop() {
        if distances.get(&face) != Some(&path) {
            continue;
        }
        if let Some(contact) = face_data.get(&(face as u32)).filter(|_| !used.contains(&(face as u32))) {
            let from_contour = distance(point, contact.position);
            let score = line.map_or(from_contour, |l| l.score(contact.face, from_contour));
            if from_contour <= max_distance && closest.as_ref().is_none_or(|c| score < c.2 || (score == c.2 && contact.face < c.0.face)) {
                closest = Some((*contact, from_contour, score));
            }
        }
        for corner in 0..3 {
            let next = graph.neighbors[face * 3 + corner];
            if next < 0 || walk.blocked.contains(&((face as u32).min(next as u32), (face as u32).max(next as u32))) {
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
            pending.push(next_path, next);
        }
    }
    closest
}

/// Samples contacts along one contour (see [`SampleSettings`]), building the face graph itself (an
/// open mesh is allowed). `Err` carries the oracle's reason string.
pub fn sample_contour_contacts(mesh: &Mesh, contour: &[u32], side_band: &[u8], settings: &SampleSettings) -> Result<Sampled, &'static str> {
    check_settings(mesh, side_band, settings)?;
    let pairs = inspect_contour_incidence(mesh.vertex_count(), mesh.indices, contour).map_err(|_| "invalid-contour")?;
    let graph = face_graph(mesh, false).ok_or("empty-or-invalid-band")?;
    let blocked = pairs.chunks_exact(2).map(|p| (p[0].min(p[1]), p[0].max(p[1]))).collect();
    sample_with(mesh, contour, &pairs, &Walk { graph: &graph, blocked: &blocked }, side_band, settings)
}

fn check_settings(mesh: &Mesh, side_band: &[u8], settings: &SampleSettings) -> Result<(), &'static str> {
    let SampleSettings { spacing, max_search, phase_mm, min_separation, tip_line, .. } = *settings;
    let phase = phase_mm.unwrap_or(spacing / 2.0);
    let line_ok = tip_line.is_none_or(|l| l.at.is_finite() && l.signed.len() == mesh.face_count());
    if !spacing.is_finite() || spacing <= 0.0 || !max_search.is_finite() || max_search <= 0.0 || !phase.is_finite() || phase < 0.0 || phase >= spacing || !(min_separation >= 0.0) || !min_separation.is_finite() || side_band.len() != mesh.face_count() || !line_ok {
        return Err("invalid-sampling-input");
    }
    Ok(())
}

/// Samples one contour whose incident face pairs (`pairs`) and cut face graph (`walk`) are known.
pub fn sample_with(mesh: &Mesh, contour: &[u32], pairs: &[u32], walk: &Walk, side_band: &[u8], settings: &SampleSettings) -> Result<Sampled, &'static str> {
    check_settings(mesh, side_band, settings)?;
    let SampleSettings { spacing, max_search, phase_mm, min_separation, keep_clear_of, tip_line } = *settings;
    let phase = phase_mm.unwrap_or(spacing / 2.0);
    let ordered = ordered_vertices(contour);
    let faces = band_faces(mesh, side_band);
    let (Some(ordered), Some(faces)) = (ordered, faces) else { return Err("empty-or-invalid-band") };
    if faces.is_empty() {
        return Err("empty-or-invalid-band");
    }
    let reach = max_search + tip_line.map_or(0.0, |l| l.at.abs());
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
        let one = local_candidate(segment.sides[0] as usize, point, walk, &face_data, &used, reach, tip_line.as_ref());
        let two = local_candidate(segment.sides[1] as usize, point, walk, &face_data, &used, reach, tip_line.as_ref());
        // Without a unique local side, the band has not established which surface is intended,
        // unless the band itself crosses the edge (then the better tip wins).
        let chosen = match (one, two) {
            (Some(c), None) | (None, Some(c)) => Some(c),
            (Some(a), Some(b)) if tip_line.is_some_and(|l| l.either_side) => Some(if b.2 < a.2 || (b.2 == a.2 && b.0.face < a.0.face) { b } else { a }),
            _ => None,
        };
        match chosen {
            None => skipped += 1,
            Some((contact, ..)) if crowds(contact.position, &contacts) => crowded += 1,
            Some((contact, from, _)) => {
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
        let settings = SampleSettings { spacing: 1.0, max_search: 1.0, phase_mm: None, min_separation: 0.0, keep_clear_of: &[], tip_line: None };
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

    #[test]
    fn a_tip_line_puts_tips_on_the_band_s_middle_not_on_its_near_edge() {
        let (positions, indices, contour, band) = hairpin();
        let mesh = Mesh::new(&positions, &indices);
        // Distance inside the 0.6 mm wide hairpin from its lower side (y = 0.6).
        let signed: Vec<f64> = (0..mesh.face_count()).map(|f| mesh.face_points(f).iter().map(|p| p[1]).sum::<f64>() / 3.0 - 0.6).collect();
        let base = SampleSettings { spacing: 1.0, max_search: 1.0, phase_mm: None, min_separation: 0.0, keep_clear_of: &[], tip_line: None };
        let nearest = sample_contour_contacts(&mesh, &contour, &band, &base).unwrap();
        let line = TipLine { at: 0.3, signed: &signed, either_side: false };
        let middle = sample_contour_contacts(&mesh, &contour, &band, &SampleSettings { tip_line: Some(line), ..base }).unwrap();
        let off_middle = |s: &Sampled| s.contacts.iter().map(|c| (c.position[1] - 0.9).abs()).fold(0.0, f64::max);
        assert!(off_middle(&nearest) > 0.2, "without a line the tips hug the contour");
        assert!(off_middle(&middle) < 0.1, "with it they sit on the middle line");
        assert!(sample_contour_contacts(&mesh, &contour, &band, &SampleSettings { tip_line: Some(TipLine { signed: &[], ..line }), ..base }).is_err());
    }
}
