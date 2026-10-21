"""Record Resin UV Auto Tree output on a ledge model for several Safe Distance values.

    blender --background --factory-startup --python tools/blender-parity/probe_safe.py -- <mixo3dtool repo> <out.json>

The model is a C profile (x, z) extruded along y: a lower arm, a back wall and an upper arm
that reaches 3 mm further than the lower one, so contacts under the upper arm sit above the
lower arm's top (no branch) or just beyond its end (Safe Distance decides). The output holds
the model triangles (before the lift), the contacts and the scatter graph per case;
`src/core/supports/blenderSafe.test.ts` replays them.
"""
import json
import sys
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:]
REPO, OUT = Path(argv[0]), Path(argv[1])
sys.path.insert(0, str(REPO / "tests" / "blender"))
from bootstrap import setup  # noqa: E402
setup()
import bmesh  # noqa: E402
import bpy  # noqa: E402

bpy.ops.wm.read_homefile(use_empty=True)
if "mixo3d" not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module="mixo3d")

PROFILE = [(-3, 0), (6, 0), (6, 1.5), (-1, 1.5), (-1, 4), (9, 4), (9, 5.5), (-3, 5.5)]
me = bpy.data.meshes.new("ledge")
bm = bmesh.new()
front = [bm.verts.new((x, -3, z)) for x, z in PROFILE]
back = [bm.verts.new((x, 3, z)) for x, z in PROFILE]
bm.faces.new(front[::-1])
bm.faces.new(back)
for i in range(len(PROFILE)):
    j = (i + 1) % len(PROFILE)
    bm.faces.new([front[i], front[j], back[j], back[i]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
obj = bpy.data.objects.new("ledge", me)
bpy.context.scene.collection.objects.link(obj)
triangles = [[list(me.vertices[i].co) for i in p.vertices] for p in me.polygons]
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
assert bpy.ops.mixo.support_generate() == {"FINISHED"}
from mixo3d import properties  # noqa: E402
from mixo3d.helpers import slasg_assets  # noqa: E402
sup = slasg_assets.find_support_for(obj)
sp = sup.mixo_support
sp.label_enabled = False
sp.truss_enabled = False


def graph():
    later = [m for m in sup.modifiers if m.name in ("mixo_gen", "mixo_label", "mixo_model")]
    shown = [(m, m.show_viewport) for m in later]
    for m in later:
        m.show_viewport = False
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        mesh = sup.evaluated_get(dg).to_mesh()
        return {"vertices": [[round(c, 4) for c in v.co] for v in mesh.vertices], "edges": [list(e.vertices) for e in mesh.edges]}
    finally:
        for m, state in shown:
            m.show_viewport = state
        sup.update_tag()


cases = {}
for name, tree, safe in [("plain", False, 0.0), ("tree", True, 0.0), ("safe_0_8", True, 0.8), ("safe_1_7", True, 1.7)]:
    sp.scatter_auto_tree = tree
    sp.scatter_safe_distance = safe
    slasg_assets.push_all(sup)
    g = graph()
    cases[name] = {"scatter_auto_tree": tree, "scatter_safe_distance": safe, "graph": g,
                   "contacts": [[round(c, 4) for c in p] for p in slasg_assets.contact_points(sup)]}
    print("CASE", name, len(g["vertices"]), "points", len(g["edges"]), "edges")

settings = {k: getattr(sp, k) for k in ("scatter_spacing", "scatter_angle", "scatter_merge_distance", "scatter_branch_descent", "lift_height")}
OUT.write_text(json.dumps({"blender": bpy.app.version_string, "settings": settings, "triangles": triangles, "cases": cases}, indent=1))
print("PROBE_DONE", OUT)
