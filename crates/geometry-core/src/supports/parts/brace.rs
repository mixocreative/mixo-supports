//! Cross-bracing between neighbouring columns (SLASG_Truss2). Port of TS `trussSegments` / `addBraces`.

use super::builder::MeshBuilder;
use super::tags::{BraceKey, Part, Tag};
use crate::core::vec::V3;
use crate::supports::settings::SupportSettings;
use std::collections::BTreeSet;

/// A plate-standing pillar, from its foot top up to where its tube starts (mm).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Column {
    pub x: f64,
    pub z: f64,
    pub bottom: f64,
    pub top: f64,
}

/// Pillars sorted by Blender x + y; each pairs with its nearest later pillar. A valid pair (distance
/// in (0.9 Middle diameter, Distance Limit], taller top above Minimum Height) gets a zigzag of
/// braces; braces reaching above a pillar's top minus Top Spacing are dropped.
pub fn truss_segments(columns: &[Column], s: &SupportSettings) -> Vec<(V3, V3)> {
    let mut order: Vec<(usize, &Column)> = columns.iter().enumerate().collect();
    order.sort_by(|a, b| (a.1.x - a.1.z).total_cmp(&(b.1.x - b.1.z)).then(a.0.cmp(&b.0)));
    let rise = |d: f64| d * (std::f64::consts::PI / 2.0 - s.truss_angle * std::f64::consts::PI / 180.0).tan();
    let mut segments = Vec::new();
    for (i, (_, own)) in order.iter().enumerate() {
        let mut partner: Option<&Column> = None;
        let mut distance = f64::INFINITY;
        for (_, other) in &order[i + 1..] {
            let d = crate::core::jsnum::hypot(&[other.x - own.x, other.z - own.z]);
            if d < distance {
                distance = d;
                partner = Some(other);
            }
        }
        let Some(partner) = partner else { continue };
        let top = own.top.max(partner.top);
        if !(distance > 0.9 * s.pillar_diameter && top > s.truss_min_height && distance <= s.truss_distance_limit) {
            continue;
        }
        let step = rise(distance);
        let rows = (top / (step + s.truss_spacing)).ceil() + 1.0;
        let mut y = 0.0;
        while y < rows {
            let odd = y % 2.0;
            let partner_y = partner.bottom + (y + odd) * step + s.truss_spacing * (y + 1.0);
            let own_y = own.bottom + (y + 1.0 - odd) * step + s.truss_spacing * (y + 1.0);
            y += 1.0;
            if partner_y > partner.top - s.truss_top_spacing || own_y > own.top - s.truss_top_spacing {
                continue;
            }
            segments.push(([partner.x, partner_y, partner.z], [own.x, own_y, own.z]));
        }
    }
    segments
}

/// The identity of the segment `from`-`to` (built on the plate at 0, raised by `plate_y`).
pub fn brace_key(from: V3, to: V3, plate_y: f64) -> BraceKey {
    let end = |p: V3| [(p[0] * 100.0).round() as i32, ((p[1] + plate_y) * 100.0).round() as i32, (p[2] * 100.0).round() as i32];
    let (a, b) = (end(from), end(to));
    let (a, b) = if a <= b { (a, b) } else { (b, a) };
    [a[0], a[1], a[2], b[0], b[1], b[2]]
}

/// Builds the braces, except the segments in `pruned` (the repair left them out where they crossed the model).
pub fn emit_braces(builder: &mut MeshBuilder, columns: &[Column], s: &SupportSettings, segments: usize, pruned: &BTreeSet<BraceKey>) {
    let radius = s.truss_diameter / 2.0;
    for (from, to) in truss_segments(columns, s) {
        let key = brace_key(from, to, s.plate_y);
        if pruned.contains(&key) {
            continue;
        }
        builder.begin(Tag::new(Part::Brace).brace(key));
        builder.frustum(from, to, radius, radius, segments);
        builder.end();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::settings::default_values;

    #[test]
    fn two_neighbouring_tall_pillars_get_a_zigzag_and_far_ones_do_not() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let near = [Column { x: 0.0, z: 0.0, bottom: 1.0, top: 20.0 }, Column { x: 4.0, z: 0.0, bottom: 1.0, top: 20.0 }];
        let braces = truss_segments(&near, &s);
        assert!(!braces.is_empty());
        assert!(braces.iter().all(|(a, b)| a[1] <= 20.0 && b[1] <= 20.0));
        let far = [near[0], Column { x: 400.0, ..near[1] }];
        assert!(truss_segments(&far, &s).is_empty());
        assert!(truss_segments(&near[..1], &s).is_empty());
    }

    #[test]
    fn a_brace_key_is_the_endpoints_in_centimillimetres_ordered_and_raised_by_the_plate() {
        assert_eq!(brace_key([4.0, 3.2, 0.0], [0.0, 7.2, 0.0], 0.0), [0, 720, 0, 400, 320, 0]);
        assert_eq!(brace_key([0.0, 7.2, 0.0], [4.0, 3.2, 0.0], 0.0), brace_key([4.0, 3.2, 0.0], [0.0, 7.2, 0.0], 0.0));
        assert_eq!(brace_key([0.0, 1.0, 0.0], [0.004, 1.0, 0.0], 0.5), [0, 150, 0, 0, 150, 0]);
    }
}
