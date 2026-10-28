//! Attribution tags every built component carries: what it is, which contact owns it, whether
//! that contact was automatic or manual, and the source-model contact it intentionally approaches.

use crate::core::vec::V3;
use crate::supports::policy::Origin;

/// Codes are the ABI; order follows the TypeScript `SupportPart` union.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Part {
    Tip = 0,
    Neck = 1,
    Pillar = 2,
    Foot = 3,
    Brace = 4,
    Raft = 5,
    TreeBranch = 6,
    TreeTrunk = 7,
    Roof = 8,
    Column = 9,
    RoofBrace = 10,
    CrossBar = 11,
    CageRing = 12,
    Label = 13,
}

/// Marks a neck split from an Auto Tree branch (U4b).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum StructureKind {
    Tree = 1,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum IntentKind {
    Primary = 1,
    Secondary = 2,
}

/// A model contact a component intentionally approaches; not a collision exemption.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContactIntent {
    pub kind: IntentKind,
    /// Owning contact index for a primary intent.
    pub contact: Option<u32>,
    pub point: V3,
    pub normal: V3,
    pub face: Option<u32>,
}

/// Tags of one component, set before its triangles are emitted.
#[derive(Clone, Debug, PartialEq)]
pub struct Tag {
    pub part: Part,
    /// Index of the owning contact in the build input; structural parts have none.
    pub contact: Option<u32>,
    pub origin: Option<Origin>,
    pub structure_kind: Option<StructureKind>,
    /// A pillar landing on the model with its tip built into the tube: its last mm show in the tips view.
    pub landing_reach: Option<f64>,
    pub intents: Vec<ContactIntent>,
}

impl Tag {
    pub fn new(part: Part) -> Self {
        Self { part, contact: None, origin: None, structure_kind: None, landing_reach: None, intents: Vec::new() }
    }
    pub fn owned(part: Part, contact: u32, origin: Origin) -> Self {
        Self { contact: Some(contact), origin: Some(origin), ..Self::new(part) }
    }
    pub fn reach(mut self, reach: Option<f64>) -> Self {
        self.landing_reach = reach;
        self
    }
    pub fn intents(mut self, intents: Vec<ContactIntent>) -> Self {
        self.intents = intents;
        self
    }
    pub fn structure(mut self, kind: StructureKind) -> Self {
        self.structure_kind = Some(kind);
        self
    }
}

/// A built component: its tags and the triangle range it owns in the index buffer.
#[derive(Clone, Debug, PartialEq)]
pub struct Component {
    pub tag: Tag,
    /// First index into `indices`, and the number of indices (a multiple of 3).
    pub start: u32,
    pub count: u32,
}
