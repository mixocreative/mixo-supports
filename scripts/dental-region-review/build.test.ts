import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseStl } from '../../src/core/import/stl';
import { placementMatrix, transformPositions } from '../../src/core/transform';
import { buildDentalReview } from './build';
import { exportDentalRegionReview } from './review';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('complete dental GLB review', () => {
  it('reuses app orientation, placement, and support build and exports all layers', async () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.placement.points.length).toBeGreaterThan(0);
    expect(review.supports.indices.length).toBeGreaterThan(0);
    expect(review.supports.components.some((part) => part.part === 'neck')).toBe(true);
    expect(review.supports.dropped.length).toBeLessThan(review.placement.points.length);
    expect(review.frame.position[1]).toBeGreaterThan(0);

    const glb = await exportDentalRegionReview(mesh, review.region, {
      supports: review.supports, frame: review.frame,
      proposedTips: review.placement.points.length, droppedTips: review.supports.dropped.length,
    });
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
      nodes: { name?: string }[]; scenes: { name?: string }[] };
    const names = json.nodes.map((node) => node.name);
    expect(names).toContain('GOLD app-generated support mesh');
    expect(names).toContain('TEAL legacy broad mask NOT safe');
    expect(names).toContain('BLUE outer sharp-ridge contour');
    expect(names).toContain('GREEN outer ridge connector paths');
    expect(names).toContain('RED central opening contour');
    const loaded = await new GLTFLoader().parseAsync(glb, '');
    const model = loaded.scene.getObjectByName('TEAL_legacy_broad_mask_NOT_safe');
    const supports = loaded.scene.getObjectByName('GOLD_app-generated_support_mesh');
    expect(model).toBeDefined();
    expect(supports).toBeDefined();
    const modelBounds = new THREE.Box3().setFromObject(model!);
    const supportBounds = new THREE.Box3().setFromObject(supports!);
    expect(modelBounds.min.y).toBeGreaterThan(4.9);
    expect(supportBounds.min.y).toBeLessThan(1);
    expect(supportBounds.max.y).toBeGreaterThan(modelBounds.min.y);
  }, 180000);

  it('finds the same candidate and generates supports after scrambling the only available STL', () => {
    const original = reference();
    const scrambled = { ...original, positions: transformPositions(original.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [1.1, -2.2, 0.7] })) };
    const review = buildDentalReview(scrambled);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.region.outerEdges.length / 2).toBe(2665);
    expect(review.region.openingEdges.length / 2).toBe(339);
    expect(review.placement.points.length).toBeGreaterThan(0);
    expect(review.supports.components.some((part) => part.part === 'neck')).toBe(true);
    expect(review.supports.dropped.length).toBeLessThan(review.placement.points.length);
  }, 180000);
});
