//! Mode B: the procedural arch (SPEC.md "Mode B: procedural arch"). Build frame: x left–right,
//! y toward the incisors, z up (crowns +z, gum line z ≈ 0, palate z < 0).

use crate::cases::{ArchKind, ArchParams};
use crate::geom::{Label, Solid, V3, add, cross, dot, length, scale, sub, unit, vertex_normals};
use crate::rng::SplitMix64;
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

/// Groove depth g.
const GROOVE: f64 = 0.08;
/// Plate depth cap V (mm) and the factor in V = min(5, 0.09 R²).
const VAULT: f64 = 5.0;
const VAULT_FACTOR: f64 = 0.09;
/// Window corner radius.
const WINDOW_CORNER: f64 = 4.0;
/// Distance of the plate posts from the distal ends.
const POST: f64 = 10.0;
/// Rounded wall: quads over 180°.
const ROUND_STEPS: usize = 8;

/// The finished mesh plus what the unit tests inspect.
#[cfg_attr(not(test), allow(dead_code))]
pub struct Built {
    pub solid: Solid,
    pub estimate: usize,
    pub windows: usize,
    /// Buccal trim vertices and their z_b(s).
    pub buccal: Vec<(u32, f64)>,
    /// Every vertex on the wall arcs (or cut edges) of the outer loop's corner vertices.
    pub corner_wall_vertices: HashSet<u32>,
    /// Every vertex on the window rim's wall arcs.
    pub window_wall_vertices: HashSet<u32>,
    /// Plate join edges on F and G (vertex pairs).
    pub join_edges: Vec<(u32, u32)>,
}

// ---------------------------------------------------------------- centreline

struct Bezier([[f64; 2]; 4]);

impl Bezier {
    fn point(&self, t: f64) -> [f64; 2] {
        let p = &self.0;
        let u = 1.0 - t;
        let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
        [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]]
    }
    fn d1(&self, t: f64) -> [f64; 2] {
        let p = &self.0;
        let u = 1.0 - t;
        std::array::from_fn(|i| 3.0 * u * u * (p[1][i] - p[0][i]) + 6.0 * u * t * (p[2][i] - p[1][i]) + 3.0 * t * t * (p[3][i] - p[2][i]))
    }
    fn d2(&self, t: f64) -> [f64; 2] {
        let p = &self.0;
        let u = 1.0 - t;
        std::array::from_fn(|i| 6.0 * u * (p[2][i] - 2.0 * p[1][i] + p[0][i]) + 6.0 * t * (p[3][i] - 2.0 * p[2][i] + p[1][i]))
    }
    fn speed(&self, t: f64) -> f64 {
        let d = self.d1(t);
        d[0].hypot(d[1])
    }
}

const TABLE: usize = 4096;

/// C(s): the right half is the Bézier from the front (t = 0) to the right distal end; the left
/// half is its mirror in x. s = 0 at the left distal end, s = L at the right one.
pub struct Centreline {
    bezier: Bezier,
    cumulative: Vec<f64>,
    half: f64,
}

fn gauss5(f: impl Fn(f64) -> f64, a: f64, b: f64) -> f64 {
    const X: [f64; 5] = [-0.906_179_845_938_664, -0.538_469_310_105_683_1, 0.0, 0.538_469_310_105_683_1, 0.906_179_845_938_664];
    const W: [f64; 5] = [0.236_926_885_056_189_1, 0.478_628_670_499_366_5, 0.568_888_888_888_888_9, 0.478_628_670_499_366_5, 0.236_926_885_056_189_1];
    let (mid, half) = ((a + b) / 2.0, (b - a) / 2.0);
    X.iter().zip(W).map(|(x, w)| w * f(mid + half * x)).sum::<f64>() * half
}

impl Centreline {
    pub fn new(w: f64, d: f64, wf: f64) -> Self {
        let bezier = Bezier([[0.0, d], [wf / 2.0, d], [w / 2.0, 0.55 * d], [w / 2.0, 0.0]]);
        let mut cumulative = vec![0.0; TABLE + 1];
        for k in 0..TABLE {
            let (a, b) = (k as f64 / TABLE as f64, (k + 1) as f64 / TABLE as f64);
            cumulative[k + 1] = cumulative[k] + gauss5(|t| bezier.speed(t), a, b);
        }
        let half = cumulative[TABLE];
        Self { bezier, cumulative, half }
    }

