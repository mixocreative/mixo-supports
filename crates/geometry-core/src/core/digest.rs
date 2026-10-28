//! A digest of a mesh's exact bits, for caches keyed on "this very mesh". Two independent 64-bit
//! digests, so an accidental collision of two different meshes is not a practical concern; any
//! changed coordinate, index or length is a different digest.
//!
//! A mesh held by a `MeshStore` is registered here while it is loaded (its buffers never change
//! until it is released), so its digest is computed once per handle and not on every cache lookup:
//! hashing a 374k-triangle aligner is about 9 MB of reads. Any other slice is hashed each time.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};

/// A registered mesh: the addresses and lengths of its buffers, and its digest once computed.
struct Known {
    buffers: [(usize, usize); 2],
    digest: Option<[u64; 2]>,
}

thread_local! {
    static KNOWN: RefCell<Vec<Known>> = const { RefCell::new(Vec::new()) };
}

fn buffers(positions: &[f32], indices: &[u32]) -> [(usize, usize); 2] {
    [(positions.as_ptr() as usize, positions.len()), (indices.as_ptr() as usize, indices.len())]
}

pub fn mesh_digest(positions: &[f32], indices: &[u32]) -> [u64; 2] {
    let key = buffers(positions, indices);
    if let Some(digest) = KNOWN.with(|known| known.borrow().iter().find(|k| k.buffers == key).and_then(|k| k.digest)) {
        return digest;
    }
    let digest = compute(positions, indices);
    KNOWN.with(|known| {
        if let Some(entry) = known.borrow_mut().iter_mut().find(|k| k.buffers == key) {
            entry.digest = Some(digest);
        }
    });
    digest
}

/// Registers a mesh whose buffers stay unchanged until `unregister` (a mesh store's mesh).
pub(crate) fn register(positions: &[f32], indices: &[u32]) {
    if positions.is_empty() || indices.is_empty() {
        return;
    }
    KNOWN.with(|known| known.borrow_mut().push(Known { buffers: buffers(positions, indices), digest: None }));
}

/// Forgets a registered mesh; its digest if one was computed while it was registered.
pub(crate) fn unregister(positions: &[f32], indices: &[u32]) -> Option<[u64; 2]> {
    let key = buffers(positions, indices);
    KNOWN.with(|known| {
        let mut known = known.borrow_mut();
        let at = known.iter().position(|k| k.buffers == key)?;
        known.swap_remove(at).digest
    })
}

/// True while a registered mesh has this digest (another handle still holds the same bits).
pub fn digest_in_use(digest: [u64; 2]) -> bool {
    KNOWN.with(|known| known.borrow().iter().any(|k| k.digest == Some(digest)))
}

fn compute(positions: &[f32], indices: &[u32]) -> [u64; 2] {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_registered_mesh_keeps_its_digest_and_an_unregistered_one_is_hashed_again() {
        let positions = vec![0.0f32, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let indices = vec![0u32, 1, 2];
        let fresh = compute(&positions, &indices);
        register(&positions, &indices);
        assert_eq!(mesh_digest(&positions, &indices), fresh);
        assert!(digest_in_use(fresh));
        // A copy with the same bits elsewhere gives the same digest (computed, not looked up).
        let copy = positions.clone();
        assert_eq!(mesh_digest(&copy, &indices), fresh);
        assert_eq!(unregister(&positions, &indices), Some(fresh));
        assert!(!digest_in_use(fresh));
        assert_eq!(unregister(&positions, &indices), None);
    }
}
