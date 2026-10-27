//! Layer 2: support placement, parts, manual edits, safety, verdict (added from U4).
//! Host-independent geometry engine. Geometry operations will migrate here.

pub mod build;
pub mod check;
pub mod contact_id;
pub mod edits;
pub mod error;
pub mod flat;
pub mod generate;
pub mod line_target;
pub mod omit;
pub mod overhang;
pub mod parts;
pub mod policy;
pub mod remesh;
pub mod safety;
pub mod settings;
pub mod zones;