    pub fn length(&self) -> f64 {
        2.0 * self.half
    }

    fn parameter(&self, along: f64) -> f64 {
        let along = along.clamp(0.0, self.half);
        let k = self.cumulative.partition_point(|&c| c <= along).saturating_sub(1).min(TABLE - 1);
        let (t0, t1) = (k as f64 / TABLE as f64, (k + 1) as f64 / TABLE as f64);
        let target = along - self.cumulative[k];
        let mut t = (t0 + target / self.bezier.speed(t0)).clamp(t0, t1);
        for _ in 0..4 {
            let error = gauss5(|x| self.bezier.speed(x), t0, t) - target;
            t = (t - error / self.bezier.speed(t)).clamp(t0, t1);
        }
        t
    }

    /// (C(s), T(s)) in the xy plane.
    pub fn eval(&self, s: f64) -> ([f64; 2], [f64; 2]) {
        if s >= self.half {
            let t = self.parameter(s - self.half);
            let d = self.bezier.d1(t);
            let size = d[0].hypot(d[1]);
            (self.bezier.point(t), [d[0] / size, d[1] / size])
        } else {
            let t = self.parameter(self.half - s);
            let q = self.bezier.point(t);
            let d = self.bezier.d1(t);
            let size = d[0].hypot(d[1]);
            ([-q[0], q[1]], [d[0] / size, -d[1] / size])
        }
    }

    /// Smallest curvature radius along the centreline (sampled; both halves are mirror images).
    pub fn min_radius(&self) -> f64 {
        (0..=10_000)
            .map(|k| {
                let t = k as f64 / 10_000.0;
                let (a, b) = (self.bezier.d1(t), self.bezier.d2(t));
                let bend = (a[0] * b[1] - a[1] * b[0]).abs();
                if bend == 0.0 { f64::INFINITY } else { a[0].hypot(a[1]).powi(3) / bend }
            })
            .fold(f64::INFINITY, f64::min)
    }
}

// --------------------------------------------------------------------- teeth

/// Distal to front: M2, M1, P2, P1, C, L, central.
fn tooth_table(arch: ArchKind) -> ([f64; 7], [f64; 7], [f64; 7]) {
    match arch {
        ArchKind::Upper => ([10.5, 10.0, 7.0, 7.0, 7.8, 6.5, 8.5], [10.5, 10.5, 9.0, 9.0, 8.0, 7.0, 7.0], [7.0, 7.0, 8.0, 8.0, 10.0, 9.0, 10.0]),
        ArchKind::Lower => ([11.0, 10.5, 7.0, 7.0, 7.0, 6.0, 5.5], [10.5, 10.5, 8.0, 7.5, 7.0, 6.0, 6.0], [7.0, 7.0, 8.0, 8.0, 10.0, 9.0, 9.0]),
    }
}

pub struct Teeth {
    bounds: [f64; 15],
    b: [f64; 14],
    h: [f64; 14],
}

impl Teeth {
    pub fn new(arch: ArchKind, total: f64) -> Self {
        let (widths, b7, h7) = tooth_table(arch);
        let order: [usize; 14] = std::array::from_fn(|k| if k < 7 { k } else { 13 - k });
        let factor = total / (2.0 * widths.iter().sum::<f64>());
        let mut bounds = [0.0; 15];
        for k in 0..14 {
            bounds[k + 1] = bounds[k] + widths[order[k]] * factor;
        }
        bounds[14] = total;
        Self { bounds, b: order.map(|k| b7[k]), h: order.map(|k| h7[k]) }
    }

    pub fn max_b(&self) -> f64 {
        self.b.iter().cloned().fold(0.0, f64::max)
    }

