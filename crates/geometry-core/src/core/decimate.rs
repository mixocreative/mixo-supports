//! Deterministic vertex clustering for the display copy only. Full-resolution geometry is retained for supports and export.

use std::collections::HashMap;

use crate::core::mesh::MeshError;
use crate::core::weld::WeldedMesh;

pub fn decimate_display(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
) -> Result<WeldedMesh, MeshError> {
    if positions.is_empty() || positions.len() % 3 != 0 || indices.len() % 3 != 0 {
        return Err(MeshError::InvalidLength);
    }
    if positions.iter().any(|value| !value.is_finite()) {
        return Err(MeshError::NonFinite);
    }
    if indices
        .iter()
        .any(|&index| index as usize >= positions.len() / 3)
    {
        return Err(MeshError::InvalidIndex);
    }
    if indices.len() / 3 <= max_triangles {
        return Ok(WeldedMesh {
            positions: positions.to_vec(),
            indices: indices.to_vec(),
        });
    }

    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for point in positions.chunks_exact(3) {
        for axis in 0..3 {
            min[axis] = min[axis].min(f64::from(point[axis]));
            max[axis] = max[axis].max(f64::from(point[axis]));
        }
    }
    let extent = (0..3)
        .map(|axis| max[axis] - min[axis])
        .fold(1e-9_f64, f64::max);
    let mut resolution = ((max_triangles as f64 / 2.0).sqrt() * 1.5).floor().max(2.0) as usize;
    loop {
        let result = cluster(
            positions,
            indices,
            min,
            extent / resolution as f64,
            resolution,
        )?;
        if result.indices.len() / 3 <= max_triangles || resolution <= 2 {
            return Ok(result);
        }
        resolution = ((resolution as f64 * 0.8).floor() as usize).max(2);
    }
}

fn cluster(
    positions: &[f32],
    indices: &[u32],
    min: [f64; 3],
    cell: f64,
    resolution: usize,
) -> Result<WeldedMesh, MeshError> {
    let span = resolution.checked_add(1).ok_or(MeshError::Capacity)?;
    let mut cells: HashMap<u64, u32> = HashMap::new();
    let mut vertex_cluster = Vec::with_capacity(positions.len() / 3);
    let mut sums: Vec<[f64; 3]> = Vec::new();
    let mut counts: Vec<u32> = Vec::new();
    for point in positions.chunks_exact(3) {
        let coords = [0, 1, 2].map(|axis| {
            ((f64::from(point[axis]) - min[axis]) / cell)
                .floor()
                .min(resolution as f64) as u64
        });
        let span = span as u64;
        let yz = coords[1]
            .checked_add(span.checked_mul(coords[2]).ok_or(MeshError::Capacity)?)
            .ok_or(MeshError::Capacity)?;
        let key = coords[0]
            .checked_add(span.checked_mul(yz).ok_or(MeshError::Capacity)?)
            .ok_or(MeshError::Capacity)?;
        let id = if let Some(&id) = cells.get(&key) {
            id
        } else {
            let id = u32::try_from(counts.len()).map_err(|_| MeshError::Capacity)?;
            cells.insert(key, id);
            counts.push(0);
            sums.push([0.0; 3]);
            id
        };
        vertex_cluster.push(id);
        counts[id as usize] += 1;
        for axis in 0..3 {
            sums[id as usize][axis] += f64::from(point[axis]);
        }
    }
    let mut out_positions = Vec::with_capacity(counts.len() * 3);
    for (sum, &count) in sums.iter().zip(&counts) {
        for &value in sum {
            out_positions.push((value / f64::from(count)) as f32);
        }
    }
    let mut out_indices = Vec::with_capacity(indices.len());
    for triangle in indices.chunks_exact(3) {
        let a = vertex_cluster[triangle[0] as usize];
        let b = vertex_cluster[triangle[1] as usize];
        let c = vertex_cluster[triangle[2] as usize];
        if a != b && b != c && a != c {
            out_indices.extend_from_slice(&[a, b, c]);
        }
    }
    Ok(WeldedMesh {
        positions: out_positions,
        indices: out_indices,
    })
}

#[cfg(test)]
mod tests {
    use super::decimate_display;
    use crate::core::mesh::MeshError;

    #[test]
    fn clusters_vertices_and_drops_degenerate_triangles() {
        let positions = vec![0., 0., 0., 0.01, 0., 0., 1., 0., 0., 0., 1., 0.];
        let indices = vec![0, 1, 2, 0, 2, 3];
        let result = decimate_display(&positions, &indices, 1).unwrap();
        assert!(result.indices.len() <= 3);
        assert!(
            result
                .indices
                .chunks_exact(3)
                .all(|t| t[0] != t[1] && t[1] != t[2] && t[0] != t[2])
        );
    }

    #[test]
    fn rejects_invalid_mesh_inputs_before_clustering() {
        let coordinates = [0., 0., 0., 1., 0., 0., 0., 1., 0.];
        assert!(matches!(
            decimate_display(&coordinates, &[0, 1], 1),
            Err(MeshError::InvalidLength)
        ));
        assert!(matches!(
            decimate_display(&coordinates, &[0, 1, 3], 1),
            Err(MeshError::InvalidIndex)
        ));
        assert!(matches!(
            decimate_display(&[f32::NAN, 0., 0.], &[0, 0, 0], 1),
            Err(MeshError::NonFinite)
        ));
    }
}
