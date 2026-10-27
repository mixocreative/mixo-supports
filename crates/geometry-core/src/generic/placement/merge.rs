//! Merge by Distance in index order, measured in single precision: each point that no earlier point
//! has claimed claims every unclaimed point within `range` (squared distance <= range squared); a
//! point that claimed any becomes its own cluster's target and can no longer be claimed, so clusters
//! do not chain. Clusters come back as ascending index lists ordered by their first (target) index.

use std::collections::{BTreeMap, HashMap};

/// `points` holds xyz triples (single precision).
pub fn merge_by_distance(points: &[f32], range: f64) -> Vec<Vec<usize>> {
    let count = points.len() / 3;
    let r = (range.max(0.0)) as f32;
    let range_sq = r * r;
    // Cells at least as large as the range (a little over, for rounding), so neighbours lie in the
    // 3x3x3 block around a point's cell.
    let rf = f64::from(r);
    let cell = if rf > 0.0 { rf * (1.0 + 1e-6) + 1e-30 } else { 1.0 };
    let cell_of = |index: usize, axis: usize| (f64::from(points[index * 3 + axis]) / cell).floor() as i64;
    let mut grid: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::new();
    for index in 0..count {
        grid.entry((cell_of(index, 0), cell_of(index, 1), cell_of(index, 2))).or_default().push(index);
    }
    let distance_sq = |a: usize, b: usize| {
        let d = |axis: usize| points[a * 3 + axis] - points[b * 3 + axis];
        let (dx, dy, dz) = (d(0), d(1), d(2));
        dx * dx + dy * dy + dz * dz
    };
    let mut target: Vec<i64> = vec![-1; count];
    for seed in 0..count {
        if target[seed] != -1 {
            continue;
        }
        let (cx, cy, cz) = (cell_of(seed, 0), cell_of(seed, 1), cell_of(seed, 2));
        let mut claimed = 0;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let Some(bucket) = grid.get(&(cx + dx, cy + dy, cz + dz)) else { continue };
                    for &other in bucket {
                        if other == seed || target[other] != -1 || distance_sq(seed, other) > range_sq {
                            continue;
                        }
                        target[other] = seed as i64;
                        claimed += 1;
                    }
                }
            }
        }
        if claimed > 0 {
            target[seed] = seed as i64;
        }
    }
    let mut clusters: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for index in 0..count {
        let owner = if target[index] == -1 { index } else { target[index] as usize };
        clusters.entry(owner).or_default().push(index);
    }
    clusters.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clusters_do_not_chain_and_claimed_points_cannot_claim() {
        // 0 and 1 are within range, 1 and 2 are within range, 0 and 2 are not: 0 claims 1; 2 stays alone.
        let points = [0.0, 0.0, 0.0, 0.9, 0.0, 0.0, 1.8, 0.0, 0.0, 10.0, 0.0, 0.0];
        assert_eq!(merge_by_distance(&points, 1.0), vec![vec![0, 1], vec![2], vec![3]]);
    }
}
