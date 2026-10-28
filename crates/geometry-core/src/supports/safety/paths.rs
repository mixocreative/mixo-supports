//! Reachability of model islands over verified built-support links (port of TS `supportPath.ts`).
//! A link is a built support from an island down to the plate or to another island; the caller
//! proves each link's geometry and body clearance (`verified`). Proximity alone is never a path.

use crate::supports::policy::Origin;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq)]
pub struct PathLink {
    pub from: String,
    /// Another island's id, or `PLATE`.
    pub to: String,
    pub top_y: f64,
    pub bottom_y: f64,
    pub verified: bool,
    pub origin: Origin,
}

pub const PLATE: &str = "plate";

#[derive(Clone, Debug, PartialEq)]
pub enum PathResult {
    Ok { resolved: Vec<String>, unresolved: Vec<String>, manual_resolved: Vec<String> },
    Inconclusive(&'static str),
}

/// `births` are `(id, height)`; ids are unique, finite-height and never `plate`. `plate_y` is the
/// plate's height in the frame of the heights (0 on the plate frame).
pub fn resolve_birth_paths(births: &[(String, f64)], links: &[PathLink], plate_y: f64) -> PathResult {
    let mut heights: HashMap<&str, f64> = HashMap::new();
    for (id, height) in births {
        if id.is_empty() || id == PLATE || heights.contains_key(id.as_str()) || !height.is_finite() {
            return PathResult::Inconclusive("invalid birth identity or height");
        }
        heights.insert(id, *height);
    }
    let mut accepted: Vec<&PathLink> = Vec::new();
    for link in links {
        let Some(&source) = heights.get(link.from.as_str()) else { return PathResult::Inconclusive("invalid support path link") };
        let target = (link.to != PLATE).then(|| heights.get(link.to.as_str()).copied());
        if matches!(target, Some(None)) || !link.top_y.is_finite() || !link.bottom_y.is_finite() {
            return PathResult::Inconclusive("invalid support path link");
        }
        let below_target = match target {
            None => link.bottom_y > plate_y,
            Some(height) => height.unwrap() > link.bottom_y,
        };
        if !link.verified || link.top_y > source || link.bottom_y > link.top_y || below_target {
            continue;
        }
        accepted.push(link);
    }
    let reachable = |allow_manual: bool| -> HashSet<&str> {
        let mut resolved: HashSet<&str> = HashSet::new();
        let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut queue: Vec<&str> = Vec::new();
        for link in &accepted {
            if !allow_manual && link.origin == Origin::Manual {
                continue;
            }
            if link.to == PLATE {
                if resolved.insert(link.from.as_str()) {
                    queue.push(link.from.as_str());
                }
            } else {
                dependents.entry(link.to.as_str()).or_default().push(link.from.as_str());
            }
        }
        let mut at = 0;
        while at < queue.len() {
            for &child in dependents.get(queue[at]).map_or(&[][..], Vec::as_slice) {
                if resolved.insert(child) {
                    queue.push(child);
                }
            }
            at += 1;
        }
        resolved
    };
    let automatic = reachable(false);
    let all = reachable(true);
    let pick = |keep: &dyn Fn(&str) -> bool| births.iter().filter(|(id, _)| keep(id)).map(|(id, _)| id.clone()).collect::<Vec<_>>();
    PathResult::Ok {
        resolved: pick(&|id| all.contains(id)),
        unresolved: pick(&|id| !all.contains(id)),
        manual_resolved: pick(&|id| all.contains(id) && !automatic.contains(id)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn births() -> Vec<(String, f64)> {
        vec![("lower".into(), 5.0), ("upper".into(), 9.0)]
    }
    fn link(from: &str, to: &str, top: f64, bottom: f64, verified: bool, origin: Origin) -> PathLink {
        PathLink { from: from.into(), to: to.into(), top_y: top, bottom_y: bottom, verified, origin }
    }
    fn auto(from: &str, to: &str, top: f64, bottom: f64) -> PathLink {
        link(from, to, top, bottom, true, Origin::Auto)
    }
    fn ok(resolved: &[&str], unresolved: &[&str], manual: &[&str]) -> PathResult {
        let own = |v: &[&str]| v.iter().map(|s| s.to_string()).collect();
        PathResult::Ok { resolved: own(resolved), unresolved: own(unresolved), manual_resolved: own(manual) }
    }

    #[test]
    fn a_higher_birth_resolves_through_a_verified_lower_support_and_plate_path() {
        assert_eq!(resolve_birth_paths(&births(), &[auto("lower", "plate", 5.0, 0.0), auto("upper", "lower", 9.0, 5.0)], 0.0), ok(&["lower", "upper"], &[], &[]));
    }

    #[test]
    fn proximity_an_unverified_crossing_or_a_too_high_tip_is_not_a_path() {
        let unverified = link("lower", "plate", 5.0, 0.0, false, Origin::Auto);
        assert_eq!(resolve_birth_paths(&births(), &[unverified, auto("upper", "lower", 9.0, 5.0)], 0.0), ok(&[], &["lower", "upper"], &[]));
        assert_eq!(resolve_birth_paths(&births(), &[auto("lower", "plate", 6.0, 0.0)], 0.0), ok(&[], &["lower", "upper"], &[]));
    }

    #[test]
    fn manual_support_is_tracked_not_removed_or_treated_as_automatic() {
        let manual = link("lower", "plate", 5.0, 0.0, true, Origin::Manual);
        assert_eq!(resolve_birth_paths(&births(), &[manual, auto("upper", "lower", 9.0, 5.0)], 0.0), ok(&["lower", "upper"], &[], &["lower", "upper"]));
    }

    #[test]
    fn unknown_endpoints_are_refused_and_an_unanchored_cycle_never_resolves() {
        assert_eq!(resolve_birth_paths(&births(), &[auto("lower", "upper", 5.0, 9.0), auto("upper", "lower", 9.0, 5.0)], 0.0), ok(&[], &["lower", "upper"], &[]));
        assert!(matches!(resolve_birth_paths(&births(), &[auto("lower", "missing", 5.0, 0.0)], 0.0), PathResult::Inconclusive(_)));
    }

    #[test]
    fn a_link_that_stops_above_its_target_or_the_plate_does_not_count() {
        assert_eq!(resolve_birth_paths(&births(), &[auto("lower", "plate", 5.0, 1.0), auto("upper", "lower", 9.0, 4.0)], 0.0), ok(&[], &["lower", "upper"], &[]));
    }

    #[test]
    fn an_all_automatic_route_wins_over_a_manual_one() {
        let manual = link("lower", "plate", 5.0, 0.0, true, Origin::Manual);
        assert_eq!(resolve_birth_paths(&births(), &[manual, auto("lower", "plate", 5.0, 0.0), auto("upper", "lower", 9.0, 5.0)], 0.0), ok(&["lower", "upper"], &[], &[]));
    }

    #[test]
    fn duplicate_identities_and_invalid_heights_are_inconclusive() {
        let one = births()[0].clone();
        assert!(matches!(resolve_birth_paths(&[one.clone(), one], &[], 0.0), PathResult::Inconclusive(_)));
        assert!(matches!(resolve_birth_paths(&births(), &[auto("lower", "plate", f64::NAN, 0.0)], 0.0), PathResult::Inconclusive(_)));
    }
}
