# Label font

The raft label letters use **Inter Regular**. The add-on and the web editor use the same file.

| | |
|---|---|
| Font | Inter Regular, static (overlaps removed) |
| Version | Inter 4.1 release (name table "Version 4.001;git-9221beed3") |
| Source | https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip, file `extras/ttf/Inter-Regular.ttf` |
| SHA-256 | Zip: `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`<br>TTF: `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| Licence | SIL Open Font License 1.1, Copyright (c) 2016 The Inter Project Authors ([LICENSE-Inter.txt](LICENSE-Inter.txt)). No Reserved Font Name. |
| Add-on copy | `mixo3d/assets/fonts/Inter-Regular.ttf` (mixo3dtool), loaded by MIXO_Label |
| Web data | `src/core/supports/labelFont.json`, exported by `export_label_font.py` in Blender 5.2.0 LTS |

**Why not Blender's bundled `datafiles/fonts/Inter.woff2`.** It is the variable font. In 19 of
the 37 label glyphs (A, D, K, P, Q, R, 1, 4 and others) its contours overlap, and Fill Curve's
even-odd fill punches holes where they do. The static release file has the overlaps removed.

**Size.** Letter Size is the capital height, as before. String to Curves gets
Size / 0.50871, which is Inter's cap height at size 1 (`capHeight` in the JSON). Advances
come from the font, so letters are wider or narrower than the old Bfont's.

**Regenerate:**

```
blender --background --factory-startup --python tools/fonts/export_label_font.py -- src/core/supports/labelFont.json
```
