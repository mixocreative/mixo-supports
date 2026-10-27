import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { TriangleMesh } from '../../src/core/analysis/types';
import type { DentalRegionProposal } from '../../src/core/analysis/dentalRegion';
import { proposeDentalOrientation, rotationToDentalPose } from '../../src/core/analysis/dental';
import type { GeneratedSupportMesh } from '../../src/core/supports/mesh';
import type { JobTransform } from '../../src/core/jobs';
import { diagnose } from '../../src/dental/diagnose';
import type { DentalDiagnosticBands } from '../../src/core/analysis/dentalContactBand';
import type { DiagnosticContourContact } from '../../src/core/analysis/dentalContourContacts';
import { REFERENCE_PROFILE } from './profile';

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
type ReviewLayers = { supports: GeneratedSupportMesh; frame: JobTransform; bands?: DentalDiagnosticBands;
  diagnosticContacts?: { outer: { contacts: DiagnosticContourContact[]; skippedSamples: number };
    inner: { contacts: DiagnosticContourContact[]; skippedSamples: number } };
  proposedTips: number; droppedTips: number };

/** Diagnostic GLB only. Names and metadata never include the input STL filename or patient fields. */
export async function exportDentalRegionReview(mesh: TriangleMesh, region: Region, layers?: ReviewLayers): Promise<ArrayBuffer> {
  if (region.contactFaces?.length !== mesh.indices.length / 3) throw new Error('Contact mask does not match mesh triangles');
  if (layers && layers.supports.indices.length === 0) throw new Error('Support build returned no geometry');
  const scene = new THREE.Group();
  scene.name = 'Unapproved dental support-region candidate';
  const root = new THREE.Group();
  root.add(scene);
  // Every layer, with its role colour, comes from the Rust `diagnose`; this script only writes them.
  for (const layer of diagnose(mesh, {
    region, ...(layers ? { supports: layers.supports } : {}),
    ...(layers?.bands ? { bands: layers.bands } : {}),
    ...(layers?.diagnosticContacts ? { contacts: { outer: layers.diagnosticContacts.outer.contacts, inner: layers.diagnosticContacts.inner.contacts } } : {}),
  }, REFERENCE_PROFILE)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
    if (layer.indices.length > 0) geometry.setIndex(new THREE.BufferAttribute(layer.indices, 1));
    const visual = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: layer.color, side: THREE.DoubleSide }));
    visual.name = layer.name;
    scene.add(visual);
  }
  if (layers) {
    scene.position.set(...layers.frame.position);
    scene.userData = { proposedTips: layers.proposedTips, droppedTips: layers.droppedTips,
      source: 'app dental placement and support builder', approval: 'diagnostic only' };
  }

  const orientation = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
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
