//! Tube centre-lines: nodes with radius, and the Blender Fillet Curve (Poly mode).

use super::builder::MIN_LENGTH;
use crate::core::vec::{V3, add, dot, length, normalize_or_down, scale, sub};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveNode {
    pub point: V3,
    pub radius: f64,
}

/// Each interior corner becomes `count + 1` points on an arc of `radius` tangent to both segments
/// (limited to half of the shorter segment). Fillet points keep the corner radius.
pub fn fillet_polyline(nodes: &[CurveNode], radius: f64, count: usize) -> Vec<CurveNode> {
    let last = nodes.len() - 1;
    // Turn angle per point (0 at the ends and where a side has no length).
    let angles: Vec<f64> = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            if index == 0 || index == last {
                return 0.0;
            }
            let incoming = sub(node.point, nodes[index - 1].point);
            let outgoing = sub(nodes[index + 1].point, node.point);
            if length(incoming) < MIN_LENGTH || length(outgoing) < MIN_LENGTH {
                return 0.0;
            }
            dot(normalize_or_down(incoming), normalize_or_down(outgoing)).clamp(-1.0, 1.0).acos()
        })
        .collect();
    let displacement: Vec<f64> = angles.iter().map(|angle| radius * (angle / 2.0).tan()).collect();
    let mut out = vec![nodes[0]];
    for index in 1..last {
        let (previous, corner, next) = (nodes[index - 1], nodes[index], nodes[index + 1]);
        let angle = angles[index];
        if angle < 1e-6 {
            out.push(corner);
            continue;
        }
        // Limit Radius: each side is shared between the two corners in proportion to their
        // displacements, so an end point leaves its whole side to the corner.
        let share = |len: f64, other: f64| (len / (other + displacement[index])).max(0.0).min(1.0);
        let u = normalize_or_down(sub(corner.point, previous.point));
        let v = normalize_or_down(sub(next.point, corner.point));
        let limited = radius
            * share(length(sub(corner.point, previous.point)), displacement[index - 1])
                .min(share(length(sub(next.point, corner.point)), displacement[index + 1]));
        let tangent = limited * (angle / 2.0).tan();
        let w = normalize_or_down(sub(v, scale(u, dot(u, v))));
        let start = sub(corner.point, scale(u, tangent));
        let centre = add(start, scale(w, limited));
        for step in 0..=count {
            let phi = (step as f64 / count as f64) * angle;
            out.push(CurveNode {
                point: add(centre, add(scale(w, -limited * phi.cos()), scale(u, limited * phi.sin()))),
                radius: corner.radius,
            });
        }
    }
    out.push(nodes[last]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_polyline_is_unchanged_and_a_corner_becomes_an_arc() {
        let n = |x: f64, y: f64| CurveNode { point: [x, y, 0.0], radius: 1.0 };
        assert_eq!(fillet_polyline(&[n(0.0, 0.0), n(0.0, 1.0), n(0.0, 2.0)], 0.4, 3).len(), 3);
        let arc = fillet_polyline(&[n(0.0, 0.0), n(0.0, 2.0), n(2.0, 2.0)], 0.4, 3);
        assert_eq!(arc.len(), 2 + 4);
        assert!(arc[1].point[1] < 2.0 && arc[4].point[0] > 0.0);
    }
}
