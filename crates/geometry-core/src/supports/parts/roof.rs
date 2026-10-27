//! Roof and Cage as Resin UV builds them with SLASG's multi-storey machinery (SLASG_Column,
//! SLASG_Ceiling with the Centroid brace method); port of TS `buildRoofCage`. `raw` is the raft's
//! raw perimeter loop (web coordinates, y = height); `model_top` the model's highest point.
//!
//! Stack: roof H = model top + Roof Gap split into n = max(1, round(H / d)) bands, d = perimeter
//! length / Column Count; cage spacing = Ring Spacing, ceil((top + Height Above Model) / spacing) + 1
//! levels. Columns stand at Column Count points spaced evenly along the raw perimeter.

use super::builder::MeshBuilder;
use super::plan::{P2, corner_bisectors, js_hypot, normalize2};
use super::tags::{Part, Tag};
use super::vec::{V3, add, scale};
use crate::supports::settings::{RoofMode, SupportSettings};

pub struct Bar {
    pub from: V3,
    pub to: V3,
    pub radius: f64,
    pub part: Part,
}

pub struct Sweep {
    pub polygon: Vec<V3>,
    pub offset: V3,
    pub part: Part,
}

pub struct Band {
    pub bottom: Vec<V3>,
    pub top: Vec<V3>,
    pub normals: Vec<V3>,
    pub thickness: f64,
}

pub struct Ring {
    pub points: Vec<V3>,
    pub radius: f64,
}

#[derive(Default)]
pub struct RoofGeometry {
    pub bars: Vec<Bar>,
    pub sweeps: Vec<Sweep>,
    pub bands: Vec<Band>,
    pub rings: Vec<Ring>,
}

fn distance(a: V3, b: V3) -> f64 {
    js_hypot(&[a[0] - b[0], a[1] - b[1], a[2] - b[2]])
}

/// `Math.round` (ties toward +infinity).
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

pub fn build_roof_cage(raw: &[V3], model_top: f64, s: &SupportSettings) -> RoofGeometry {
    let mut geometry = RoofGeometry::default();
    if s.roof_mode == RoofMode::Off || raw.len() < 3 {
        return geometry;
    }
    let cage = s.roof_mode == RoofMode::Cage;
    let length: f64 = raw.iter().enumerate().map(|(i, p)| distance(*p, raw[(i + 1) % raw.len()])).sum();

    let height = model_top + s.roof_gap;
    let (spacing, levels) = if cage {
        let spacing = s.cage_pitch;
        (spacing, ((model_top + s.cage_top_gap) / spacing).ceil() + 1.0)
    } else {
        let bands = js_round(height / (length / s.column_count)).max(1.0);
        (height / bands, bands + 1.0)
    };

    let count = s.column_count as usize;
    let columns: Vec<V3> = (0..count).map(|i| sample_closed(raw, (i as f64 / s.column_count) * length)).collect();
    let column_radius = s.column_diameter / 2.0;
    for base in &columns {
        geometry.bars.push(Bar { from: *base, to: [base[0], base[1] + (levels - 1.0) * spacing, base[2]], radius: column_radius, part: Part::Column });
    }
    if s.diagonal_enabled {
        for (i, base) in columns.iter().enumerate() {
            for neighbour in [columns[(i + columns.len() - 1) % columns.len()], columns[(i + 1) % columns.len()]] {
                let mid = [(base[0] + neighbour[0]) / 2.0, (base[1] + neighbour[1]) / 2.0, (base[2] + neighbour[2]) / 2.0];
                let reach = 2.0 * distance(mid, *base);
                let flat = js_hypot(&[mid[0] - base[0], mid[2] - base[2]]);
                let dir: P2 = if flat > 1e-9 { [(mid[0] - base[0]) / flat, (mid[2] - base[2]) / flat] } else { [1.0, 0.0] };
                for level in 0..(levels as usize - 1) {
                    let lift = level as f64 * spacing + s.diagonal_diameter;
                    geometry.bars.push(Bar {
                        from: [base[0] + dir[0] * reach, base[1] + lift, base[2] + dir[1] * reach],
                        to: [base[0], base[1] + spacing - s.column_diameter + lift, base[2]],
                        radius: s.diagonal_diameter / 2.0,
                        part: Part::CrossBar,
                    });
                }
            }
        }
    }

    if cage {
        let flat: Vec<V3> = raw.iter().map(|p| [p[0], 0.0, p[2]]).collect();
        for level in 1..levels as usize {
            geometry.rings.push(Ring { points: flat.iter().map(|p| [p[0], level as f64 * spacing, p[2]]).collect(), radius: s.cage_ring_diameter / 2.0 });
        }
        return geometry;
    }

    // Roof, instanced at the top level H. Fill Curve works in plan, so the polygon sits at z = 0.
    let polygon: Vec<P2> = columns.iter().map(|p| [p[0], p[2]]).collect();
    let bisectors = corner_bisectors(&polygon);
    let grown = |amount: f64| -> Vec<P2> { polygon.iter().enumerate().map(|(i, p)| [p[0] - bisectors[i][0] * amount, p[1] - bisectors[i][1] * amount]).collect() };
    let thickness = s.storey_floor_thickness;
    let top = height;
    if s.storey_enclose_ceiling && thickness > 0.0 {
        geometry.sweeps.push(Sweep { polygon: grown(column_radius).iter().map(|p| [p[0], top, p[1]]).collect(), offset: [0.0, thickness, 0.0], part: Part::Roof });
    }
    let brace = s.brace_thickness;
    let lift = if s.storey_enclose_ceiling { 0.0 } else { thickness };
    let points = grown((s.column_diameter - brace) / 2.0);
    let centre: P2 = [points.iter().map(|p| p[0]).sum::<f64>() / points.len() as f64, points.iter().map(|p| p[1]).sum::<f64>() / points.len() as f64];
    let extent = |axis: usize| raw.iter().map(|p| p[axis]).fold(f64::NEG_INFINITY, f64::max) - raw.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min);
    let diagonal = js_hypot(&[extent(0), extent(1), extent(2)]);
    let angle = (s.brace_angle * std::f64::consts::PI / 180.0).min((s.roof_gap * 0.8).atan2(diagonal * 0.5));
    let tan = angle.tan();

    // Radial plates: from the lowered column point to the centre, up to the roof.
    for [x, z] in &points {
        let d = js_hypot(&[centre[0] - x, centre[1] - z]);
        let low: V3 = [*x, top - d * tan, *z];
        let outline: Vec<V3> = if lift > 0.0 {
            vec![low, [centre[0], top, centre[1]], [centre[0], top + lift, centre[1]], [*x, top + lift, *z]]
        } else {
            vec![low, [centre[0], top, centre[1]], [*x, top, *z]]
        };
        let along: P2 = [centre[0] - x, centre[1] - z];
        let n = normalize2([-along[1], along[0]]);
        geometry.sweeps.push(Sweep {
            polygon: outline.iter().map(|p| [p[0] - n[0] * brace / 2.0, p[1], p[2] - n[1] * brace / 2.0]).collect(),
            offset: [n[0] * brace, 0.0, n[1] * brace],
            part: Part::RoofBrace,
        });
    }

    // Concentric rings (Centroid method): mix of lowered points and centre, subdivided once.
    let rings = s.brace_concentric as usize;
    for i in 0..rings {
        let f = i as f64 / (rings as f64 - 0.5);
        let ring: Vec<V3> = points
            .iter()
            .map(|[x, z]| {
                let d = js_hypot(&[centre[0] - x, centre[1] - z]);
                [x + (centre[0] - x) * f, -d * tan * (1.0 - f), z + (centre[1] - z) * f]
            })
            .collect();
        let mut loop_: Vec<(V3, bool)> = Vec::new();
        for (j, point) in ring.iter().enumerate() {
            let next = ring[(j + 1) % ring.len()];
            loop_.push((*point, true));
            loop_.push(([(point[0] + next[0]) / 2.0, (point[1] + next[1]) / 2.0, (point[2] + next[2]) / 2.0], false));
        }
        let shifted: Vec<V3> = loop_.iter().map(|(p, _)| [p[0], p[1] + brace * tan, p[2]]).collect();
        let n = shifted.len();
        let bottom: Vec<V3> = shifted
            .iter()
            .enumerate()
            .map(|(j, point)| {
                let (previous, next) = (shifted[(j + n - 1) % n], shifted[(j + 1) % n]);
                let edge = (distance(*point, previous) + distance(*point, next)) / 2.0;
                let y = if loop_[j].1 { 0.0 } else { point[1].max(0.0 - edge * tan) };
                [point[0], top + y, point[2]]
            })
            .collect();
        let roof_line: Vec<V3> = bottom.iter().map(|p| [p[0], top + lift, p[2]]).collect();
        geometry.bands.push(Band { normals: band_normals(&bottom), bottom, top: roof_line, thickness: brace });
    }
    geometry
}

