"""Export the label glyphs (Inter, OFL-1.1) exactly as Resin UV's MIXO_Label fills them.

    blender --background --factory-startup --python tools/fonts/export_label_font.py -- crates/geometry-core/src/supports/parts/labelFont.json

Uses tools/fonts/Inter-Regular.ttf (official Inter 4.1 release, static Regular, overlaps
removed; the same file the add-on ships as mixo3d/assets/fonts/Inter-Regular.ttf for
MIXO_Label; provenance in tools/fonts/README.md). For each character: String to
Curves (Inter, size 1, align Left / Top Baseline) -> Realize Instances -> Fill Curve
(Triangles), giving vertices and triangles at size 1, plus the advance width measured from the
pen position of a following "H". Also records the capital height (top of "H") at size 1.
"""
import json
import os
import sys
from pathlib import Path

import bpy

OUT = Path(sys.argv[sys.argv.index("--") + 1])
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"

bpy.ops.wm.read_homefile(use_empty=True)
mesh = bpy.data.meshes.new("dummy")
obj = bpy.data.objects.new("dummy", mesh)
bpy.context.scene.collection.objects.link(obj)
group = bpy.data.node_groups.new("glyph", "GeometryNodeTree")
group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
nodes, links = group.nodes, group.links
text = nodes.new("GeometryNodeStringToCurves")
text.inputs["Align X"].default_value = "Left"
text.inputs["Align Y"].default_value = "Top Baseline"
text.inputs["Size"].default_value = 1.0
FONT_PATH = str(Path(__file__).resolve().parent / "Inter-Regular.ttf")
if not os.path.exists(FONT_PATH):
    sys.exit(f"Inter not found at {FONT_PATH}")
font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
text.inputs["Font"].default_value = font
realize = nodes.new("GeometryNodeRealizeInstances")
fill = nodes.new("GeometryNodeFillCurve")
fill.inputs["Mode"].default_value = "Triangles"
out = nodes.new("NodeGroupOutput")
links.new(text.outputs["Curve Instances"], realize.inputs["Geometry"])
links.new(realize.outputs["Geometry"], fill.inputs["Curve"])
links.new(fill.outputs["Mesh"], out.inputs["Geometry"])
mod = obj.modifiers.new("glyph", "NODES")
mod.node_group = group


def evaluate(string):
    text.inputs["String"].default_value = string
    obj.update_tag()
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = obj.evaluated_get(dg).to_mesh()
    verts = [[round(v.co.x, 5), round(v.co.y, 5)] for v in me.vertices]
    me.calc_loop_triangles()
    tris = [list(t.vertices) for t in me.loop_triangles]
    return verts, tris


h_alone, _ = evaluate("H")
h_max = max(v[0] for v in h_alone)
cap_height = round(max(v[1] for v in h_alone), 5)
glyphs = {}
for char in CHARS:
    verts, tris = evaluate(char)
    # The pen advance: "H" is the rightmost glyph of char + "H", so the pair's right edge sits
    # one advance further than H's own.
    pair, _ = evaluate(char + "H")
    advance = max(v[0] for v in pair) - h_max
    glyphs[char] = {"advance": round(advance, 5), "vertices": verts, "triangles": tris}
    print("GLYPH", char, len(verts), len(tris), round(advance, 4))
meta = {"font": font.name, "file": "Inter-Regular.ttf (Inter 4.1)", "blender": bpy.app.version_string, "size": 1, "capHeight": cap_height}
OUT.write_text(json.dumps({**meta, "glyphs": glyphs}, separators=(",", ":")))
print("CAP_HEIGHT", cap_height)
print("FONT_DONE", OUT)
