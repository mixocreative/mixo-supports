//! Typed errors of the support build. Never a partial result.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Structure {
    /// Auto Tree layout with Safe Distance != 0 on a model: it reads the voxel remesh (U5); the host supplies the layout until then.
    Tree,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildError {
    /// A flat input array has the wrong shape.
    BadInput(&'static str),
    /// A setting is non-finite or outside the validated range (field name).
    SettingOutOfRange(&'static str),
    /// The request needs a structure computation this core has not ported yet (see `Structure`).
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
