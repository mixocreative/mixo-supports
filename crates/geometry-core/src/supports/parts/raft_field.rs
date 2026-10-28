//! The raft outline's field and contour: the plan-view distance to the projected model (bucketed) and
//! the marching-squares trace of its zero contour.

use super::plan::P2;
use crate::core::jsnum::hypot;
use std::collections::HashMap;

pub(super) type Tri = [P2; 3];

/// Unsigned distance in plan to the union of projected triangles, bucketed for speed.
pub(super) struct PlanDistance<'a> {
    cells: HashMap<(i64, i64), Vec<usize>>,
    size: f64,
    boxes: Vec<[f64; 4]>,
    triangles: &'a [Tri],
    reach: f64,
    /// Generation stamp per triangle: a triangle in several of the 3 x 3 cells is tested once.
    seen: Vec<u32>,
    generation: u32,
}

impl<'a> PlanDistance<'a> {
    pub(super) fn new(triangles: &'a [Tri], reach: f64) -> Self {
        let size = reach.max(0.5);
        let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let mut boxes = Vec::with_capacity(triangles.len());
        for (index, t) in triangles.iter().enumerate() {
            let xs = [t[0][0], t[1][0], t[2][0]];
            let zs = [t[0][1], t[1][1], t[2][1]];
            let (x0, x1) = (xs.iter().copied().fold(f64::INFINITY, f64::min), xs.iter().copied().fold(f64::NEG_INFINITY, f64::max));
            let (z0, z1) = (zs.iter().copied().fold(f64::INFINITY, f64::min), zs.iter().copied().fold(f64::NEG_INFINITY, f64::max));
            boxes.push([x0, z0, x1, z1]);
            for ix in (x0 / size).floor() as i64..=(x1 / size).floor() as i64 {
                for iz in (z0 / size).floor() as i64..=(z1 / size).floor() as i64 {
                    cells.entry((ix, iz)).or_default().push(index);
                }
            }
        }
        Self { cells, size, boxes, triangles, reach, seen: vec![0; triangles.len()], generation: 0 }
    }

    pub(super) fn distance(&mut self, x: f64, z: f64) -> f64 {
        self.generation += 1;
        let cx = (x / self.size).floor() as i64;
        let cz = (z / self.size).floor() as i64;
        let mut best = f64::INFINITY;
        for dx in -1..=1 {
            for dz in -1..=1 {
                let Some(list) = self.cells.get(&(cx + dx, cz + dz)) else { continue };
                for &index in list {
                    if self.seen[index] == self.generation {
                        continue;
                    }
                    self.seen[index] = self.generation;
                    let b = self.boxes[index];
                    let gap = hypot(&[(b[0] - x).max(0.0).max(x - b[2]), (b[1] - z).max(0.0).max(z - b[3])]);
                    if gap >= best {
                        continue;
                    }
                    let d = triangle_distance(&self.triangles[index], x, z);
                    if d < best {
                        best = d;
                    }
                    if best == 0.0 {
                        return 0.0;
                    }
                }
            }
        }
        best.min(self.reach * 4.0)
    }
}

fn triangle_distance(t: &Tri, x: f64, z: f64) -> f64 {
    let [a, b, c] = *t;
    let d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (z - b[1]);
    let d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (z - c[1]);
    let d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (z - a[1]);
    let negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    if !(negative && positive) {
        return 0.0;
    }
    segment_distance(a, b, x, z).min(segment_distance(b, c, x, z)).min(segment_distance(c, a, x, z))
}

fn segment_distance(a: P2, b: P2, x: f64, z: f64) -> f64 {
    let (ex, ez) = (b[0] - a[0], b[1] - a[1]);
    let length = ex * ex + ez * ez;
    let t = if length == 0.0 { 0.0 } else { (((x - a[0]) * ex + (z - a[1]) * ez) / length).clamp(0.0, 1.0) };
    hypot(&[x - (a[0] + ex * t), z - (a[1] + ez * t)])
}

/// Marching squares: closed loops of cells crossed by the zero contour, in walk order.
pub(super) fn trace_contours(field: &[f64], width: usize, height: usize) -> Vec<Vec<(usize, usize)>> {
    let inside = |i: usize, j: usize| field[j * width + i] < 0.0;
    let case_of = |i: usize, j: usize| {
        usize::from(inside(i, j)) | (usize::from(inside(i + 1, j)) << 1) | (usize::from(inside(i + 1, j + 1)) << 2) | (usize::from(inside(i, j + 1)) << 3)
    };
    // Edges: 0 bottom (j), 1 right (i+1), 2 top (j+1), 3 left (i).
    let pairs = |code: usize| -> &'static [[i32; 2]] {
        match code {
            1 => &[[3, 0]],
            2 => &[[0, 1]],
            3 => &[[3, 1]],
            4 => &[[1, 2]],
            5 => &[[3, 2], [1, 0]],
            6 => &[[0, 2]],
            7 => &[[3, 2]],
            8 => &[[2, 3]],
            9 => &[[2, 0]],
            10 => &[[0, 3], [2, 1]],
            11 => &[[2, 1]],
            12 => &[[1, 3]],
            13 => &[[1, 0]],
            14 => &[[0, 3]],
            _ => &[],
        }
    };
    let exits = |code: usize, entry: i32| -> i32 {
        for [a, b] in pairs(code) {
            if *a == entry {
                return *b;
            }
            if *b == entry {
                return *a;
            }
        }
        -1
    };
    let mut visited = vec![false; width * height];
    let mut loops = Vec::new();
    if width < 2 || height < 2 {
        return loops;
    }
    for j in 0..height - 1 {
        for i in 0..width - 1 {
            let code = case_of(i, j);
            if code == 0 || code == 15 || visited[j * width + i] {
                continue;
            }
            let mut loop_: Vec<(usize, usize)> = Vec::new();
            let (mut ci, mut cj) = (i as i64, j as i64);
            let mut entry = pairs(code)[0][0];
            for _ in 0..width * height * 2 {
                let slot = cj as usize * width + ci as usize;
                if visited[slot] && !loop_.is_empty() && ci == i as i64 && cj == j as i64 {
                    break;
                }
                visited[slot] = true;
                loop_.push((ci as usize, cj as usize));
                let exit = exits(case_of(ci as usize, cj as usize), entry);
                if exit < 0 {
                    break;
                }
                match exit {
                    0 => cj -= 1,
                    1 => ci += 1,
                    2 => cj += 1,
                    _ => ci -= 1,
                }
                entry = (exit + 2) % 4;
                if ci < 0 || cj < 0 || ci >= width as i64 - 1 || cj >= height as i64 - 1 {
                    break;
                }
                if ci == i as i64 && cj == j as i64 {
                    break;
                }
            }
            if loop_.len() >= 3 {
                loops.push(loop_);
            }
        }
    }
    loops
}
