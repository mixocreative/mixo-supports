import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readGolden } from '../test-support/golden';
import { placementMatrix, transformPositions } from '../../src/core/transform';
import { buildDentalReview } from './build';
import { exportDentalRegionReview } from './review';
import { parseStl } from '../test-support/rustImport';

/** Automatic contacts whose pillar crosses the model, as the Rust verdict lists them. */
const crossingAutomaticPillars = (supports: { verdict?: { issues: { contactId?: string; part: string; blocked: boolean; origin: string }[] } }) =>
  (supports.verdict?.issues ?? []).filter((issue) => issue.blocked && issue.origin === 'auto' && issue.part === 'pillar').map((issue) => issue.contactId);

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
    // The TS body check found no crossing automatic contact (recorded); the Rust verdict must name none either.
    expect(crossingAutomaticPillars(review.supports)).toEqual([]);
    expect(review.frame.position[1]).toBeGreaterThan(0);
    // Faces per band that also face down at 50 degrees in the plate frame, recorded from the TS classifier.
    const counts = readGolden<{ counts: Record<string, number> }>('review-reference').counts;
    const downwardBand = (mask: Uint8Array) => mask.reduce((sum, enabled) => sum + enabled, 0);
    for (const key of Object.keys(counts)) expect(downwardBand((review.bands as unknown as Record<string, Uint8Array>)[key]!)).toBeGreaterThanOrEqual(counts[key]!);
    expect(counts.outerOtherSide).toBeGreaterThan(100);
    expect(counts.innerOtherSide).toBeLessThan(10);
    expect(review.diagnosticContacts.outer.contacts.length).toBeGreaterThan(20);
    expect(review.diagnosticContacts.inner.contacts.length).toBeGreaterThan(5);
    expect(review.diagnosticContacts.outer.contacts.every((contact) => review.bands.outerOtherSide[contact.face] === 1)).toBe(true);
    expect(review.diagnosticContacts.inner.contacts.every((contact) => review.bands.innerOtherSide[contact.face] === 1)).toBe(true);

    const glb = await exportDentalRegionReview(mesh, review.region, {
      supports: review.supports, frame: review.frame,
      proposedTips: review.placement.points.length, droppedTips: review.supports.dropped.length,
      bands: review.bands, diagnosticContacts: review.diagnosticContacts,
    });
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
      nodes: { name?: string }[]; scenes: { name?: string }[] };
    const names = json.nodes.map((node) => node.name);
    expect(names).toContain('GOLD app-generated support mesh');
    expect(names).toContain('TEAL current narrow contact mask');
    expect(names).toContain('BLUE outer sharp-ridge contour');
    expect(names).toContain('GREEN outer ridge connector paths');
    expect(names).toContain('RED central opening contour');
    expect(names).toContain('VIOLET diagnostic outer opening-side strip');
    expect(names).toContain('AMBER diagnostic outer other-side strip');
    expect(names).toContain('CYAN diagnostic inner opening-side strip');
    expect(names).toContain('MAGENTA diagnostic inner other-side strip');
    expect(names).toContain('LIME diagnostic outer sampled contacts NOT generated');
    expect(names).toContain('PINK diagnostic inner sampled contacts NOT generated');
    const loaded = await new GLTFLoader().parseAsync(glb, '');
    const model = loaded.scene.getObjectByName('TEAL_current_narrow_contact_mask');
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
    expect(crossingAutomaticPillars(review.supports)).toEqual([]);
  }, 180000);
});
