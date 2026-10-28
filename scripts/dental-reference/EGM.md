# dental-reference

## Overview

An offline Python analysis tool. It compares an unsupported aligner STL with a
supported binary STL of the same model in the same pose, which was produced by
another tool. It reports aggregate measurements of the external support
layout, such as column counts, widths and spacing, to calibrate the dental
support work. It is not part of the app or of the npm build.

## Interface

- CLI: `python scripts/dental-reference/compare_supported.py --aligner <unsupported.stl> --supported <supported.stl> [--lift <mm>]`
  prints one compact JSON object to stdout. If `--lift` is omitted, the lift
  defaults to the difference between the two models' highest Z values.
- `load_binary_stl(path) -> ndarray[N,3,3]`: reads complete binary STLs only.
- `match_reference_faces(reference, supported, lift, quantum=0.001) -> bool[]`:
  matches triangles after lifting the reference in Z. The match ignores winding
  and vertex order.
- `connected_face_components(triangles, quantum=0.001) -> int32[]`: joins
  triangles only through shared quantized vertices, never through proximity.
- `compare(reference, supported, lift) -> dict`: returns
  `{kind: 'comparison', ...}` with quantiles, or
  `{kind: 'inconclusive', reason: 'models-do-not-match-in-this-pose'}` when
  fewer than 80% of the supported faces match the shell.

## Invariants

- The input STLs are read-only. The output contains only aggregate numbers,
  never patient geometry or source paths.
- Only complete binary STL files are accepted. A truncated or ASCII file
  raises `ValueError`.
- `lift` must be finite and `quantum` must be positive.
- The results are approximate. They measure from a component's top to the
  nearest shell vertex, and they do not fully segment branch contacts or the
  raft. The output says so in its `limitations` field.

## Side Effects

- Reads two files from disk and writes JSON to stdout. It does nothing else.
- Requires `numpy` and `scipy` (`scipy.spatial.cKDTree`).

## Verification

- Run: `python -m unittest discover -s scripts/dental-reference -p "test_*.py"` (Python unit tests; `npm test` does not run them)
