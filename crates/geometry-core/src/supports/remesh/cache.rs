//! Cross-build cache of the voxel remesh. A `Remesh` fills its grid, leaf and polygon caches
//! lazily as queries arrive, and the dental rebuilds query the same model again and again. When a
//! remesh built by `Remesh::new` is dropped its filled state is kept here, and the next `new` with
//! the same key takes it back instead of starting empty.
//!
//! The key covers everything the state is a function of: the exact bits of the mesh (positions and
//! indices, i.e. the body mesh after its transform), the voxel size and the adaptivity. Any change
//! of those is a different key, so a stale state is never returned; a changed key recomputes. A
//! state is removed while in use (never shared) and only a few are kept; `forget` (called when the
//! mesh they were built for is released) frees one mesh's states, `clear_cache` all of them.

use super::grid::Remesh;
use crate::core::digest::mesh_digest;
use std::cell::{Cell, RefCell};

/// Remeshes kept: the line target's and the scatter's voxel sizes, plus one spare.
const KEPT: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Key {
    positions: usize,
    indices: usize,
    voxel: u64,
    adaptivity: u64,
    /// Two independent 64-bit digests of the mesh bits.
    digest: [u64; 2],
}

impl Key {
    pub(super) fn of(positions: &[f32], indices: &[u32], voxel: f64, adaptivity: f64) -> Self {
        Self { positions: positions.len(), indices: indices.len(), voxel: voxel.to_bits(), adaptivity: adaptivity.to_bits(), digest: mesh_digest(positions, indices) }
    }
}

thread_local! {
    static KEPT_STATES: RefCell<Vec<(Key, Remesh)>> = const { RefCell::new(Vec::new()) };
    static STATS: Cell<(u32, u32)> = const { Cell::new((0, 0)) };
}

pub(super) fn take(key: &Key) -> Option<Remesh> {
    let found = KEPT_STATES.with(|kept| {
        let mut kept = kept.borrow_mut();
        let at = kept.iter().position(|(k, _)| k == key)?;
        Some(kept.remove(at).1)
    });
    STATS.with(|s| {
        let (hits, misses) = s.get();
        s.set(if found.is_some() { (hits + 1, misses) } else { (hits, misses + 1) });
    });
    found
}

pub(super) fn put(key: Key, warm: Remesh) {
    // Evicted states drop outside the borrow; a thread being torn down may have no cache left.
    let evicted = KEPT_STATES.try_with(|kept| {
        let mut kept = kept.borrow_mut();
        kept.retain(|(k, _)| *k != key);
        kept.push((key, warm));
        (kept.len() > KEPT).then(|| kept.remove(0))
    });
    drop(evicted);
}

/// Forgets every kept remesh (the model they were built for is gone).
pub fn clear_cache() {
    let all = KEPT_STATES.with(|kept| std::mem::take(&mut *kept.borrow_mut()));
    drop(all);
}

/// Forgets the kept remeshes of the mesh with this digest (`core::digest`): it was released.
pub fn forget(digest: [u64; 2]) {
    let gone: Vec<(Key, Remesh)> = KEPT_STATES.with(|kept| {
        let mut kept = kept.borrow_mut();
        let (gone, stay) = std::mem::take(&mut *kept).into_iter().partition(|(k, _)| k.digest == digest);
        *kept = stay;
        gone
    });
    drop(gone);
}

/// `(hits, misses)` of `Remesh::new` on this thread, for tests and the perf script.
pub fn cache_stats() -> (u32, u32) {
    STATS.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::remesh::NormalKind;

    fn cube(scale: f32) -> (Vec<f32>, Vec<u32>) {
        let p = [0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1., 1.];
        let i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
        (p.iter().map(|v| v * scale).collect(), i.to_vec())
    }

    fn probe(r: &mut Remesh) -> Option<([f64; 3], [f64; 3])> {
        r.cast_down([5.0, 50.0, 5.0], 100.0, 14.0)
    }

    #[test]
    fn same_key_reuses_the_filled_state_and_gives_the_same_answers() {
        clear_cache();
        let (p, i) = cube(10.0);
        let (h0, m0) = cache_stats();
        let mut first = Remesh::new(&p, &i, 1.0, None, 0.1);
        let cold = probe(&mut first);
        let normal = first.normal_at([5.0, 10.0, 5.0], NormalKind::Face);
        drop(first);
        let mut second = Remesh::new(&p, &i, 1.0, None, 0.1);
        assert_eq!(cache_stats(), (h0 + 1, m0 + 1), "the second build starts from the first one's state");
        assert_eq!(probe(&mut second), cold);
        assert_eq!(second.normal_at([5.0, 10.0, 5.0], NormalKind::Face), normal);
    }

    #[test]
    fn a_changed_mesh_or_voxel_or_adaptivity_recomputes() {
        clear_cache();
        let (p, i) = cube(10.0);
        drop(Remesh::new(&p, &i, 1.0, None, 0.1));
        let (hits, misses) = cache_stats();
        // Moved (same shape, other transform), other voxel size, other adaptivity, other topology, rescaled.
        let mut moved = p.clone();
        moved[1] += 0.25;
        let mut flipped = i.clone();
        flipped.swap(0, 1);
        let bigger = cube(11.0).0;
        for (positions, indices, voxel, adaptivity) in [(&moved, &i, None, 0.1), (&p, &i, Some(0.5), 0.1), (&p, &i, None, 0.5), (&p, &flipped, None, 0.1), (&bigger, &i, None, 0.1)] {
            drop(Remesh::new(positions, indices, 1.0, voxel, adaptivity));
        }
        let (h, m) = cache_stats();
        assert_eq!((h - hits, m - misses), (0, 5), "no changed key may reuse the stale state");
        // The original key was evicted by the five newer ones, so it recomputes; a repeat now hits.
        drop(Remesh::new(&p, &i, 1.0, None, 0.5));
        assert_eq!(cache_stats().0, h + 1);
    }

    #[test]
    fn clear_cache_forgets_everything_and_only_a_few_are_kept() {
        clear_cache();
        let (p, i) = cube(10.0);
        for voxel in [0.5, 0.6, 0.7, 0.8] {
            drop(Remesh::new(&p, &i, 1.0, Some(voxel), 0.1));
        }
        let (h, _) = cache_stats();
        drop(Remesh::new(&p, &i, 1.0, Some(0.5), 0.1));
        assert_eq!(cache_stats().0, h, "the oldest was evicted");
        drop(Remesh::new(&p, &i, 1.0, Some(0.8), 0.1));
        assert_eq!(cache_stats().0, h + 1);
        clear_cache();
        drop(Remesh::new(&p, &i, 1.0, Some(0.8), 0.1));
        assert_eq!(cache_stats().0, h + 1);
    }

    #[test]
    fn forget_frees_only_the_released_mesh() {
        clear_cache();
        let (p, i) = cube(10.0);
        let other = cube(11.0).0;
        drop(Remesh::new(&p, &i, 1.0, None, 0.1));
        drop(Remesh::new(&other, &i, 1.0, None, 0.1));
        forget(crate::core::digest::mesh_digest(&p, &i));
        let (h, m) = cache_stats();
        drop(Remesh::new(&other, &i, 1.0, None, 0.1));
        drop(Remesh::new(&p, &i, 1.0, None, 0.1));
        assert_eq!(cache_stats(), (h + 1, m + 1), "the other mesh is still warm, the forgotten one recomputes");
    }
}
