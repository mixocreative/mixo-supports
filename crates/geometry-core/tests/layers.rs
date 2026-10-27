//! Layer rule (docs/SHIP-PLAN.md): core <- supports <- generic | dental. A lower layer never names
//! a higher one, and the two policies never name each other.

use std::fs;
use std::path::{Path, PathBuf};

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

fn names(layer: &str, forbidden: &[&str]) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(layer);
    let mut files = Vec::new();
    rust_files(&root, &mut files);
    assert!(!files.is_empty(), "no sources under {layer}");
    let mut bad = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        for (n, line) in text.lines().enumerate() {
            for other in forbidden {
                if line.contains(&format!("crate::{other}")) || line.contains(&format!("super::super::{other}")) || line.contains(&format!("mixo_geometry_core::{other}")) {
                    bad.push(format!("{}:{}: {}", file.display(), n + 1, line.trim()));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{layer} reaches a higher layer:\n{}", bad.join("\n"));
}

#[test]
fn core_imports_nothing_above() {
    names("core", &["supports", "generic", "dental"]);
}

#[test]
fn supports_import_no_policy() {
    names("supports", &["generic", "dental"]);
}

#[test]
fn policies_do_not_import_each_other() {
    names("generic", &["dental"]);
    names("dental", &["generic"]);
}
