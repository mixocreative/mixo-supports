//! Host-independent geometry engine. Geometry operations will migrate here.

pub mod mesh;
pub mod transform;

/// Version of the host/core request schema.
pub fn engine_version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::engine_version;

    #[test]
    fn uses_first_versioned_geometry_contract() {
        assert_eq!(engine_version(), 1);
    }
}
