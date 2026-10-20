"""Record Resin UV (Blender) support output for a matrix of settings.

Run from anywhere (Blender 5.x with the mixo3d add-on source checkout):

    blender --background --factory-startup --python tools/blender-parity/probe.py -- <mixo3dtool repo> <out.json>

The model is a downward pyramid (apex at the bottom), so every contact lies on a plane
with a known normal. For each settings case the script records every contact, its touch
sphere instance, the support piece it grows (foot centre/radius, neck top radius, height),
and the raft profile. `src/supports/blenderCases.test.ts` replays the same contacts and
settings through the web generator and compares the numbers.
"""
import json
import math
import sys
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:]
REPO, OUT = Path(argv[0]), Path(argv[1])
sys.path.insert(0, str(REPO / "tests" / "blender"))
from bootstrap import setup  # noqa: E402
setup()
import bmesh  # noqa: E402
import bpy  # noqa: E402

CASES = {
    "light": {},
    "middle": {"preset": "MIDDLE"},
    "heavy": {"preset": "HEAVY"},
    "neck_length_3": {"neck_length": 3.0},
    "neck_angle_30": {"max_neck_angle": math.radians(30)},
    "pillar_1_2": {"pillar_diameter": 1.2},
    "foot_4x2": {"base_diameter": 4.0, "base_height": 2.0},
    "touch_depth_0_2": {"touch_depth": 0.2, "touch_diameter": 0.8},
    "raft_off": {"raft_enabled": False},
    "raft_custom": {"raft_expand_width": 5.0, "raft_floor_thickness": 1.5, "raft_wall_height": 2.5,
                    "raft_wall_thickness": 1.0, "raft_wall_angle": math.radians(45), "voxel_resolution": 64},
    "lift_8": {"lift_height": 8.0},
    **{f"expand_{e}_v64": {"raft_expand_width": float(e), "raft_wall_height": 0.0, "voxel_resolution": 64} for e in (0, 1, 2, 4, 6, 8)},
    "expand_3_v16_nowall": {"raft_wall_height": 0.0},
    "expand_3_v32_nowall": {"raft_wall_height": 0.0, "voxel_resolution": 32},
    "truss_default": {"truss_enabled": True},
    "truss_custom": {"truss_enabled": True, "truss_angle": math.radians(30), "truss_spacing": 1.0,
                     "truss_min_height": 4.0, "truss_top_spacing": 0.5, "truss_distance_limit": 3.0, "truss_diameter": 0.5},
    "truss_heavy": {"preset": "HEAVY", "truss_enabled": True},
    "label_default": {"label_enabled": True},
    "label_custom": {"label_enabled": True, "label_text": "B", "label_size": 4.0, "label_height": 1.0, "label_margin": 0.5,
                     "label_offset_x": 1.0, "label_offset_y": -2.0},
}

bpy.ops.wm.read_homefile(use_empty=True)
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type == "NODE_EDITOR":
                space.path.clear()
                space.node_tree = None
if "mixo3d" not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module="mixo3d")
bpy.ops.wm.save_as_mainfile(filepath=str(OUT.with_suffix(".blend")), check_existing=False)

me = bpy.data.meshes.new("spike")
bm = bmesh.new()
apex = bm.verts.new((0, 0, 0))
ring = [bm.verts.new(p) for p in [(-3, -3, 3), (3, -3, 3), (3, 3, 3), (-3, 3, 3)]]
for i in range(4):
    bm.faces.new([apex, ring[(i + 1) % 4], ring[i]])
bm.faces.new(ring)
bm.to_mesh(me)
bm.free()
obj = bpy.data.objects.new("spike", me)
bpy.context.scene.collection.objects.link(obj)
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
BASE = {k: getattr(sp, k) for k in properties._SUPPORT_FIELDS} | {"lift_height": sp.lift_height, "preset": sp.preset}


