//! Typed errors of the support build. Never a partial result.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Structure {
    Tree,
    Brace,
    Roof,
    Cage,
    Raft,
    Label,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildError {
    /// A flat input array has the wrong shape.
    BadInput(&'static str),
    /// A setting is non-finite or outside the validated range (field name).
    SettingOutOfRange(&'static str),
    /// The request enables a structure this core has not ported yet (U4b: Tree, Brace; U4c: others).
    NotYetPorted(Structure),
}

impl BuildError {
    /// Stable machine code for the host.
    pub fn code(&self) -> &'static str {
        match self {
            BuildError::BadInput(_) => "BAD_INPUT",
            BuildError::SettingOutOfRange(_) => "SETTING_OUT_OF_RANGE",
            BuildError::NotYetPorted(_) => "NOT_YET_PORTED",
        }
    }
}
