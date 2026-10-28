//! A digest of a mesh's exact bits, for caches keyed on "this very mesh". Two independent 64-bit
//! digests, so an accidental collision of two different meshes is not a practical concern; any
//! changed coordinate, index or length is a different digest.

use std::hash::{Hash, Hasher};

pub fn mesh_digest(positions: &[f32], indices: &[u32]) -> [u64; 2] {
    let mut first = std::collections::hash_map::DefaultHasher::new();
    let mut second: u64 = 0xcbf2_9ce4_8422_2325;
    for (n, &v) in positions.iter().enumerate() {
        let bits = v.to_bits();
        first.write_u32(bits);
        second = (second ^ u64::from(bits).wrapping_add(n as u64)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    for (n, &v) in indices.iter().enumerate() {
        first.write_u32(v);
        second = (second ^ u64::from(v).rotate_left(17).wrapping_add(n as u64)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    positions.len().hash(&mut first);
    [first.finish(), second]
}
