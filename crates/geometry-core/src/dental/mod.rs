//! Policy: dental support policy data and aligner profiles (U6a). Detection here produces data
//! (orientation, contours, the permitted strip, primary candidates) as a `PolicyResult`; no
//! collision, landing, repair or mesh-building code lives in this folder (docs/SHIP-PLAN.md rule 1).

pub mod bands;
pub mod cache;
pub mod contour;
pub mod field;
pub mod footprint;
pub mod incidence;
pub mod legacy;
pub mod mesh;
pub mod opening;
pub mod orient;
pub mod orientation;
pub mod paint;
pub mod policy;
pub mod pose;
pub mod profiles;
pub mod region;
pub mod review;
pub mod rim;
pub mod sampling;
pub mod topology;
