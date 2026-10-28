//! Matrices and point/vector transforms of whole buffers.

use super::coded_error;
use mixo_geometry_core::core::matrix::{self, Handedness, Matrix4};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

pub(crate) fn matrix4(values: &[f64]) -> Result<Matrix4, JsValue> {
    let matrix: Matrix4 = values.try_into().map_err(|_| coded_error("INVALID_LENGTH"))?;
    if matrix.iter().any(|v| !v.is_finite()) {
        return Err(coded_error("NON_FINITE"));
    }
    Ok(matrix)
}

pub(crate) fn handedness_of(flag: u32) -> Result<Handedness, JsValue> {
    Handedness::from_flag(flag).ok_or_else(|| coded_error("INVALID_ARGUMENT"))
}


/// Placement matrix (f64[16]) of a position (mm) and Euler XYZ rotation (radians).
#[wasm_bindgen]
pub fn placement_matrix(position: &[f64], rotation: &[f64]) -> Result<Vec<f64>, JsValue> {
    if position.len() != 3 || rotation.len() != 3 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::placement_matrix([position[0], position[1], position[2]], [rotation[0], rotation[1], rotation[2]]).to_vec())
}

#[wasm_bindgen]
pub fn invert_matrix(matrix: &[f64]) -> Result<Vec<f64>, JsValue> {
    Ok(matrix::invert_matrix(&matrix4(matrix)?).to_vec())
}

/// Positions of any mesh (not necessarily in a session) through a matrix; see `GeometrySession.transform`.
#[wasm_bindgen]
pub fn transform_positions(positions: &[f32], matrix: &[f64], handedness: u32) -> Result<Vec<f32>, JsValue> {
    if positions.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transform_positions(positions, &matrix4(matrix)?, handedness_of(handedness)?))
}

/// Lowest y of the positions through a matrix (float32 like `transform_positions`), without the copy.
#[wasm_bindgen]
pub fn transformed_min_y(positions: &[f32], matrix: &[f64]) -> Result<f32, JsValue> {
    if positions.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transformed_min_y(positions, &matrix4(matrix)?))
}

/// A batch of f64 xyz triples through a matrix as points (with divide) or normalised directions.
#[wasm_bindgen]
pub fn transform_vectors(values: &[f64], matrix: &[f64], direction: bool) -> Result<Vec<f64>, JsValue> {
    if values.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transform_vectors(values, &matrix4(matrix)?, direction))
}
