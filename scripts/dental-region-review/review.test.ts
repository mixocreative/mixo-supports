import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseStl } from '../../src/core/import/stl';
import { placementMatrix, transformPositions } from '../../src/core/transform';
import { proposeDentalOrientation } from '../../src/core/analysis/dental';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { exportDentalRegionReview } from './review';

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
});
