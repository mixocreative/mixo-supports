//! Synthetic test aligners (roadmap step V1; dentalwork/synthetic-aligners/SPEC.md).
//!
//! cargo run --release -p mixo-geometry-core --bin synthetic_aligners --
//!     --cases dentalwork/synthetic-aligners/cases.json --out dentalwork/synthetic-aligners/stl
//!
//! Writes one binary STL per case and `manifest.json` beside the cases file. Any failed output
//! check exits non-zero, naming the case and the check.

mod arch;
mod cases;
mod checks;
mod geom;
mod perturb;
mod rng;
mod sha256;
#[cfg(test)]
mod tests;

use cases::{CaseFile, CaseSpec, Defaults, Mode};
use geom::{Pose, Solid, V3, dot, read_stl, stl_bytes, undo_reader_rotation};
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::orient::{Proposal, propose_orientation};
use mixo_geometry_core::dental::profiles::reference_aligner;
use perturb::Reference;
use rng::SplitMix64;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

const MAX_TRIANGLES: usize = 3_000_000;

/// One case's output before the checks.
pub struct Generated {
    pub solid: Solid,
    pub pose: Pose,
    pub truth: V3,
    pub expected_chi: i64,
    pub estimate: usize,
}

pub fn generate(case: &CaseSpec, defaults: &Defaults, reference: Option<&Reference>) -> Result<Generated, String> {
    let mut rng = SplitMix64::for_case(&case.id);
    let pose = Pose::draw(&mut rng);
    let (mut solid, truth, expected_chi, estimate) = match case.mode {
        Mode::B => {
            let params = case.arch_params(defaults)?;
            let built = arch::build(&params, &mut rng)?;
            (built.solid, [0.0, 0.0, -1.0], 2 - 2 * built.windows as i64, built.estimate)
        }
        Mode::C => {
            let reference = reference.ok_or("mode C needs the reference")?;
            let noise = case.noise.unwrap_or(0.0);
            let (solid, opening) = perturb::perturb(&reference.solid, reference.opening, case.mirror, case.scale, noise, &mut rng);
            (solid, opening, reference.chi, reference.solid.triangles.len())
        }
    };
    pose.apply(&mut solid);
    Ok(Generated { solid, truth: pose.direction(truth), pose, expected_chi, estimate })
}

pub struct Verified {
    pub bytes: Vec<u8>,
    pub chi: i64,
    /// Ok(angle in degrees) or Err(inconclusive reason code).
    pub opening_error: Result<f64, String>,
}

/// Checks 1–5 on a generated output, then the orientation proposal on the read-back file.
pub fn verify(case_id: &str, generated: &Generated) -> Result<Verified, String> {
    let solid = &generated.solid;
    let chi = checks::check_topology(solid.positions.len(), &solid.triangles, generated.expected_chi)?;
    let count = solid.triangles.len();
    let e = generated.estimate as f64;
    if (count as f64) < 0.5 * e || (count as f64) > 2.0 * e || count > MAX_TRIANGLES {
        return Err(format!("check 5 (triangle count): {count} against estimate {}", generated.estimate));
    }
    let bytes = stl_bytes(&format!("mixosupports synthetic aligner {case_id}"), solid);
    let (mut positions, indices) = read_stl(&bytes).map_err(|e| format!("check 4 (round trip): {e}"))?;
    undo_reader_rotation(&mut positions);
    if positions.len() / 3 != solid.positions.len() {
        return Err(format!("check 4 (round trip): {} vertices read back, {} written", positions.len() / 3, solid.positions.len()));
    }
    let triangles: Vec<[u32; 3]> = indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect();
    checks::check_topology(positions.len() / 3, &triangles, generated.expected_chi).map_err(|e| format!("check 4 (round trip): {e}"))?;
    let opening_error = match propose_orientation(&Mesh::new(&positions, &indices), reference_aligner()) {
        Proposal::Proposal { rim, .. } => Ok(dot(rim.opening_direction, generated.truth).clamp(-1.0, 1.0).acos().to_degrees()),
        Proposal::Inconclusive { reason, .. } => Err(reason.code().to_string()),
    };
    Ok(Verified { bytes, chi, opening_error })
}

fn run(cases_path: &Path, out: &Path) -> Result<(), String> {
    let start = Instant::now();
    let text = std::fs::read_to_string(cases_path).map_err(|e| format!("{}: {e}", cases_path.display()))?;
    let file: CaseFile = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", cases_path.display()))?;
    let reference = if file.cases.iter().any(|c| c.mode == Mode::C) { Some(perturb::load(&file.reference)?) } else { None };
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut entries = Vec::new();
    for case in &file.cases {
        let case_start = Instant::now();
        let generated = generate(case, &file.defaults, reference.as_ref()).map_err(|e| format!("{}: {e}", case.id))?;
        let verified = verify(&case.id, &generated).map_err(|e| format!("{}: {e}", case.id))?;
        let name = case.output_name();
        std::fs::write(out.join(&name), &verified.bytes).map_err(|e| format!("{name}: {e}"))?;
        let opening = match &verified.opening_error {
            Ok(angle) => json!(angle),
            Err(reason) => json!(reason),
        };
        println!(
            "{:4} {:>9} triangles  chi {:>2}  opening {:<22} {:.2} s",
            case.id,
            generated.solid.triangles.len(),
            verified.chi,
            match &verified.opening_error {
                Ok(angle) => format!("{angle:.3} deg"),
                Err(reason) => reason.clone(),
            },
            case_start.elapsed().as_secs_f64()
        );
        entries.push(json!({
            "case": case.id,
            "file": name,
            "heldOut": case.held_out,
            "sha256": sha256::sha256_hex(&verified.bytes),
            "triangles": generated.solid.triangles.len(),
            "vertices": generated.solid.positions.len(),
            "chi": verified.chi,
            "pose": generated.pose.matrix(),
            "truthOpening": generated.truth,
            "openingErrorDeg": opening,
        }));
    }
    let manifest = json!({
        "spec": "dentalwork/synthetic-aligners/SPEC.md",
        "poseLayout": "row-major 4x4, p' = R p + t, applied last",
        "referenceChi": reference.as_ref().map(|r| r.chi),
        "outputs": entries,
    });
    let manifest_path = cases_path.parent().unwrap_or(Path::new(".")).join("manifest.json");
    let mut body = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    body.push('\n');
    std::fs::write(&manifest_path, body).map_err(|e| format!("{}: {e}", manifest_path.display()))?;
    println!("{} outputs, all checks passed, {:.2} s", file.cases.len(), start.elapsed().as_secs_f64());
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let (Some(cases), Some(out)) = (value("--cases"), value("--out")) else {
        eprintln!("usage: synthetic_aligners --cases <cases.json> --out <dir>");
        return ExitCode::from(2);
    };
    match run(&cases, &out) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
