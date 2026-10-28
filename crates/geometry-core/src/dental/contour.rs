//! Outer contour: the two long sharp ridge chains of the aligner joined by two connector routes
//! into one closed loop.

use super::profiles::AlignerProfile;
use super::topology::{Component, Context, components, shortest_route};
use std::collections::{HashMap, HashSet};

pub struct OuterContour {
    /// Edge indices: ridge chains plus connectors.
    pub edges: Vec<usize>,
    pub ridge_edges: Vec<usize>,
    pub connector_edges: Vec<usize>,
    pub connector_lengths: [f64; 2],
}

/// An open edge chain: two endpoints, a path (edges == vertices - 1), every vertex of degree 1 or 2.
fn open_chain(context: &Context, component: &Component) -> bool {
    if component.endpoints.len() != 2 || component.edges.len() + 1 != component.vertices.len() {
        return false;
    }
    let mut degree: HashMap<u32, usize> = HashMap::new();
    for &edge in &component.edges {
        for index in [context.edges[edge].a, context.edges[edge].b] {
            *degree.entry(index).or_default() += 1;
        }
    }
    degree.values().all(|&count| count == 1 || count == 2)
}

pub fn outer_contour(context: &Context, profile: &AlignerProfile) -> Option<OuterContour> {
    let t = &profile.thresholds;
    // The two longest (mm) open sharp chains are the ridges. Closed sharp loops (a plate edge, a
    // cavity trim) are not ridge candidates, however long; a count of edges never ranks them.
    let candidates: Vec<Component> = components(context, &context.sharp_edges(t.sharp_angle_deg)).into_iter().filter(|c| open_chain(context, c)).collect();
    let (first, second) = (candidates.first()?, candidates.get(1)?);
    if first.length < t.ridge_first_min_mm || second.length < t.ridge_second_min_mm {
        return None;
    }
    let mut extent = [0.0; 2];
    for (axis, slot) in extent.iter_mut().enumerate() {
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        for &vertex in &first.vertices {
            let value = context.projected[vertex as usize][axis];
            low = low.min(value);
            high = high.max(value);
        }
        *slot = high - low;
    }
    if extent[0] / context.extent[0] < t.ridge_extent_min || extent[1] / context.extent[1] < t.ridge_extent_min {
        return None;
    }
    let base: HashSet<usize> = first.edges.iter().chain(&second.edges).copied().collect();
    let mut graph: HashMap<u32, Vec<(u32, f64)>> = HashMap::new();
    for edge in context.sharp_edges(t.connector_angle_deg) {
        if base.contains(&edge) {
            continue;
        }
        let e = &context.edges[edge];
        let length = context.edge_length(edge);
        graph.entry(e.a).or_default().push((e.b, length));
        graph.entry(e.b).or_default().push((e.a, length));
    }
    let mut choice: Option<(Vec<usize>, [f64; 2], f64)> = None;
    for pairing in [[0usize, 1], [1, 0]] {
        let routes: Vec<_> = pairing.iter().enumerate().map(|(at, &to)| shortest_route(&graph, first.endpoints[at], second.endpoints[to])).collect();
        let (Some(r0), Some(r1)) = (&routes[0], &routes[1]) else { continue };
        let mut all: Vec<usize> = first.edges.iter().chain(&second.edges).copied().collect();
        let mut member: HashSet<usize> = base.clone();
        for route in [r0, r1] {
            for pair in route.vertices.windows(2) {
                let edge = context.edge_between(pair[0], pair[1])?;
                if member.insert(edge) {
                    all.push(edge);
                }
            }
        }
        let mut degree: HashMap<u32, usize> = HashMap::new();
        for &edge in &all {
            for index in [context.edges[edge].a, context.edges[edge].b] {
                *degree.entry(index).or_default() += 1;
            }
        }
        if degree.values().any(|&count| count != 2) || all.len() != degree.len() {
            continue;
        }
        let lengths = [r0.length, r1.length];
        let total = lengths[0] + lengths[1];
        if choice.as_ref().is_none_or(|c| total < c.2) {
            choice = Some((all, lengths, total));
        }
    }
    let (all, connector_lengths, _) = choice?;
    let by_key = |edges: &mut Vec<usize>| edges.sort_by_key(|&e| context.edges[e].key);
    let mut ridge_edges: Vec<usize> = base.iter().copied().collect();
    let mut connector_edges: Vec<usize> = all.iter().copied().filter(|e| !base.contains(e)).collect();
    let mut edges = all;
    by_key(&mut edges);
    by_key(&mut ridge_edges);
    by_key(&mut connector_edges);
    Some(OuterContour { edges, ridge_edges, connector_edges, connector_lengths })
}
