# Dental comparison fixtures

Keep each unsupported aligner and its operator-approved supported example together under a neutral `case-###/` directory:

```text
case-001/
  aligner.stl
  ideal-supported.stl
```

The case directories are deliberately ignored by Git. STL geometry can identify a patient even when filenames and binary headers are neutralized. Do not publish a new case or derived geometry without the owner's explicit approval. The original, already approved public reference remains at `docs/dental-reference/reference-aligner.stl`; its local `case-001/aligner.stl` copy is for side-by-side comparison.

`case-001/ideal-supported.stl` is a local, header-neutralized copy of the owner-supplied ideal result. Its triangle records were preserved, and the source download was not changed. Reproduce aggregate measurements without exporting geometry:

```sh
python scripts/dental-reference/compare_supported.py --aligner dentalwork/fixtures/case-001/aligner.stl --supported dentalwork/fixtures/case-001/ideal-supported.stl
python -m unittest discover -s scripts/dental-reference -p 'test_*.py'
```

Current case-001 measurements: the supported shell is lifted 3.5 mm from the plate; 371,827 of 373,956 original shell triangles match after that translation. The comparison finds 90 simple plate-to-shell columns, most with a 1.5 mm shaft; median nearest-neighbor spacing among those columns is 2.545 mm (10th–90th percentile 1.892–3.366 mm). One inspected straight column has a terminal segment about 0.45 mm across. These dimensions describe the example **only**. The owner permits using its support diameter as a dental-specific starting point, but explicitly wants to **retain the app's existing raft design**. Shaft and contact-end diameters must be evaluated separately before selecting a preset. The comparator does not fully segment branch contacts or contact-to-shell penetration. A separate nearest-curve check found 88/90 column tops within 0.5 mm of the already detected outer or middle contour; this is approximate, not a guarantee that a particular adjacent face band is safe.

An additional local 3D triangle-distance check found 89/90 column tops within 0.4 mm of the diagnostic non-opening-side strips. Forty were distinctly closer to those strips, 45 were within 0.1 mm of both sides of a ridge, and five were distinctly closer to an opening-side strip. These are evidence for a narrow ridge-adjacent strategy, **not** proof that every contact or support body is safe.

For another case, create a new numbered directory, keep the source STL outside Git, and neutralize the first 80 bytes of each binary STL header with `scripts/prepare-dental-reference.mjs`. Record comparison measurements in the tracked handoff without names or original source paths. The paired supported model is evidence of intended contacts, spacing, and support direction; the raft need not match.
