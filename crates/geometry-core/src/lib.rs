//! Host-independent geometry engine. Geometry operations will migrate here.

pub mod core;
pub mod dental;
pub mod generic;
pub mod supports;

/// Version of the host/core request schema (the WASM ABI). Bump on any ABI change: a changed,
/// added or removed call, argument layout or result shape, together with `HOST_GEOMETRY_VERSION` in
/// `src/workers/geometryVersion.ts` and the smoke test.
pub fn engine_version() -> u32 {
    2
}

#[cfg(test)]
mod tests {
    use super::engine_version;

    #[test]
    fn reports_the_current_abi_version() {
        assert_eq!(engine_version(), 2);
    }
}
