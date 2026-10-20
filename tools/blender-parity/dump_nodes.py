"""Dump every Geometry Nodes group used by a Resin UV support object as readable text.

    blender --background --factory-startup --python tools/blender-parity/dump_nodes.py -- <mixo3dtool repo> <out dir>

Writes one `<group>.txt` per node group (nodes with type, settings, unlinked input values,
and every link) plus `index.txt` listing modifiers and group nesting.
"""
import sys
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:]
REPO, OUT = Path(argv[0]), Path(argv[1])
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO / "tests" / "blender"))
from bootstrap import setup  # noqa: E402
setup()
import bmesh  # noqa: E402
import bpy  # noqa: E402

bpy.ops.wm.read_homefile(use_empty=True)
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type == "NODE_EDITOR":
                space.path.clear()
                space.node_tree = None
if "mixo3d" not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module="mixo3d")
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "dump.blend"), check_existing=False)

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
from mixo3d.helpers import slasg_assets  # noqa: E402
sup = slasg_assets.find_support_for(obj)

SKIP_PROPS = {"rna_type", "name", "label", "location", "width", "width_hidden", "height", "dimensions", "inputs", "outputs",
              "internal_links", "parent", "select", "show_options", "show_preview", "hide", "mute", "show_texture",
              "type", "bl_idname", "bl_label", "bl_description", "bl_icon", "bl_static_type", "bl_width_default",
              "bl_width_min", "bl_width_max", "bl_height_default", "bl_height_min", "bl_height_max", "color", "use_custom_color",
              "location_absolute", "warning_propagation", "color_tag", "is_active_output"}


def value(v):
    try:
        if hasattr(v, "__len__") and not isinstance(v, str):
            return "(" + ", ".join(f"{x:.4g}" if isinstance(x, float) else str(x) for x in v) + ")"
    except TypeError:
        pass
    if isinstance(v, float):
        return f"{v:.6g}"
    if hasattr(v, "name"):
        return f"<{v.name}>"
    return repr(v)


def node_props(node):
    out = []
    for prop in node.bl_rna.properties:
        if prop.identifier in SKIP_PROPS or prop.is_readonly and prop.type != "POINTER":
            continue
        try:
            v = getattr(node, prop.identifier)
        except Exception:
            continue
        if v is None:
            continue
        out.append(f"{prop.identifier}={value(v)}")
    return out


seen = {}


def dump_group(group, depth=0):
    if group.name in seen:
        return
    lines = [f"# {group.name}  ({len(group.nodes)} nodes, {len(group.links)} links)", ""]
    lines.append("## Interface")
    for item in group.interface.items_tree:
        if item.item_type == "SOCKET":
            default = getattr(item, "default_value", None)
            lines.append(f"  {item.in_out:6} {item.socket_type:28} '{item.name}' id={item.identifier}" + (f" default={value(default)}" if default is not None else ""))
    lines.append("")
    lines.append("## Nodes")
    children = []
    for node in sorted(group.nodes, key=lambda n: n.name):
        title = f"[{node.name}] {node.bl_idname}" + (f" label='{node.label}'" if node.label else "")
        props = node_props(node)
        lines.append(title + ("  {" + ", ".join(props) + "}" if props else ""))
        for sock in node.inputs:
            if not sock.enabled or sock.is_linked:
                continue
            if hasattr(sock, "default_value"):
                lines.append(f"    in  '{sock.name}' = {value(sock.default_value)}")
        if node.bl_idname == "GeometryNodeGroup" and node.node_tree:
            children.append(node.node_tree)
    lines.append("")
    lines.append("## Links (from -> to)")
    for link in group.links:
        if not link.is_valid or link.is_muted:
            flag = " (invalid/muted)"
        else:
            flag = ""
        lines.append(f"  [{link.from_node.name}].{link.from_socket.name}#{link.from_socket.identifier} -> [{link.to_node.name}].{link.to_socket.name}#{link.to_socket.identifier}{flag}")
    seen[group.name] = depth
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in group.name)
    (OUT / f"{safe}.txt").write_text("\n".join(lines), encoding="utf-8")
    for child in children:
        dump_group(child, depth + 1)


index = []
for mod in sup.modifiers:
    group = getattr(mod, "node_group", None)
    index.append(f"modifier {mod.name}: {mod.type} group={group.name if group else None}")
    if group:
        dump_group(group)
        for item in group.interface.items_tree:
            if item.item_type == "SOCKET" and item.in_out == "INPUT":
                try:
                    index.append(f"    {item.name} ({item.identifier}) = {value(mod[item.identifier])}")
                except Exception:
                    pass
index.append("")
index.append("groups (nesting depth):")
index += [f"  {'  ' * d}{n}" for n, d in seen.items()]
(OUT / "index.txt").write_text("\n".join(index), encoding="utf-8")
print("DUMP_DONE", len(seen), "groups")