def evaluated():
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    mesh = sup.evaluated_get(dg).to_mesh()
    attr = mesh.attributes.get("mixo_model")
    model = [bool(v.value) for v in attr.data] if attr else [False] * len(mesh.vertices)
    co = [tuple(v.co) for v in mesh.vertices]
    parent = list(range(len(co)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in mesh.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    groups = {}
    for i, c in enumerate(co):
        if not model[i]:
            groups.setdefault(find(i), []).append((i, c))
    spheres = []
    for inst in dg.object_instances:
        if inst.is_instance and inst.parent and inst.parent.original == sup and hasattr(inst.object.data, "vertices"):
            m = inst.matrix_world
            vs = [m @ v.co for v in inst.object.data.vertices]
            c = [sum(v[a] for v in vs) / len(vs) for a in range(3)]
            spheres.append({"center": [round(x, 4) for x in c], "radius": round(max((max(v.z for v in vs) - min(v.z for v in vs)) / 2, 0), 4)})
    return [[c for _, c in sorted(g)] for g in groups.values()], spheres


def rings_of(vs, size):
    """Curve to Tube writes one profile ring of `size` vertices per curve point, in order."""
    rings = []
    for start in range(0, len(vs) - len(vs) % size, size):
        ring = vs[start:start + size]
        c = [sum(v[a] for v in ring) / size for a in range(3)]
        r = max(math.dist(v, c) for v in ring)
        rings.append([round(c[0], 4), round(c[1], 4), round(c[2], 4), round(r, 4)])
    return rings


def contact_classes():
    """Contact points with their scatter class: edge (Python anchors), vertical (island minima) or face."""
    later = [m for m in sup.modifiers if m.name in ("mixo_gen", "mixo_label", "mixo_model")]
    shown = [(m, m.show_viewport) for m in later]
    for m in later:
        m.show_viewport = False
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        me = sup.evaluated_get(dg).to_mesh()
        edge = me.attributes.get("Edge")
        vertical = me.attributes.get("Vertical")
        out = []
        for i, v in enumerate(me.vertices):
            kind = "edge" if edge and edge.data[i].value > 0 else "vertical" if vertical and vertical.data[i].value > 0 else "face"
            out.append({"co": [round(c, 4) for c in v.co], "class": kind})
        return out
    finally:
        for m, state in shown:
            m.show_viewport = state
        sup.update_tag()


def describe_piece(vs):
    zs = [v[2] for v in vs]
    zmin, zmax = min(zs), max(zs)
    bottom = [v for v in vs if v[2] <= zmin + 1e-4]
    top = [v for v in vs if v[2] >= zmax - 1e-4]
    bc = [(min(v[a] for v in bottom) + max(v[a] for v in bottom)) / 2 for a in range(2)]
    tc = [sum(v[a] for v in top) / len(top) for a in range(2)]
    return {
        "z": [round(zmin, 4), round(zmax, 4)],
        "foot_center": [round(c, 4) for c in bc],
        "foot_radius": round(max(math.hypot(v[0] - bc[0], v[1] - bc[1]) for v in bottom), 4),
        "top_center": [round(c, 4) for c in tc],
        "top_radius": round(max(math.hypot(v[0] - tc[0], v[1] - tc[1]) for v in top), 4),
        "rings": rings_of(vs, sp.resolution) if len(vs) % sp.resolution == 0 else None,
    }


def describe_raft(vs):
    def reach(z):
        xs = [abs(v[0]) for v in vs if abs(v[2] - z) < 1e-3 and abs(v[1]) < 0.75]
        return round(max(xs), 4) if xs else None
    levels = sorted({round(v[2], 3) for v in vs})
    return {"levels": levels, "reach_bottom": reach(0.0), "reach_top": reach(max(levels)), "z_max": round(max(levels), 4)}


results = {}
for name, overrides in CASES.items():
    properties.set_suspended(sp, **{k: v for k, v in BASE.items() if k not in ("preset", "lift_height")})
    sp.lift_height = BASE["lift_height"]
    if "preset" in overrides:
        properties.apply_preset(sup, overrides["preset"])
    rest = {k: v for k, v in overrides.items() if k != "preset"}
    for k, v in rest.items():
        setattr(sp, k, v)
    slasg_assets.push_all(sup)
    pieces, spheres = evaluated()
    contacts = [[round(c, 4) for c in p] for p in slasg_assets.contact_points(sup)]
    classes = contact_classes()
    raft = max(pieces, key=len) if sp.raft_enabled else None
    brace_size = 2 * sp.resolution
    braces = [rings_of(p, sp.resolution) for p in pieces if p is not raft and len(p) == brace_size]
    label_top = sp.raft_wall_height + sp.label_height + 0.02
    labels = [p for p in pieces if p is not raft and len(p) != brace_size and len(p) % sp.resolution != 0
              and min(v[2] for v in p) > -1e-4 and max(v[2] for v in p) <= label_top]
    label = [{"min": [round(min(v[a] for v in p), 4) for a in range(3)], "max": [round(max(v[a] for v in p), 4) for a in range(3)], "verts": len(p)} for p in labels]
    columns = [describe_piece(p) for p in pieces if p is not raft and len(p) != brace_size and not any(p is q for q in labels)]
    settings = {k: (math.degrees(v) if "angle" in k else v) for k, v in
                ((k, getattr(sp, k)) for k in list(properties._SUPPORT_FIELDS) + ["lift_height", "preset", "label_enabled", "label_text",
                 "label_size", "label_height", "label_margin", "label_offset_x", "label_offset_y"])
                if not isinstance(v, str) or k in ("preset", "label_text")}
    results[name] = {"settings": settings, "contacts": contacts, "classes": classes, "spheres": spheres, "columns": columns, "braces": braces, "label": label,
                     "raft": describe_raft(raft) if raft else None}
    print("CASE", name, len(contacts), "contacts", len(columns), "columns")

OUT.write_text(json.dumps({"blender": bpy.app.version_string, "model": "spike pyramid 6x6x3, apex down", "cases": results}, indent=1))
print("PROBE_DONE", OUT)
