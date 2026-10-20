"""Export Blender's built-in Bfont glyphs exactly as MIXO_Label fills them.

    blender --background --factory-startup --python tools/blender-parity/export_font.py -- <out.json>

For each character: String to Curves (Bfont Regular, size 1, align Left / Top Baseline) ->
Realize Instances -> Fill Curve (Triangles, Even-Odd), giving vertices and triangles at size
1, plus the advance width measured from the pen position of a following "H".
"""
import json
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
h_min = min(v[0] for v in h_alone)
glyphs = {}
for char in CHARS:
    verts, tris = evaluate(char)
    pair, _ = evaluate(char + "H")
    single_count = len(verts)
    advance = min(v[0] for v in pair[single_count:]) - h_min if len(pair) > single_count else 0.6
    glyphs[char] = {"advance": round(advance, 5), "vertices": verts, "triangles": tris}
    print("GLYPH", char, len(verts), len(tris), round(advance, 4))
OUT.write_text(json.dumps({"font": "Bfont Regular", "size": 1, "glyphs": glyphs}, separators=(",", ":")))
print("FONT_DONE", OUT)
