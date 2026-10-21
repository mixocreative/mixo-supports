"""Dump each stage of SLASG_VertexScatter's island minima on the mushroom fixture.

Usage:
  blender --background --factory-startup --python minima_dump.py -- <slasg.blend> <out.json>

Runs the stock group on the mushroom (20x20x4 cap over a 4x4x10 stem, as in
blenderParity.test.ts) with Spacing 2, Overhang Angle 45 degrees and the SDF ridges off (as
Resin UV's patched scatter runs it), and captures by
re-linking the group output: R (Grid to Mesh) with its float32 vertex normals, the minima
candidates, their Merge by Distance result, the snapped points (Geometry Proximity) and the
points the normal filter keeps. Coordinates are Blender's (Z up), exact float32 values.
"""
import json
import math
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
blend, out = args[0], args[1]

with bpy.data.libraries.load(blend, link=False) as (src, dst):
    dst.node_groups = [name for name in src.node_groups]

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)


def box(sx, sy, sz, cz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(x, y, cz + z) for z in (-hz, hz) for y in (-hy, hy) for x in (-hx, hx)]
    f = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return v, f


sv, sf = box(4, 4, 10, 10)
cv, cf = box(20, 20, 4, 17)
mesh = bpy.data.meshes.new('mushroom')
mesh.from_pydata(sv + cv, [], sf + [tuple(i + 8 for i in face) for face in cf])
mesh.update()
model = bpy.data.objects.new('mushroom', mesh)
bpy.context.scene.collection.objects.link(model)

host_mesh = bpy.data.meshes.new('host')
host = bpy.data.objects.new('host', host_mesh)
bpy.context.scene.collection.objects.link(host)

group = bpy.data.node_groups['SLASG_VertexScatter']
mod = host.modifiers.new('scatter', 'NODES')
mod.node_group = group
inputs = {item.name: item.identifier for item in group.interface.items_tree
          if item.item_type == 'SOCKET' and item.in_out == 'INPUT'}
def set_input(name, value):
    getattr(mod.properties.inputs, inputs[name]).value = value


set_input('Taget Type', 'Object')
set_input('Target Object', model)
set_input('Spacing', 2.0)
set_input('Angle', math.radians(45.0))
# Resin UV's patched scatter (Reinforce Overhang Edges, the default) drops every SDF ridge
# candidate; a Ridge Angle of pi does the same in the stock group, leaving the minima alone.
set_input('Ridge Angle', math.pi)

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
    evaluated = host.evaluated_get(depsgraph).data
    return evaluated


def points(evaluated):
    return [list(v.co) for v in evaluated.vertices]


stages = {}
r = capture(nodes['Reroute'].outputs[0])
stages['R'] = points(r)
stages['R_normals'] = [list(n.vector) for n in r.vertex_normals]
stages['R_faces'] = [list(p.vertices) for p in r.polygons]
stages['candidates'] = points(capture(nodes['Delete Geometry.008'].outputs[0]))
stages['merged'] = points(capture(nodes['Merge by Distance.001'].outputs[0]))
stages['snapped'] = points(capture(nodes['Set Position.004'].outputs[0]))
stages['kept'] = points(capture(nodes['Delete Geometry.009'].outputs[0]))
proximity = nodes['Geometry Proximity.003']
stages['proximity_target'] = getattr(proximity, 'target_element', None)

for link in [link for link in group.links if link.to_node == group_out]:
    group.links.remove(link)
for a, b in original:
    group.links.new(a, b)

json.dump(stages, open(out, 'w'))
print({key: len(value) if isinstance(value, list) else value for key, value in stages.items()})
