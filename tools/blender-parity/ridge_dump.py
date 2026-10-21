"""Dump each stage of SLASG_VertexScatter's legacy SDF ridge branch on the v-ridge fixture.

Usage:
  blender --background --factory-startup --python ridge_dump.py -- <mixo3dtool root> <out.json>

Builds Resin UV's patched SLASG_VertexScatter_Mixo with the add-on's own _build_mixo_scatter
(the legacy ridge edge-normal test compares with -cos(Angle)) from its bundled slasg.blend (read,
never saved), and runs it on the v-ridge keel of src/goldens/fixtures.ts (in Blender axes) with
Spacing 2, Angle 50 degrees and Reinforce Overhang Edges off (Ridge Angle then reaches the legacy
ridge compare unchanged), for Ridge Angle 30, 45 and 60 degrees.
Captures, by re-linking the group output: R (Grid to Mesh) with its edges in Blender's order,
then per Ridge Angle the kept ridge edges (Delete Geometry.004), their midpoints (Subdivide
Mesh, originals deleted), the island candidates (minima joined with the midpoints), their Merge
by Distance result, the snapped points and the points the normal filter keeps, each with its
Vertical / Edge attributes. Coordinates are Blender's (Z up), exact float32 values.
"""
import json
import math
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
addon, out = args[0], args[1]
sys.path.insert(0, addon)
from mixo3d.helpers import slasg_assets  # noqa: E402

blend = f'{addon}/mixo3d/assets/slasg.blend'
with bpy.data.libraries.load(blend, link=False) as (src, dst):
    dst.node_groups = [name for name in src.node_groups]

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)

# vRidge() of src/goldens/fixtures.ts: web (x, y, z) is Blender (x, -z, y).
half, length = 8.0, 6.0
height = round(half * math.tan(math.radians(26.0)) * 1e6) / 1e6
profile = [(0.0, 0.0), (half, height), (-half, height)]
web = [(x, y, z) for z in (-length, length) for (x, y) in profile]
verts = [(x, -z, y) for (x, y, z) in web]
tris = [3, 4, 5, 0, 2, 1]
for k in range(3):
    n = (k + 1) % 3
    tris += [k, n, 3 + n, k, 3 + n, 3 + k]
faces = [tuple(tris[i:i + 3]) for i in range(0, len(tris), 3)]
mesh = bpy.data.meshes.new('v-ridge')
mesh.from_pydata(verts, [], faces)
mesh.update()
model = bpy.data.objects.new('v-ridge', mesh)
bpy.context.scene.collection.objects.link(model)

host = bpy.data.objects.new('host', bpy.data.meshes.new('host'))
bpy.context.scene.collection.objects.link(host)

group = slasg_assets._build_mixo_scatter(bpy.data.node_groups['SLASG_VertexScatter'])
mod = host.modifiers.new('scatter', 'NODES')
mod.node_group = group
inputs = {item.name: item.identifier for item in group.interface.items_tree
          if item.item_type == 'SOCKET' and item.in_out == 'INPUT'}


def set_input(name, value):
    getattr(mod.properties.inputs, inputs[name]).value = value


set_input('Taget Type', 'Object')
set_input('Target Object', model)
set_input('Spacing', 2.0)
set_input('Angle', math.radians(50.0))
set_input('Topological Island', True)
set_input('Facing Down', True)
set_input('Vertical', 'Vertical')
set_input('Edge', 'Edge')
set_input('Mixo Reinforce Overhang Edges', False)

nodes = group.nodes
group_out = next(n for n in nodes if n.bl_idname == 'NodeGroupOutput')
original = [(link.from_socket, link.to_socket) for link in group.links if link.to_node == group_out]


def capture(socket):
    for link in [link for link in group.links if link.to_node == group_out]:
        group.links.remove(link)
    group.links.new(socket, group_out.inputs[0])
    host.update_tag()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    return host.evaluated_get(depsgraph).data


def points(evaluated, attrs=False):
    co = [list(v.co) for v in evaluated.vertices]
    if not attrs:
        return co
    found = {}
    for name in ('Vertical', 'Edge'):
        attr = evaluated.attributes.get(name)
        found[name] = [d.value for d in attr.data] if attr is not None else None
    return {'co': co, **found}


stages = {}
r = capture(nodes['Reroute'].outputs[0])
stages['R'] = points(r)
stages['R_faces'] = [list(p.vertices) for p in r.polygons]
stages['R_edges'] = [list(e.vertices) for e in r.edges]
stages['R_normals'] = [list(n.vector) for n in r.vertex_normals]
for degrees in (30, 45, 60):
    set_input('Ridge Angle', math.radians(degrees))
    edge_mesh = capture(nodes['Delete Geometry.004'].outputs[0])
    stage = {
        'ridge_points': points(edge_mesh),
        'ridge_edges': [list(e.vertices) for e in edge_mesh.edges],
        'midpoints': points(capture(nodes['Delete Geometry.005'].outputs[0])),
        'candidates': points(capture(nodes['Delete Geometry.008'].outputs[0]), True),
        'merged': points(capture(nodes['Merge by Distance.001'].outputs[0]), True),
        'snapped': points(capture(nodes['Set Position.004'].outputs[0]), True),
        'kept': points(capture(nodes['Delete Geometry.009'].outputs[0]), True),
    }
    stages[f'ridge_{degrees}'] = stage

for link in [link for link in group.links if link.to_node == group_out]:
    group.links.remove(link)
for a, b in original:
    group.links.new(a, b)

json.dump(stages, open(out, 'w'))
print({key: len(value) if isinstance(value, list) else {k: len(v) if isinstance(v, list) else len(v['co']) for k, v in value.items()} for key, value in stages.items()})
