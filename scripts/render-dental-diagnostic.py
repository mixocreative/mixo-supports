"""Render fixed orthographic views of a diagnostic GLB with Blender, without changing it."""
import bpy
import mathutils
import os
import sys

args = sys.argv[sys.argv.index('--') + 1:]
source, directory = args
os.makedirs(directory, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
points = [obj.matrix_world @ mathutils.Vector(corner) for obj in meshes for corner in obj.bound_box]
low = mathutils.Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
high = mathutils.Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
centre = (low + high) / 2
span = max(high - low)

bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span * 1.35
camera.data.clip_end = span * 5
bpy.context.scene.camera = camera

for direction in [(1, 1, 1), (-1, -1, -1), (0, 0, 1), (0, 0, -1), (1, 0, 0), (0, 1, 0)]:
    view = mathutils.Vector(direction).normalized()
    camera.location = centre + view * span * 2
    camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.light_add(type='AREA', location=centre + view * span)
    lamp = bpy.context.object
    lamp.data.energy = 2500
    lamp.data.shape = 'DISK'
    lamp.data.size = span * 1.5
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 16
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 750
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    bpy.context.scene.render.filepath = os.path.join(directory, f'view_{direction[0]}_{direction[1]}_{direction[2]}.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(lamp, do_unlink=True)
