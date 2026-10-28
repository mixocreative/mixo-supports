//! Cross-call cache of the contour detection and of the contours' distance field. Orientation, rim, topology, both contours and the face
//! cut are the expensive part of the dental area and are a function of the mesh bits and the profile
//! alone (the operator's tuning only decides the strip afterwards, which is cheap), so one detection
//! serves the region proposal, the policy's reproduction check and every rebuild of the same mesh.
//!
//! The key is the exact bits of the mesh (see `core::digest`) and the profile id; a changed key
//! recomputes, so a stale result is never returned. A few results are kept; `forget` (called when the
//! mesh is released) frees one mesh's, `clear_cache` all of them. Failures (`Inconclusive`) are cached too: they are as deterministic.

use super::field::{Prepared, Reach};
use super::mesh::Mesh;
use super::region::{Inconclusive, Region};
use crate::core::digest::mesh_digest;
use std::cell::{Cell, RefCell};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

/// Detections kept: the model being edited, plus one spare for a unit switched back to.
const KEPT: usize = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Key {
    positions: usize,
    indices: usize,
    digest: [u64; 2],
    profile: String,
}

impl Key {
    pub(super) fn of(positions: &[f32], indices: &[u32], profile_id: &str) -> Self {
        Self { positions: positions.len(), indices: indices.len(), digest: mesh_digest(positions, indices), profile: profile_id.to_string() }
    }
}

thread_local! {
    static KEPT_RESULTS: RefCell<Vec<(Key, Result<Region, Inconclusive>)>> = const { RefCell::new(Vec::new()) };
    static STATS: Cell<(u32, u32)> = const { Cell::new((0, 0)) };
}

/// The kept detection for `key`, or the result of `compute` (kept for next time).
pub(super) fn detection(key: Key, compute: impl FnOnce() -> Result<Region, Inconclusive>) -> Result<Region, Inconclusive> {
    let found = KEPT_RESULTS.with(|kept| kept.borrow().iter().find(|(k, _)| *k == key).map(|(_, r)| r.clone()));
    STATS.with(|s| {
        let (hits, misses) = s.get();
        s.set(if found.is_some() { (hits + 1, misses) } else { (hits, misses + 1) });
    });
    if let Some(result) = found {
        return result;
    }
    let result = compute();
    let evicted = KEPT_RESULTS.try_with(|kept| {
        let mut kept = kept.borrow_mut();
        kept.push((key, result.clone()));
        (kept.len() > KEPT).then(|| kept.remove(0))
    });
    drop(evicted);
    result
}

/// Forgets every kept detection and distance field (the mesh they were made for is gone).
pub fn clear_cache() {
    let all = KEPT_RESULTS.with(|kept| std::mem::take(&mut *kept.borrow_mut()));
    drop(all);
    let field = PREPARED.with(|kept| kept.borrow_mut().take());
    drop(field);
}

/// Forgets the kept detections and distance field of the mesh with this digest (it was released).
pub fn forget(digest: [u64; 2]) {
    let gone = KEPT_RESULTS.with(|kept| {
        let mut kept = kept.borrow_mut();
        let (gone, stay): (Vec<_>, Vec<_>) = std::mem::take(&mut *kept).into_iter().partition(|(k, _)| k.digest == digest);
        *kept = stay;
        gone
    });
    drop(gone);
    let field = PREPARED.with(|kept| {
        let mut kept = kept.borrow_mut();
        if kept.as_ref().is_some_and(|(k, _)| k.mesh.digest == digest) { kept.take() } else { None }
    });
    drop(field);
}

/// `(hits, misses)` of the detection on this thread, for tests and the perf script.
pub fn cache_stats() -> (u32, u32) {
    STATS.with(Cell::get)
}

/// The distance field of one mesh, face cut and contour pair (`field::prepare`), at one reach.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PreparedKey {
    mesh: Key,
    region: u64,
    reach: [u64; 2],
}

impl PreparedKey {
    pub(super) fn of(mesh: &Mesh, allowed_faces: &[u8], outer: &[u32], opening: &[u32], reach: Reach) -> Self {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (allowed_faces, outer, opening).hash(&mut hasher);
        Self { mesh: Key::of(mesh.positions, mesh.indices, ""), region: hasher.finish(), reach: reach.map(f64::to_bits) }
    }
}

type PreparedResult = Rc<Result<Prepared, &'static str>>;

thread_local! {
    /// One field: the model being edited (it is large, about 25 MB on a 374k-triangle aligner).
    static PREPARED: RefCell<Option<(PreparedKey, PreparedResult)>> = const { RefCell::new(None) };
}

/// The kept field for `key`, or the result of `compute` (kept for next time).
pub(super) fn prepared(key: PreparedKey, compute: impl FnOnce() -> Result<Prepared, &'static str>) -> PreparedResult {
    let found = PREPARED.with(|kept| kept.borrow().as_ref().filter(|(k, _)| *k == key).map(|(_, r)| r.clone()));
    if let Some(result) = found {
        return result;
    }
    let result = Rc::new(compute());
    let previous = PREPARED.try_with(|kept| kept.borrow_mut().replace((key, result.clone())));
    drop(previous);
    result
}