    /// (B blended, H blended, τ) at s.
    pub fn at(&self, s: f64) -> (f64, f64, f64) {
        let k = (self.bounds.partition_point(|&b| b <= s).saturating_sub(1)).min(13);
        let tau = ((s - self.bounds[k]) / (self.bounds[k + 1] - self.bounds[k])).clamp(0.0, 1.0);
        let blend = |values: &[f64; 14]| -> f64 {
            let f = |x: f64| (1.0 - (PI * x / 4.0).cos()) / 2.0;
            if k >= 1 && s - self.bounds[k] < 2.0 {
                let x = s - self.bounds[k] + 2.0;
                values[k - 1] + f(x) * (values[k] - values[k - 1])
            } else if k + 1 <= 13 && self.bounds[k + 1] - s < 2.0 {
                let x = s - self.bounds[k + 1] + 2.0;
                values[k] + f(x) * (values[k + 1] - values[k])
            } else {
                values[k]
            }
        };
        (blend(&self.b), blend(&self.h), tau)
    }
}

// ------------------------------------------------------------------- profile

#[derive(Clone, Copy)]
enum Segment {
    Line([f64; 2], [f64; 2]),
    Arc { centre: [f64; 2], radius: f64, from: f64, to: f64 },
}

impl Segment {
    fn length(&self) -> f64 {
        match *self {
            Segment::Line(a, b) => (b[0] - a[0]).hypot(b[1] - a[1]),
            Segment::Arc { radius, from, to, .. } => radius * (to - from).abs(),
        }
    }
    fn at(&self, x: f64) -> [f64; 2] {
        let size = self.length();
        let f = if size == 0.0 { 0.0 } else { x / size };
        match *self {
            Segment::Line(a, b) => [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])],
            Segment::Arc { centre, radius, from, to } => {
                let angle = from + f * (to - from);
                [centre[0] + radius * angle.cos(), centre[1] + radius * angle.sin()]
            }
        }
    }
}

/// The fitting-surface profile at one s, in the (N, Z) plane, by increasing u.
pub struct Profile {
    segments: Vec<Segment>,
    end: [f64; 2],
    pub length: f64,
}

impl Profile {
    pub fn new(b: f64, h: f64, z_b: f64, plate: bool) -> Self {
        let hb = b / 2.0;
        let mut segments = vec![
            Segment::Line([hb, z_b], [hb, h - 2.0]),
            Segment::Arc { centre: [hb - 2.0, h - 2.0], radius: 2.0, from: 0.0, to: PI / 2.0 },
            Segment::Line([hb - 2.0, h], [-hb + 2.0, h]),
            Segment::Arc { centre: [-hb + 2.0, h - 2.0], radius: 2.0, from: PI / 2.0, to: PI },
        ];
        let end = if plate {
            segments.push(Segment::Line([-hb, h - 2.0], [-hb, 3.0]));
            segments.push(Segment::Arc { centre: [-hb - 3.0, 3.0], radius: 3.0, from: 0.0, to: -PI / 2.0 });
            [-hb - 3.0, 0.0]
        } else {
            segments.push(Segment::Line([-hb, h - 2.0], [-hb, z_b]));
            [-hb, z_b]
        };
        let length = segments.iter().map(Segment::length).sum();
        Self { segments, end, length }
    }

    /// The point at profile arclength u (exact at both ends).
    pub fn at(&self, u: f64) -> [f64; 2] {
        if u >= self.length {
            return self.end;
        }
        let mut left = u.max(0.0);
        for segment in &self.segments {
            let size = segment.length();
            if left <= size {
                return segment.at(left);
            }
            left -= size;
        }
        self.end
    }
}

// ---------------------------------------------------------------- the builder

struct Column {
    c: [f64; 2],
    t: [f64; 2],
    profile: Profile,
    z_b: f64,
}

fn column(line: &Centreline, teeth: &Teeth, p: &ArchParams, s: f64) -> Column {
    let (c, t) = line.eval(s);
    let (b_tooth, h, tau) = teeth.at(s);
    let cosine = (2.0 * PI * tau).cos();
    let b = b_tooth * (1.0 - GROOVE * (1.0 - cosine) / 2.0);
    let z_b = p.m + p.a_g * cosine;
    Column { c, t, profile: Profile::new(b, h, z_b, p.plate), z_b }
}

fn place(col: &Column, nz: [f64; 2]) -> V3 {
    let normal = [-col.t[1], col.t[0]];
    [col.c[0] + nz[0] * normal[0], col.c[1] + nz[0] * normal[1], nz[1]]
}

