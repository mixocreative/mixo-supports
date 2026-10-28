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
use super::sampling::ContourContact;
use crate::core::digest::mesh_digest;
use crate::core::vec::V3;
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
    static KEPT_FILLS: RefCell<Vec<(FillKey, Rc<Vec<ContourContact>>)>> = const { RefCell::new(Vec::new()) };
}

/// The suggested tips of one mesh and profile (`paint::fill_candidates`) for a plate normal and a
/// density: they depend on nothing else (stamps, setback and width never change their ids). `up` is
/// quantised to 0.25 degrees (polar from +Y, azimuth `atan2(x, z)`), the density to 0.001.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FillKey {
    base: Key,
    up_q: [i32; 2],
    density_q: i32,
}

impl FillKey {
    pub(super) fn of(positions: &[f32], indices: &[u32], profile_id: &str, up: V3, density: f64) -> Self {
        let size = (up[0] * up[0] + up[1] * up[1] + up[2] * up[2]).sqrt();
        let up = up.map(|v| v / size);
        let step = 0.25f64.to_radians();
        let up_q = [(up[1].clamp(-1.0, 1.0).acos() / step).round() as i32, (up[0].atan2(up[2]) / step).round() as i32];
        Self { base: Key::of(positions, indices, profile_id), up_q, density_q: (density * 1000.0).round() as i32 }
    }
}

/// The kept suggested tips for `key`, or the result of `compute` (kept for next time; as many and
/// evicted as the detections).
pub(super) fn fills(key: FillKey, compute: impl FnOnce() -> Vec<ContourContact>) -> Rc<Vec<ContourContact>> {
    let found = KEPT_FILLS.with(|kept| kept.borrow().iter().find(|(k, _)| *k == key).map(|(_, r)| r.clone()));
    if let Some(result) = found {
        return result;
    }
    let result = Rc::new(compute());
    let evicted = KEPT_FILLS.try_with(|kept| {
        let mut kept = kept.borrow_mut();
        kept.push((key, result.clone()));
        (kept.len() > KEPT).then(|| kept.remove(0))
    });
    drop(evicted);
    result
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

/// Forgets every kept detection, suggested-tip list and distance field (the mesh they were made for is gone).
pub fn clear_cache() {
    let all = KEPT_RESULTS.with(|kept| std::mem::take(&mut *kept.borrow_mut()));
    drop(all);
    let fills = KEPT_FILLS.with(|kept| std::mem::take(&mut *kept.borrow_mut()));
    drop(fills);
    let field = PREPARED.with(|kept| kept.borrow_mut().take());
    drop(field);
}

/// Forgets the kept detections, suggested tips and distance field of the mesh with this digest (it was released).
pub fn forget(digest: [u64; 2]) {
    let gone = KEPT_RESULTS.with(|kept| {
        let mut kept = kept.borrow_mut();
        let (gone, stay): (Vec<_>, Vec<_>) = std::mem::take(&mut *kept).into_iter().partition(|(k, _)| k.digest == digest);
        *kept = stay;
        gone
    });
    drop(gone);
    let fills = KEPT_FILLS.with(|kept| {
        let mut kept = kept.borrow_mut();
        let (gone, stay): (Vec<_>, Vec<_>) = std::mem::take(&mut *kept).into_iter().partition(|(k, _)| k.base.digest == digest);
        *kept = stay;
        gone
    });
    drop(fills);
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