/// Point normals of a closed vertical band, mitered: averaged face normals scaled by 1/cos(half angle).
fn band_normals(points: &[V3]) -> Vec<V3> {
    let face_normal = |a: V3, b: V3| normalize2([b[2] - a[2], -(b[0] - a[0])]);
    let n = points.len();
    (0..n)
        .map(|j| {
            let point = points[j];
            let a = face_normal(points[(j + n - 1) % n], point);
            let b = face_normal(point, points[(j + 1) % n]);
            let average = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            let length = js_hypot(&average);
            if length < 1e-9 {
                return [a[0], 0.0, a[1]];
            }
            let unit = normalize2(average);
            let miter = 1.0 / length;
            [unit[0] * miter, 0.0, unit[1] * miter]
        })
        .collect()
}

/// Point at arc length `at` along a closed polyline.
fn sample_closed(points: &[V3], at: f64) -> V3 {
    let mut travelled = 0.0;
    for index in 0..points.len() {
        let (a, b) = (points[index], points[(index + 1) % points.len()]);
        let segment = distance(a, b);
        if travelled + segment >= at - 1e-12 {
            let t = if segment == 0.0 { 0.0 } else { (at - travelled) / segment };
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
        travelled += segment;
    }
    points[0]
}

/// Emits the roof or cage solids in the TS order: bars, sweeps, bands, rings.
pub fn emit_roof_cage(builder: &mut MeshBuilder, g: &RoofGeometry) {
    // Realizer.003 always tubes the column lines at 12 sides.
    for bar in &g.bars {
        builder.begin(Tag::new(bar.part));
        builder.frustum(bar.from, bar.to, bar.radius, bar.radius, 12);
        builder.end();
    }
    for sweep in &g.sweeps {
        builder.begin(Tag::new(sweep.part));
        builder.sweep(&sweep.polygon, sweep.offset);
        builder.end();
    }
    for band in &g.bands {
        let shift = |points: &[V3], sign: f64| -> Vec<V3> { points.iter().enumerate().map(|(i, p)| add(*p, scale(band.normals[i], sign * band.thickness / 2.0))).collect() };
        builder.begin(Tag::new(Part::RoofBrace));
        builder.loft(&[shift(&band.bottom, 1.0), shift(&band.top, 1.0), shift(&band.top, -1.0), shift(&band.bottom, -1.0)], false);
        builder.end();
    }
    for ring in &g.rings {
        builder.begin(Tag::new(Part::CageRing));
        builder.closed_tube(&ring.points, ring.radius, 12);
        builder.end();
    }
}
