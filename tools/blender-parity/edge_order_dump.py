"""Dump Blender's edge order of R (Grid to Mesh) for a v-ridge large enough (1000+ faces) that
bke::mesh_calc_edges uses its parallel hash maps.

Usage:
  blender --background --factory-startup --python edge_order_dump.py -- <mixo3dtool root> <out.json>

Output committed as tools/blender-parity/edge_order_stages.json (src/core/supports/blenderRidges.test.ts).

Builds SLASG_VertexScatter from the add-on's bundled slasg.blend (read, never saved), runs it on
the v-ridge keel of src/goldens/fixtures.ts scaled by 1.25 (Spacing 2, so R is the SDF remesh at
0.5 mm) and records R's faces and edges compactly: face sizes as a string of digits, corner
vertices and edge vertex pairs as base64 little-endian Uint16 arrays.
"""
import base64
import json
import math
import struct
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
addon, out = args[0], args[1]
with bpy.data.libraries.load(f'{addon}/mixo3d/assets/slasg.blend', link=False) as (src, dst):
    dst.node_groups = [name for name in src.node_groups]
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)

scale = 1.25
half, length = 8.0 * scale, 6.0 * scale
height = round(half * math.tan(math.radians(26.0)) * 1e6) / 1e6
profile = [(0.0, 0.0), (half, height), (-half, height)]
web = [(x, y, z) for z in (-length, length) for (x, y) in profile]
verts = [(x, -z, y) for (x, y, z) in web]
tris = [3, 4, 5, 0, 2, 1]
for k in range(3):
    n = (k + 1) % 3
    tris += [k, n, 3 + n, k, 3 + n, 3 + k]
mesh = bpy.data.meshes.new('v-ridge')
mesh.from_pydata(verts, [], [tuple(tris[i:i + 3]) for i in range(0, len(tris), 3)])
mesh.update()
model = bpy.data.objects.new('v-ridge', mesh)
bpy.context.scene.collection.objects.link(model)
host = bpy.data.objects.new('host', bpy.data.meshes.new('host'))
bpy.context.scene.collection.objects.link(host)
group = bpy.data.node_groups['SLASG_VertexScatter']
mod = host.modifiers.new('scatter', 'NODES')
mod.node_group = group
inputs = {item.name: item.identifier for item in group.interface.items_tree
          if item.item_type == 'SOCKET' and item.in_out == 'INPUT'}
getattr(mod.properties.inputs, inputs['Taget Type']).value = 'Object'
getattr(mod.properties.inputs, inputs['Target Object']).value = model
getattr(mod.properties.inputs, inputs['Spacing']).value = 2.0
out_node = next(n for n in group.nodes if n.bl_idname == 'NodeGroupOutput')
for link in [l for l in group.links if l.to_node == out_node]:
    group.links.remove(link)
group.links.new(group.nodes['Reroute'].outputs[0], out_node.inputs[0])
depsgraph = bpy.context.evaluated_depsgraph_get()
depsgraph.update()
r = host.evaluated_get(depsgraph).data


def u16(values):
    assert max(values) < 65536
    return base64.b64encode(struct.pack(f'<{len(values)}H', *values)).decode()


faces = [list(p.vertices) for p in r.polygons]
data = {
    'vertices': len(r.vertices),
    'faceSizes': ''.join(str(len(f)) for f in faces),
    'corners': u16([v for f in faces for v in f]),
    'edges': u16([v for e in r.edges for v in e.vertices]),
}
json.dump(data, open(out, 'w'))
print({'faces': len(faces), 'edges': len(r.edges), 'vertices': len(r.vertices)})
