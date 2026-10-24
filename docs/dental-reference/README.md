# Dental rework reference

The owner explicitly approved publishing this patient-specific reference mesh and screenshots to this public repository on 2026-10-24 so cloud workers can reproduce and fix the Dental Auto Generate defects. Do not add patient names, original file paths, or further patient material to this folder.

`reference-aligner.stl` is the **already correctly posed** benchmark. Its filename and 80-byte binary STL header were neutralized; the triangle records are byte-for-byte unchanged. SHA-256: `37978ABED8A1A4045B25F288A355FAB40971F5E5AD21D1C4740491D8E9B31987`.

| Image | What to inspect |
| --- | --- |
| `01-exterior-contact-side.png` | Unwanted support touches the tooth/exterior side. |
| `02-exterior-contact-tooth.png` | Another forbidden tooth-side contact. |
| `03-mask-overreach-and-gaps.png` | Allowed-area mask spills above and misses some inner/lower surface. |
| `04-desired-inner-area-redacted.png` | Blue annotation of intended inner/lower region. The identifying status-bar filename was replaced using an image-editing tool; this is a **slightly re-rendered visual guide**, not pixel-exact regression evidence. |
| `05-intended-tilt.png` | Supplied correct printing pose has an intentional tilt. |
| `06-nonplanar-trim-contours.png` | Hand-traced inner and outer trim edges rise near the posterior ends. |

Use the mesh through the app's STL importer, as `scripts/probe-dental-orientation.ts` does. The active plan is [the Dental rework plan](../superpowers/plans/2026-10-24-dental-rework.md). These images are qualitative references; geometry and contact assertions should be measured on the mesh itself, and the operator should visually review the result.
