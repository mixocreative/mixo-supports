import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { placementMatrix, transformPositions } from '../test-support/matrix';
import { proposeDentalOrientation } from '../../src/core/analysis/dental';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { diagnose } from '../../src/dental/diagnose';
import { exportDentalRegionReview } from './review';
import { parseStl } from '../test-support/rustImport';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('separate dental-region review exporter', () => {
  it('exports both detected edge loops and the two exact face regions from the detector result', async () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    expect(region.outerRidgeEdges.length / 2).toBe(2459);
    expect(region.outerConnectorEdges.length / 2).toBe(206);
    const glb = await exportDentalRegionReview(mesh, region);
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as { nodes: { name?: string }[] };
    const names = json.nodes.map((node) => node.name);
    expect(names).toContain('TEAL current narrow contact mask');
    expect(names).toContain('NEUTRAL faces outside contact mask');
    expect(names).not.toContain('TEAL legacy broad mask NOT safe');
    expect(names).toContain('BLUE outer sharp-ridge contour');
    expect(names).toContain('GREEN outer ridge connector paths');
    expect(names).toContain('RED central opening contour');
  }, 30000);

  it('places a scrambled aligner into the proposed dental pose in the exported GLB', async () => {
    const source = reference();
    const mesh = { ...source, positions: transformPositions(source.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [1.1, -2.2, 0.7] })) };
    const region = proposeDentalSupportRegion(mesh);
    const orientation = proposeDentalOrientation(mesh);
    expect(region.kind).toBe('proposal');
    expect(orientation.kind).toBe('proposal');
    if (region.kind !== 'proposal' || orientation.kind !== 'proposal') return;
    const glb = await exportDentalRegionReview(mesh, region);
    const jsonLength = new DataView(glb).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
      nodes: { name?: string; matrix?: number[] }[] };
    const rotation = json.nodes.find((node) => node.name === 'Unapproved dental support-region candidate')?.matrix;
    expect(rotation).toBeDefined();
    const mapped = new THREE.Vector3(...orientation.rim.openingDirection)
      .transformDirection(new THREE.Matrix4().fromArray(rotation!));
    expect(mapped.dot(new THREE.Vector3(0.03714905735095951, -0.6888892651222808, -0.7239140335269232))).toBeGreaterThan(0.999);
  }, 30000);

  it('colours every role per the contour spec, from the Rust diagnose layers', async () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const expected: Record<string, number> = {
      'TEAL current narrow contact mask': 0x1aa998,
      'NEUTRAL faces outside contact mask': 0xeceae5,
      'BLUE outer sharp-ridge contour': 0x007ed3,
      'GREEN outer ridge connector paths': 0x16b34f,
      'RED central opening contour': 0xee1938,
    };
    const layers = diagnose(mesh, { region }, 7);
    expect(layers.map((layer) => layer.name)).toEqual(Object.keys(expected));
    for (const layer of layers) expect(layer.color, layer.name).toBe(expected[layer.name]);
    const teal = layers.find((layer) => layer.color === 0x1aa998)!;
    const neutral = layers.find((layer) => layer.color === 0xeceae5)!;
    const strip = region.contactFaces!.reduce((sum, face) => sum + face, 0);
    expect(teal.indices.length / 3).toBe(strip);
    expect(neutral.indices.length / 3).toBe(region.contactFaces!.length - strip);

    // The written GLB carries the same colours (three stores them linear).
    const glb = await exportDentalRegionReview(mesh, region);
    const jsonLength = new DataView(glb).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
      nodes: { name?: string; mesh?: number }[]; meshes: { primitives: { material: number }[] }[];
      materials: { pbrMetallicRoughness: { baseColorFactor: number[] } }[] };
    for (const [name, hex] of Object.entries(expected)) {
      const node = json.nodes.find((candidate) => candidate.name === name)!;
      const [r, g, b] = json.materials[json.meshes[node.mesh!]!.primitives[0]!.material]!.pbrMetallicRoughness.baseColorFactor;
      expect(new THREE.Color().setRGB(r!, g!, b!, THREE.LinearSRGBColorSpace).getHex(), name).toBe(hex);
    }
  }, 60000);
});
