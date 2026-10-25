import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { TriangleMesh } from '../../src/core/analysis/types';
import type { DentalRegionProposal } from '../../src/core/analysis/dentalRegion';
import { proposeDentalOrientation, rotationToDentalPose } from '../../src/core/analysis/dental';
import type { GeneratedSupportMesh } from '../../src/core/supports/mesh';
import type { JobTransform } from '../../src/core/jobs';
import type { DentalDiagnosticBands } from '../../src/core/analysis/dentalContactBand';
import type { DiagnosticContourContact } from '../../src/core/analysis/dentalContourContacts';

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
type ReviewLayers = { supports: GeneratedSupportMesh; frame: JobTransform; bands?: DentalDiagnosticBands;
  diagnosticContacts?: { outer: { contacts: DiagnosticContourContact[]; skippedSamples: number };
    inner: { contacts: DiagnosticContourContact[]; skippedSamples: number } };
  proposedTips: number; droppedTips: number };

function contactMarkers(contacts: DiagnosticContourContact[], radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const triangles = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (const contact of contacts) {
    const base = positions.length / 3;
    for (const direction of directions) for (let axis = 0; axis < 3; axis += 1) {
      positions.push(contact.position[axis]! + contact.normal[axis]! * 0.12 + direction[axis]! * radius);
    }
    for (const triangle of triangles) indices.push(...triangle.map((index) => base + index));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function faceGeometry(mesh: TriangleMesh, mask: Uint8Array, selected: 0 | 1): THREE.BufferGeometry {
  const indices: number[] = [];
  for (let face = 0; face < mask.length; face += 1) {
    if (mask[face] !== selected) continue;
    const offset = face * 3;
    indices.push(mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function offsetFaceGeometry(mesh: TriangleMesh, mask: Uint8Array, offset: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let face = 0; face < mask.length; face += 1) {
    if (!mask[face]) continue;
    const at = face * 3;
    const points = [0, 1, 2].map((corner) => {
      const vertex = mesh.indices[at + corner]! * 3;
      return new THREE.Vector3(mesh.positions[vertex]!, mesh.positions[vertex + 1]!, mesh.positions[vertex + 2]!);
    });
    const normal = new THREE.Vector3().crossVectors(
      points[1]!.clone().sub(points[0]!), points[2]!.clone().sub(points[0]!)).normalize();
    for (const point of points) {
      point.addScaledVector(normal, offset);
      positions.push(point.x, point.y, point.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function edgeTubes(mesh: TriangleMesh, pairs: Uint32Array, radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const sides = 6;
  for (let at = 0; at < pairs.length; at += 2) {
    const first = pairs[at]! * 3, second = pairs[at + 1]! * 3;
    const a = new THREE.Vector3(mesh.positions[first]!, mesh.positions[first + 1]!, mesh.positions[first + 2]!);
    const b = new THREE.Vector3(mesh.positions[second]!, mesh.positions[second + 1]!, mesh.positions[second + 2]!);
    const axis = b.clone().sub(a).normalize();
    if (!Number.isFinite(axis.x)) continue;
    const reference = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const base = positions.length / 3;
    for (const centre of [a, b]) for (let side = 0; side < sides; side += 1) {
      const angle = side * Math.PI * 2 / sides;
      const point = centre.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
    }
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      indices.push(base + side, base + next, base + sides + side,
        base + next, base + sides + next, base + sides + side);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Diagnostic GLB only. Names and metadata never include the input STL filename or patient fields. */
export async function exportDentalRegionReview(mesh: TriangleMesh, region: Region, layers?: ReviewLayers): Promise<ArrayBuffer> {
  if (region.allowedFaces.length !== mesh.indices.length / 3) throw new Error('Region mask does not match mesh triangles');
  const scene = new THREE.Group();
  scene.name = 'Unapproved dental support-region candidate';
  const root = new THREE.Group();
  root.add(scene);
  const add = (name: string, geometry: THREE.BufferGeometry, color: number) => {
    const visual = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    visual.name = name;
    scene.add(visual);
  };
  add('TEAL legacy broad mask NOT safe', faceGeometry(mesh, region.allowedFaces, 1), 0x1aa998);
  add('NEUTRAL other faces', faceGeometry(mesh, region.allowedFaces, 0), 0xeceae5);
  add('BLUE outer sharp-ridge contour', edgeTubes(mesh, region.outerRidgeEdges, 0.23), 0x007ed3);
  add('GREEN outer ridge connector paths', edgeTubes(mesh, region.outerConnectorEdges, 0.23), 0x16b34f);
  add('RED central opening contour', edgeTubes(mesh, region.openingEdges, 0.23), 0xee1938);
  if (layers) {
    if (layers.bands) {
      const bands = layers.bands;
      add('VIOLET diagnostic outer opening-side strip', offsetFaceGeometry(mesh, bands.outerOpeningSide, 0.08), 0x8844cc);
      add('AMBER diagnostic outer other-side strip', offsetFaceGeometry(mesh, bands.outerOtherSide, 0.08), 0xffa000);
      add('CYAN diagnostic inner opening-side strip', offsetFaceGeometry(mesh, bands.innerOpeningSide, 0.08), 0x00c7dd);
      add('MAGENTA diagnostic inner other-side strip', offsetFaceGeometry(mesh, bands.innerOtherSide, 0.08), 0xe33fa9);
    }
    if (layers.diagnosticContacts) {
      add('LIME diagnostic outer sampled contacts NOT generated',
        contactMarkers(layers.diagnosticContacts.outer.contacts, 0.35), 0xb8f500);
      add('PINK diagnostic inner sampled contacts NOT generated',
        contactMarkers(layers.diagnosticContacts.inner.contacts, 0.35), 0xff61b8);
    }
    if (layers.supports.indices.length === 0) throw new Error('Support build returned no geometry');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layers.supports.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(layers.supports.indices, 1));
    add('GOLD app-generated support mesh', geometry, 0xb99b59);
    scene.position.set(...layers.frame.position);
    scene.userData = { proposedTips: layers.proposedTips, droppedTips: layers.droppedTips,
      source: 'app dental placement and support builder', approval: 'diagnostic only' };
  }

  const orientation = proposeDentalOrientation(mesh);
  if (orientation.kind !== 'proposal') throw new Error('Dental orientation is inconclusive');
  const rotation = rotationToDentalPose(mesh, orientation.rim);
  if (!rotation) throw new Error('Dental pose is inconclusive');
  scene.rotation.set(...rotation);


  // GLTFExporter reads its binary Blob through FileReader, which Node does not provide.
  class BinaryFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    async readAsArrayBuffer(blob: Blob): Promise<void> {
      this.result = await blob.arrayBuffer();
      this.onloadend?.();
    }
  }
  const host = globalThis as unknown as { FileReader?: typeof FileReader };
  const prior = host.FileReader;
  if (!prior) host.FileReader = BinaryFileReader as unknown as typeof FileReader;
  try {
    const binary = await new GLTFExporter().parseAsync(root, { binary: true });
    if (!(binary instanceof ArrayBuffer)) throw new Error('Expected binary GLB');
    return binary;
  } finally {
    if (!prior) delete host.FileReader;
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
  }
}
