//! MIXO_Label (port of TS `addLabel` + `layoutLabel`): the anchor is the raft vertex at or below Pad
//! Height (= Wall Height) nearest the bbox corner (Blender max x / min y = web max x / max z). The pad
//! is a frustum from the plate to Pad Height whose bottom is the letters' bbox plus 2 x Margin and
//! whose top is wider by Pad Height x tan(Wall Angle) on each side; the letters (Inter Regular,
//! String to Curves size = Letter Size, filled) are extruded Emboss Height up from the pad top.

use super::builder::MeshBuilder;
use super::font::font;
use super::plan::js_hypot;
use super::tags::{Part, Tag};
use super::vec::V3;
use crate::supports::settings::SupportSettings;

struct Placed {
    vertices: Vec<[f64; 2]>,
    triangles: Vec<[u32; 3]>,
}

/// Lays out text like Blender `String to Curves`: left aligned on the baseline, advancing by each
/// glyph's advance. Characters without a glyph are skipped.
fn layout(text: &str, size: f64) -> Vec<Placed> {
    let f = font();
    let mut placed = Vec::new();
    let mut pen = 0.0;
    for c in text.chars().flat_map(char::to_uppercase) {
        let Some(glyph) = f.glyphs.get(&c) else { continue };
        placed.push(Placed { vertices: glyph.vertices.iter().map(|[x, y]| [(pen + x) * size, y * size]).collect(), triangles: glyph.triangles.clone() });
        pen += glyph.advance;
    }
    placed
}

pub fn emit_label(builder: &mut MeshBuilder, candidates: &[V3], s: &SupportSettings, text: &str) {
    // Resin UV passes Size / cap ratio so a capital is exactly Letter Size tall.
    let glyphs = layout(text, s.label_size / font().cap_height);
    if glyphs.is_empty() {
        return;
    }
    let pad = s.raft_wall_height;
    let below: Vec<V3> = candidates.iter().copied().filter(|p| p[1] <= pad + 0.01).collect();
    if below.is_empty() {
        return;
    }
    let max_x = below.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
    let max_z = below.iter().map(|p| p[2]).fold(f64::NEG_INFINITY, f64::max);
    let reach = |p: &V3| js_hypot(&[p[0] - max_x, p[2] - max_z]);
    let mut anchor = below[0];
    for p in &below[1..] {
        if reach(p) < reach(&anchor) {
            anchor = *p;
        }
    }
    let all = || glyphs.iter().flat_map(|g| g.vertices.iter());
    let min_x = all().map(|v| v[0]).fold(f64::INFINITY, f64::min);
    let max_gx = all().map(|v| v[0]).fold(f64::NEG_INFINITY, f64::max);
    let min_y = all().map(|v| v[1]).fold(f64::INFINITY, f64::min);
    let max_gy = all().map(|v| v[1]).fold(f64::NEG_INFINITY, f64::max);
    let width = max_gx - min_x + 2.0 * s.label_margin;
    let depth = max_gy - min_y + 2.0 * s.label_margin;
    // Blender offsets are in its X/Y plane; web z is Blender -y.
    let cx = anchor[0] + s.label_offset_x;
    let cz = anchor[2] - s.label_offset_y;
    let flare = pad * (s.raft_wall_angle * std::f64::consts::PI / 180.0).tan();
    let rect = |half_x: f64, half_z: f64, y: f64| -> Vec<V3> {
        vec![[cx - half_x, y, cz - half_z], [cx + half_x, y, cz - half_z], [cx + half_x, y, cz + half_z], [cx - half_x, y, cz + half_z]]
    };
    builder.begin(Tag::new(Part::Label));
    builder.loft(&[rect(width / 2.0, depth / 2.0, 0.0), rect(width / 2.0 + flare, depth / 2.0 + flare, pad)], true);
    builder.end();
    // Glyph (gx, gy) in Blender's text plane maps to web (x, -y), centred on the anchor.
    let to_web = |[gx, gy]: [f64; 2], y: f64| -> V3 { [cx + gx - (min_x + max_gx) / 2.0, y, cz - (gy - (min_y + max_gy) / 2.0)] };
    for glyph in &glyphs {
        let bottom: Vec<V3> = glyph.vertices.iter().map(|v| to_web(*v, pad - 0.01)).collect();
        let top: Vec<V3> = glyph.vertices.iter().map(|v| to_web(*v, pad + s.label_height)).collect();
        builder.begin(Tag::new(Part::Label));
        builder.extrude_glyph(&bottom, &top, &glyph.triangles);
        builder.end();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::settings::default_values;

    #[test]
    fn digits_and_dash_lay_out_with_advancing_pen() {
        let g = layout("A-1", 1.0);
        assert_eq!(g.len(), 3);
        assert!(g[1].vertices[0][0] > g[0].vertices[0][0]);
    }

    #[test]
    fn label_adds_a_pad_and_one_solid_per_glyph() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let candidates: Vec<V3> = (0..8).map(|k| [f64::from(k) * 4.0, 0.0, 3.0]).collect();
        let mut builder = MeshBuilder::new();
        emit_label(&mut builder, &candidates, &s, "x-9");
        let mesh = builder.finish();
        assert_eq!(mesh.components.len(), 4);
        assert!(mesh.components.iter().all(|c| c.tag.part == Part::Label));
    }
}
