//! The shared safety engine (U7): collision index, intentional-reach versus crossing classifier,
//! topology births and the built-path island graph, contact-ring coverage. Safety
//! is generic; a policy only supplies data (`policy::PolicyResult`). `generate` (in
//! `super::generate`) runs the bounded repair over these checks and returns one verdict.

pub mod births;
pub mod clearance;
pub mod conflicts;
pub mod index;
pub mod paths;
pub mod reach;
pub mod rim;
pub mod tri;

#[cfg(test)]
mod tests;
