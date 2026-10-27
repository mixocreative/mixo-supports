import type { TriangleMesh } from '../../../../src/core/analysis/types';

export type DentalRimKind = 'outer' | 'opening';

export interface DentalRimMeasure {
  rim: DentalRimKind;
  perimeterMm: number;
  spacingMm: number;
  retainedAtMm: readonly number[];
}

export interface DentalRimCoverageItem {
  perimeterMm: number;
  retained: number;
  maxGapMm: number;
  /** This is a review trigger, not a clinical acceptance threshold. */
  reviewGapMm: number;
  needsReview: boolean;
}

export interface DentalRimCoverage {
  outer: DentalRimCoverageItem;
  opening: DentalRimCoverageItem;
  needsReview: boolean;
}

/** Largest arclength without a built contact, including the wraparound seam. */
export function largestCircularGap(perimeter: number, positions: readonly number[]): number {
  if (!Number.isFinite(perimeter) || perimeter <= 0) throw new Error('Contour perimeter must be positive');
  if (positions.some((position) => !Number.isFinite(position) || position < 0 || position >= perimeter)) {
    throw new Error('Contact arclength is outside contour perimeter');
  }
  if (positions.length === 0) return perimeter;
  const ordered = [...positions].sort((a, b) => a - b);
  let largest = perimeter + ordered[0]! - ordered[ordered.length - 1]!;
  for (let index = 1; index < ordered.length; index++) largest = Math.max(largest, ordered[index]! - ordered[index - 1]!);
  return largest;
}

export function contourPerimeter(mesh: TriangleMesh, edges: Uint32Array): number {
  let perimeter = 0;
  for (let at = 0; at < edges.length; at += 2) {
    const a = edges[at]! * 3, b = edges[at + 1]! * 3;
    perimeter += Math.hypot(mesh.positions[a]! - mesh.positions[b]!,
      mesh.positions[a + 1]! - mesh.positions[b + 1]!, mesh.positions[a + 2]! - mesh.positions[b + 2]!);
  }
  return perimeter;
}

/** Review gaps above twice the intended tip spacing; never infer that a smaller gap is clinically safe. */
export function measureDentalRimCoverage(measures: readonly [DentalRimMeasure, DentalRimMeasure]): DentalRimCoverage {
  const item = (rim: DentalRimKind): DentalRimCoverageItem => {
    const measure = measures.find((candidate) => candidate.rim === rim);
    if (!measure || !Number.isFinite(measure.spacingMm) || measure.spacingMm <= 0) throw new Error(`Invalid ${rim} rim measure`);
    const maxGapMm = largestCircularGap(measure.perimeterMm, measure.retainedAtMm);
    const reviewGapMm = measure.spacingMm * 2;
    return { perimeterMm: measure.perimeterMm, retained: measure.retainedAtMm.length,
      maxGapMm, reviewGapMm, needsReview: maxGapMm > reviewGapMm + 1e-6 };
  };
  const outer = item('outer'), opening = item('opening');
  return { outer, opening, needsReview: outer.needsReview || opening.needsReview };
}
