//! Embeds every aligner profile (`src/dental/profiles/*.json`): adding an aligner type is adding one
//! JSON file there, with no list to update (docs/SHIP-PLAN.md, Aligner profiles).

use std::fmt::Write as _;
use std::path::Path;

fn main() {
    let dir = Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir")).join("src/dental/profiles");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("profiles folder")
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    let mut out = String::from("/// Every embedded profile file: (file name, JSON source).\npub const ALL: &[(&str, &str)] = &[\n");
    for path in &files {
        println!("cargo:rerun-if-changed={}", path.display());
        let name = path.file_name().expect("file name").to_string_lossy();
        let full = path.display().to_string().replace('\\', "/");
        writeln!(out, "    ({name:?}, include_str!({full:?})),").expect("write");
    }
    out.push_str("];\n");
    let target = Path::new(&std::env::var("OUT_DIR").expect("out dir")).join("profiles.rs");
    std::fs::write(target, out).expect("write profile list");
}
