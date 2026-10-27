//! The target SLASG_Line samples neck normals from and casts landing rays against: the model
//! remeshed at voxel max(diagonal / 2000, Middle diameter), or the exact model in a Low Poly Mode
//! preview ("Exact Shape"). Landing rays find the exact surface first and scan the remesh only from
//! two voxels above it, as the remesh stays within a voxel of the model.

use super::parts::column::{ColumnContact, ContactKind};
use super::parts::landing::Landing;
use super::parts::model::Model;
use super::parts::vec::V3;
use super::remesh::{NormalKind, Remesh};
use super::settings::SupportSettings;
use std::cell::RefCell;

pub struct LineTarget<'a> {
    model: &'a Model<'a>,
    remesh: Option<RefCell<Remesh>>,
}

impl<'a> LineTarget<'a> {
    /// Low Poly Mode is a preview setting: export always samples the remesh.
    pub fn new(model: &'a Model<'a>, settings: &SupportSettings, exporting: bool) -> Self {
        let exact = settings.low_poly_mode && !exporting;
        let remesh = (!exact).then(|| RefCell::new(Remesh::new(model.positions(), model.indices(), settings.pillar_diameter, None, 0.1)));
        Self { model, remesh }
    }

    /// Extent of the model along Y: the farthest a landing ray looks.
    pub fn height(&self) -> f64 {
        self.model.height
    }

    pub fn cast(&self, from: V3, length: f64) -> Option<Landing> {
        let hint = self.model.cast_down(from, length);
        let (Some(remesh), Some(hint)) = (&self.remesh, hint) else { return hint };
        let mut remesh = remesh.borrow_mut();
        let start = hint.point[1] + 2.0 * remesh.voxel;
        remesh.cast_down(from, length, start).map(|(point, normal)| Landing { point, normal, face: hint.face, source_point: Some(hint.point) })
    }

    /// The neck normal of a contact: straight down for a vertical one, else the remesh normal under it.
    pub fn normal(&self, contact: &ColumnContact) -> V3 {
        let given = contact.candidate.normal;
        let kind = match contact.kind {
            ContactKind::Vertical => return [0.0, -1.0, 0.0],
            ContactKind::Unspecified => return given,
            ContactKind::Face => NormalKind::Face,
            ContactKind::Edge => NormalKind::Edge,
        };
        let Some(remesh) = &self.remesh else { return given };
        remesh.borrow_mut().normal_at(contact.candidate.point, kind).unwrap_or(given)
    }
}