/// Splits a quad along its shorter diagonal.
fn split(q: [u32; 4], positions: &[V3]) -> [[u32; 3]; 2] {
    let p = |i: u32| positions[i as usize];
    if length(sub(p(q[0]), p(q[2]))) <= length(sub(p(q[1]), p(q[3]))) {
        [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]
    } else {
        [[q[0], q[1], q[3]], [q[1], q[2], q[3]]]
    }
}

/// Signed distance from the rounded-rectangle window outline (centre at the origin).
fn window_sdf(p: [f64; 2], half: [f64; 2], radius: f64) -> f64 {
    let q = [p[0].abs() - (half[0] - radius), p[1].abs() - (half[1] - radius)];
    let outside = q[0].max(0.0).hypot(q[1].max(0.0));
    outside + q[0].max(q[1]).min(0.0) - radius
}

/// Where the ray from the window centre along `direction` meets the window outline.
fn window_hit(direction: [f64; 2], half: [f64; 2], radius: f64) -> f64 {
    let (mut lo, mut hi) = (0.0, half[0].hypot(half[1]) + 1.0);
    for _ in 0..100 {
        let mid = (lo + hi) / 2.0;
        if window_sdf([direction[0] * mid, direction[1] * mid], half, radius) < 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

/// Smallest |normal curvature radius| along a polyline of F, with its location.
fn normal_curvature_check(points: &[u32], closed: bool, positions: &[V3], normals: &[V3], limit: f64, what: &str) -> Result<(), String> {
    let n = points.len();
    if n < 3 {
        return Ok(());
    }
    let range: Box<dyn Iterator<Item = usize>> = if closed { Box::new(0..n) } else { Box::new(1..n - 1) };
    for k in range {
        let (i0, i1, i2) = (points[(k + n - 1) % n], points[k], points[(k + 1) % n]);
        let p1 = positions[i1 as usize];
        let a = sub(positions[i0 as usize], p1);
        let b = sub(positions[i2 as usize], p1);
        let axb = cross(a, b);
        let area2 = dot(axb, axb);
        if area2 < 1e-24 {
            continue;
        }
        // Circumcentre offset from p1.
        let offset = scale(cross(sub(scale(b, dot(a, a)), scale(a, dot(b, b))), axb), 1.0 / (2.0 * area2));
        let r2 = dot(offset, offset);
        let kappa_n = dot(offset, normals[i1 as usize]) / r2;
        if kappa_n.abs() * limit > 1.0 {
            return Err(format!("normal curvature radius {:.3} mm < 1.5 t = {limit:.3} mm on {what} at {:?} (prev {:?} next {:?} n {:?})", 1.0 / kappa_n.abs(), p1, positions[i0 as usize], positions[i2 as usize], normals[i1 as usize]));
        }
    }
    Ok(())
}

pub fn build(p: &ArchParams, rng: &mut SplitMix64) -> Result<Built, String> {
    let line = Centreline::new(p.w, p.d, p.wf);
    let total = line.length();
    let teeth = Teeth::new(p.arch, total);

    // The centreline check.
    let needed = teeth.max_b() / 2.0 + if p.plate { 3.0 } else { 0.0 } + p.t;
    let radius = line.min_radius();
    if radius < needed {
        return Err(format!("centreline curvature radius {radius:.3} mm < {needed:.3} mm"));
    }

    let h = p.h;
    let n_s = (total / h).ceil() as usize;
    let dense = 20_000;
    let u_max = (0..=dense).map(|k| column(&line, &teeth, p, total * k as f64 / dense as f64).profile.length).fold(0.0, f64::max);
    let n_u = (u_max / h).ceil() as usize;

    let (post_l, post_r) = if p.plate {
        let first = (0..=n_s).find(|&i| i as f64 * total / n_s as f64 >= POST).ok_or("no post column")?;
        let last = (0..=n_s).rev().find(|&i| i as f64 * total / n_s as f64 <= total - POST).ok_or("no post column")?;
        (first, last)
    } else {
        (usize::MAX, usize::MAX)
    };

    // Jitter: s, then u (k later, once K is known).
    let mut s_values: Vec<f64> = (0..=n_s).map(|i| i as f64 * total / n_s as f64).collect();
    let mut fractions: Vec<f64> = (0..=n_u).map(|j| j as f64 / n_u as f64).collect();
    if p.jitter {
        for (i, s) in s_values.iter_mut().enumerate() {
            if i == 0 || i == n_s || i == post_l || i == post_r {
                continue;
            }
            *s += rng.symmetric() * 0.25 * total / n_s as f64;
        }
        for (j, f) in fractions.iter_mut().enumerate() {
            if j == 0 || j == n_u {
                continue;
            }
            *f += rng.symmetric() * 0.25 / n_u as f64;
        }
    }

    // Band.
    let stride = n_u + 1;
    let id = |i: usize, j: usize| (i * stride + j) as u32;
    let columns: Vec<Column> = s_values.iter().map(|&s| column(&line, &teeth, p, s)).collect();
    let mut positions: Vec<V3> = Vec::with_capacity((n_s + 1) * stride * 2);
    for col in &columns {
        for (j, &f) in fractions.iter().enumerate() {
            let nz = if j == n_u { col.profile.at(col.profile.length) } else { col.profile.at(f * col.profile.length) };
            positions.push(place(col, nz));
        }
    }
    let mut quads: Vec<[u32; 4]> = Vec::new();
    for i in 0..n_s {
        for j in 0..n_u {
            quads.push([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
        }
    }

    // Plate.
    let mut ring_ids: Vec<Vec<u32>> = Vec::new();
    if p.plate {
        let mut outer: Vec<u32> = (post_l..=post_r).map(|i| id(i, n_u)).collect();
        let (a, b) = (positions[id(post_r, n_u) as usize], positions[id(post_l, n_u) as usize]);
        let segments = (length(sub(b, a)) / h).ceil() as usize;
        for q in 1..segments {
            let f = q as f64 / segments as f64;
            outer.push(positions.len() as u32);
            positions.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), 0.0]);
        }
        let xy: Vec<[f64; 2]> = outer.iter().map(|&v| [positions[v as usize][0], positions[v as usize][1]]).collect();
        let count = xy.len();
        let (mut area, mut cx, mut cy) = (0.0, 0.0, 0.0);
        for k in 0..count {
            let (a, b) = (xy[k], xy[(k + 1) % count]);
            let c = a[0] * b[1] - b[0] * a[1];
            area += c / 2.0;
            cx += (a[0] + b[0]) * c;
            cy += (a[1] + b[1]) * c;
        }
        let centre = [cx / (6.0 * area) + p.window_offset[0], cy / (6.0 * area) + p.window_offset[1]];
        let theta: Vec<f64> = xy.iter().map(|o| (o[1] - centre[1]).atan2(o[0] - centre[0])).collect();
        let steps: Vec<f64> = (0..count)
            .map(|k| {
                let mut d = theta[(k + 1) % count] - theta[k];
                while d > PI {
                    d -= 2.0 * PI;
                }
                while d <= -PI {
                    d += 2.0 * PI;
                }
                d
            })
            .collect();
        let sign = steps[0].signum();
        let turn: f64 = steps.iter().sum();
        if steps.iter().any(|d| d.signum() != sign || *d == 0.0) || (turn.abs() - 2.0 * PI).abs() > 1e-6 {
            return Err("O is not star-shaped about W (θ not strictly monotone)".into());
        }
        let half = [p.window[0] / 2.0, p.window[1] / 2.0];
        let mut inner = Vec::with_capacity(count);
        let mut reach: f64 = 0.0;
        for o in &xy {
            let delta = [o[0] - centre[0], o[1] - centre[1]];
            let distance = delta[0].hypot(delta[1]);
            let direction = [delta[0] / distance, delta[1] / distance];
            let hit = window_hit(direction, half, WINDOW_CORNER);
            if hit > distance - h {
                return Err(format!("the window does not fit inside O (ray reaches {hit:.3} mm, O at {distance:.3} mm)"));
            }
            let point = [centre[0] + direction[0] * hit, centre[1] + direction[1] * hit];
            reach = reach.max((o[0] - point[0]).hypot(o[1] - point[1]));
            inner.push(point);
        }
        let k_rings = (reach / h).ceil() as usize;
        // Depth from the xy distance d to the window outline: z = −V cos²((π/2) min(d/R, 1)),
        // R = 0.9 · min_i d(O_i), V = min(5, 0.09 R²). No jitter on k.
        let outline_distance = |q: [f64; 2]| window_sdf([q[0] - centre[0], q[1] - centre[1]], half, WINDOW_CORNER).max(0.0);
        let r_depth = 0.9 * xy.iter().map(|&o| outline_distance(o)).fold(f64::INFINITY, f64::min);
        let v_depth = VAULT.min(VAULT_FACTOR * r_depth * r_depth);
        for k in 0..k_rings {
            let f = k as f64 / k_rings as f64;
            let mut ring = Vec::with_capacity(count);
            for (o, i) in xy.iter().zip(&inner) {
                let q = [i[0] + f * (o[0] - i[0]), i[1] + f * (o[1] - i[1])];
                let cosine = (PI / 2.0 * (outline_distance(q) / r_depth).min(1.0)).cos();
                ring.push(positions.len() as u32);
                positions.push([q[0], q[1], -v_depth * cosine * cosine]);
            }
            ring_ids.push(ring);
        }
        ring_ids.push(outer);
        for k in 0..k_rings {
            for i in 0..count {
                let next = (i + 1) % count;
                quads.push([ring_ids[k][i], ring_ids[k][next], ring_ids[k + 1][next], ring_ids[k + 1][i]]);
            }
        }
    }
    let f_count = positions.len();

    // F normals (F_n: the quads wound so their normal is n, away from teeth and tissue).
    let f_n: Vec<[u32; 3]> = quads.iter().flat_map(|&q| split(q, &positions)).collect();
    let normals = vertex_normals(&positions, &f_n);
    let top = (0..=n_u).map(|j| id(n_s / 2, j)).max_by(|&a, &b| positions[a as usize][2].total_cmp(&positions[b as usize][2])).unwrap();
    if normals[top as usize][2] <= 0.0 {
        return Err("internal: F normal at the occlusal top does not point up".into());
    }

    // Normal-curvature check on every grid row and column curve.
    let limit = 1.5 * p.t;
    for j in 0..=n_u {
        let row: Vec<u32> = (0..=n_s).map(|i| id(i, j)).collect();
        normal_curvature_check(&row, false, &positions, &normals, limit, &format!("band row j {j}"))?;
    }
    for i in 0..=n_s {
        let col: Vec<u32> = (0..=n_u).map(|j| id(i, j)).collect();
        normal_curvature_check(&col, false, &positions, &normals, limit, &format!("band column i {i}"))?;
    }
    for (k, ring) in ring_ids.iter().enumerate() {
        normal_curvature_check(ring, true, &positions, &normals, limit, &format!("plate ring k {k}"))?;
    }
    if let Some(first) = ring_ids.first() {
        for i in 0..first.len() {
            let spoke: Vec<u32> = ring_ids.iter().map(|ring| ring[i]).collect();
            normal_curvature_check(&spoke, false, &positions, &normals, limit, &format!("plate spoke {i}"))?;
        }
    }

    // G = F + t n, then noise (F, then G).
    for v in 0..f_count {
        let g = add(positions[v], scale(normals[v], p.t));
        positions.push(g);
    }
    if p.noise > 0.0 {
        for v in 0..2 * f_count {
            let n = normals[v % f_count];
            positions[v] = add(positions[v], scale(n, p.noise * rng.symmetric()));
        }
    }
    let g_of = |v: u32| v + f_count as u32;

    // Boundary of F (F_n orientation: the sheet lies to the left of each directed edge).
    let mut directed: HashSet<(u32, u32)> = HashSet::with_capacity(quads.len() * 4);
    for q in &quads {
        for k in 0..4 {
            directed.insert((q[k], q[(k + 1) % 4]));
        }
    }
    let mut boundary: Vec<(u32, u32)> = directed.iter().filter(|(a, b)| !directed.contains(&(*b, *a))).copied().collect();
    boundary.sort_unstable();
    let mut incoming: HashMap<u32, u32> = HashMap::new();
    let mut outgoing: HashMap<u32, u32> = HashMap::new();
    for &(a, b) in &boundary {
        outgoing.insert(a, b);
        incoming.insert(b, a);
    }

    let window_ring: HashSet<u32> = ring_ids.first().map(|r| r.iter().copied().collect()).unwrap_or_default();
    let mut corners: Vec<u32> = vec![id(0, 0), id(0, n_u), id(n_s, 0), id(n_s, n_u)];
    if p.plate {
        corners.push(id(post_l, n_u));
        corners.push(id(post_r, n_u));
    }
    let outward_of_edge = |a: u32, b: u32, n: V3, positions: &[V3]| -> V3 { unit(cross(sub(positions[b as usize], positions[a as usize]), n)) };

    // Walls.
    let mut arcs: HashMap<u32, [u32; ROUND_STEPS + 1]> = HashMap::new();
    let mut wall_quads: Vec<([u32; 4], Label)> = Vec::new();
    for &(a, b) in &boundary {
        let rounded = window_ring.contains(&a) && window_ring.contains(&b) || p.rounded_trim;
        if !rounded {
            wall_quads.push(([a, b, g_of(b), g_of(a)], Label::CutWall));
            continue;
        }
        for v in [a, b] {
            if arcs.contains_key(&v) {
                continue;
            }
            let n = normals[v as usize];
            let fv = positions[v as usize];
            // m_v: the sum of the outward in-sheet perpendiculars of v's two boundary edges.
            let raw = add(outward_of_edge(incoming[&v], v, n, &positions), outward_of_edge(v, outgoing[&v], n, &positions));
            let m = unit(sub(raw, scale(n, dot(raw, n))));
            let centre = add(fv, scale(n, p.t / 2.0));
            let mut arc = [0u32; ROUND_STEPS + 1];
            arc[0] = v;
            arc[ROUND_STEPS] = g_of(v);
            for (q, slot) in arc.iter_mut().enumerate().take(ROUND_STEPS).skip(1) {
                let phi = PI * q as f64 / ROUND_STEPS as f64;
                let point = add(centre, add(scale(n, -p.t / 2.0 * phi.cos()), scale(m, p.t / 2.0 * phi.sin())));
                *slot = positions.len() as u32;
                positions.push(point);
            }
            arcs.insert(v, arc);
        }
        let (ra, rb) = (arcs[&a], arcs[&b]);
        for q in 0..ROUND_STEPS {
            wall_quads.push(([ra[q], rb[q], rb[q + 1], ra[q + 1]], Label::RoundWall));
        }
    }

    // Triangles: F reversed, G as built, walls.
    let mut triangles = Vec::with_capacity(quads.len() * 4 + wall_quads.len() * 2);
    let mut labels = Vec::with_capacity(triangles.capacity());
    for &q in &quads {
        for t in split(q, &positions) {
            triangles.push([t[0], t[2], t[1]]);
            labels.push(Label::F);
        }
    }
    for &q in &quads {
        for t in split(q.map(g_of), &positions) {
            triangles.push(t);
            labels.push(Label::G);
        }
    }
    for &(q, label) in &wall_quads {
        for t in split(q, &positions) {
            triangles.push(t);
            labels.push(label);
        }
    }

    let estimate = 2 * (2 * quads.len()) + 2 * wall_quads.len();
    let buccal = (0..=n_s).map(|i| (id(i, 0), columns[i].z_b)).collect();
    let mut corner_wall_vertices = HashSet::new();
    for &c in &corners {
        corner_wall_vertices.insert(c);
        corner_wall_vertices.insert(g_of(c));
        if let Some(arc) = arcs.get(&c) {
            corner_wall_vertices.extend(arc.iter().copied());
        }
    }
    let mut window_wall_vertices = HashSet::new();
    for v in &window_ring {
        if let Some(arc) = arcs.get(v) {
            window_wall_vertices.extend(arc.iter().copied());
        }
    }
    let mut join_edges = Vec::new();
    if p.plate {
        for i in post_l..post_r {
            let (a, b) = (id(i, n_u), id(i + 1, n_u));
            join_edges.push((a, b));
            join_edges.push((g_of(a), g_of(b)));
        }
    }
    Ok(Built {
        solid: Solid { positions, triangles, labels },
        estimate,
        windows: usize::from(p.plate),
        buccal,
        corner_wall_vertices,
        window_wall_vertices,
        join_edges,
    })
}
