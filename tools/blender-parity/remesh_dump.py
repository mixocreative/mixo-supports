"""Dump SLASG_Line's remesh of the probe spike (Mesh to SDF Grid -> Grid to Mesh).

Usage:
  blender --background --factory-startup --python remesh_dump.py -- <out.json> <voxel> <adaptivity>

remesh_spike.json holds the unique vertices for voxel 0.8, adaptivity 0 (the mesh that
src/core/supports/remesh.ts reproduces vertex for vertex).
"""
import json
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
out, voxel, adaptivity = args[0], float(args[1]), float(args[2])

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)
mesh = bpy.data.meshes.new('spike')
# The probe model: apex down at z = 5, top +-3 mm at z = 8.
mesh.from_pydata([(0, 0, 5), (-3, -3, 8), (3, -3, 8), (3, 3, 8), (-3, 3, 8)], [],
                 [(0, 2, 1), (0, 3, 2), (0, 4, 3), (0, 1, 4), (1, 2, 3, 4)])
mesh.update()
obj = bpy.data.objects.new('spike', mesh)
bpy.context.scene.collection.objects.link(obj)

tree = bpy.data.node_groups.new('remesh', 'GeometryNodeTree')
tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
group_in = tree.nodes.new('NodeGroupInput')
group_out = tree.nodes.new('NodeGroupOutput')
to_sdf = tree.nodes.new('GeometryNodeMeshToSDFGrid')
to_mesh = tree.nodes.new('GeometryNodeGridToMesh')
to_sdf.inputs['Voxel Size'].default_value = voxel
to_sdf.inputs['Band Width'].default_value = 3
to_mesh.inputs['Threshold'].default_value = 0.0
to_mesh.inputs['Adaptivity'].default_value = adaptivity
tree.links.new(group_in.outputs[0], to_sdf.inputs['Mesh'])
tree.links.new(to_sdf.outputs[0], to_mesh.inputs['Grid'])
tree.links.new(to_mesh.outputs[0], group_out.inputs[0])
obj.modifiers.new('remesh', 'NODES').node_group = tree

evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
json.dump({
    'verts': [list(v.co) for v in evaluated.vertices],
    'faces': [list(p.vertices) for p in evaluated.polygons],
    'normals': [list(p.normal) for p in evaluated.polygons],
}, open(out, 'w'))
print('verts', len(evaluated.vertices), 'faces', len(evaluated.polygons))
