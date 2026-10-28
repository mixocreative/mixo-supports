//! `cases.json`: the case list, the shared defaults and the reference path.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseFile {
    /// Mode C input, relative to the working directory (the repository root).
    pub reference: String,
    pub defaults: Defaults,
    pub cases: Vec<CaseSpec>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Defaults {
    pub h: f64,
    pub t: f64,
    pub m: f64,
    pub a_g: f64,
    pub window: [f64; 2],
    pub window_offset: [f64; 2],
    pub noise: f64,
    pub jitter: bool,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    B,
    C,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ArchKind {
    Upper,
    Lower,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseSpec {
    pub id: String,
    pub tag: String,
    pub mode: Mode,
    #[serde(default)]
    pub held_out: bool,
    /// The expected folder-review result (for the README table; not used by the generator).
    pub expected: String,
    // Mode B.
    pub arch: Option<ArchKind>,
    #[serde(default)]
    pub plate: bool,
    #[serde(default)]
    pub rounded_trim: bool,
    pub arch_w: Option<f64>,
    pub arch_d: Option<f64>,
    pub arch_wf: Option<f64>,
    pub h: Option<f64>,
    pub t: Option<f64>,
    pub m: Option<f64>,
    pub a_g: Option<f64>,
    pub window: Option<[f64; 2]>,
    pub window_offset: Option<[f64; 2]>,
    pub noise: Option<f64>,
    pub jitter: Option<bool>,
    // Mode C.
    #[serde(default)]
    pub mirror: bool,
    pub scale: Option<f64>,
}

/// Everything mode B needs, defaults resolved.
#[derive(Clone, Debug)]
pub struct ArchParams {
    pub arch: ArchKind,
    pub plate: bool,
    pub rounded_trim: bool,
    pub w: f64,
    pub d: f64,
    pub wf: f64,
    pub h: f64,
    pub t: f64,
    pub m: f64,
    pub a_g: f64,
    pub window: [f64; 2],
    pub window_offset: [f64; 2],
    pub noise: f64,
    pub jitter: bool,
}

impl CaseSpec {
    pub fn output_name(&self) -> String {
        format!("syn-{}-{}.stl", self.id, self.tag)
    }

    pub fn arch_params(&self, defaults: &Defaults) -> Result<ArchParams, String> {
        let arch = self.arch.ok_or_else(|| format!("{}: mode B needs \"arch\"", self.id))?;
        // Spec, Mode B "Centreline": upper W 56, D 44, Wf 30; lower W 52, D 40, Wf 28.
        let (w, d, wf) = match arch {
            ArchKind::Upper => (56.0, 44.0, 30.0),
            ArchKind::Lower => (52.0, 40.0, 28.0),
        };
        if self.plate && arch == ArchKind::Lower {
            return Err(format!("{}: the plate is upper only", self.id));
        }
        Ok(ArchParams {
            arch,
            plate: self.plate,
            rounded_trim: self.rounded_trim,
            w: self.arch_w.unwrap_or(w),
            d: self.arch_d.unwrap_or(d),
            wf: self.arch_wf.unwrap_or(wf),
            h: self.h.unwrap_or(defaults.h),
            t: self.t.unwrap_or(defaults.t),
            m: self.m.unwrap_or(defaults.m),
            a_g: self.a_g.unwrap_or(defaults.a_g),
            window: self.window.unwrap_or(defaults.window),
            window_offset: self.window_offset.unwrap_or(defaults.window_offset),
            noise: self.noise.unwrap_or(defaults.noise),
            jitter: self.jitter.unwrap_or(defaults.jitter),
        })
    }
}
