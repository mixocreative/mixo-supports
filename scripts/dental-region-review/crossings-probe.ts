import { readFileSync } from 'node:fs';
import { crossingAutomaticBodyContactIds } from '../../src/core/supports/dentalBodyClearance';
import { buildDentalReview } from './build';
import { diagnoseSupportCrossings } from './crossings';
import { inverseTransformPoint, transformPoint } from '../../src/state/transform';
import { positionId } from '../../src/core/analysis/placement';
import { largestCircularGap } from './rimCoverage';
import { sampleDiagnosticContourContacts } from '../../src/core/analysis/dentalContourContacts';
import { defaultDentalContactFootprintSettings } from '../../src/core/analysis/dentalContactFootprint';
import { unresolvedCircularArcs } from './phaseGap';
import { selectDentalGapAlternates } from '../../src/core/analysis/dentalGapAlternates';
import { parseStl } from '../test-support/rustImport';

const input = process.argv[2];
if (!input) throw new Error('Usage: npx vite-node --script scripts/dental-region-review/crossings-probe.ts model.stl');
const bytes = readFileSync(input);
const model = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const review = buildDentalReview(model);
if (review.kind !== 'proposal') throw new Error(`Dental review inconclusive: ${review.reason}`);
const orientationOnly = { position: [0, 0, 0] as [number, number, number], rotation: review.frame.rotation };
const contactPositions = new Map(review.placement.points.map((point) => [point.id,
  inverseTransformPoint(orientationOnly, point.position)] as const));
const report = diagnoseSupportCrossings(model, review.supports, review.region.contactFaces, contactPositions);
const coreCrossingIds = crossingAutomaticBodyContactIds(model, review.supports,
  new Set(review.placement.points.map((point) => point.id)));
const builtIds = new Set(review.supports.components.flatMap((component) => component.contactId ? [component.contactId] : []));
const candidates = review.region.contacts;
if (!candidates) throw new Error('Dental review has no contact samples');
const contourCoverage = (edges: Uint32Array, mask: Uint8Array, spacing: number) => {
  let perimeter = 0;
  for (let at = 0; at < edges.length; at += 2) {
    const a = edges[at]! * 3, b = edges[at + 1]! * 3;
    perimeter += Math.hypot(model.positions[a]! - model.positions[b]!,
      model.positions[a + 1]! - model.positions[b + 1]!, model.positions[a + 2]! - model.positions[b + 2]!);
  }
  const sampled = candidates.filter((contact) => mask[contact.face] === 1);
  const retained = sampled.filter((contact) => builtIds.has(positionId(transformPoint(orientationOnly, contact.position))));
  const shifted = sampleDiagnosticContourContacts(model, edges, mask,
    { spacing, phaseMm: 0, maxSearchDistance: defaultDentalContactFootprintSettings.maxSearchDistance });
  const retainedAt = retained.map((contact) => contact.distanceAlongContour);
  return { perimeterMm: perimeter, proposed: sampled.length, retained: retained.length,
    maxProposedGapMm: largestCircularGap(perimeter, sampled.map((contact) => contact.distanceAlongContour)),
    maxRetainedGapMm: largestCircularGap(perimeter, retainedAt),
    omittedAtMm: sampled.filter((contact) => !builtIds.has(positionId(transformPoint(orientationOnly, contact.position))))
      .map((contact) => contact.distanceAlongContour),
    alternatePhaseArcs: shifted.kind === 'proposal'
      ? unresolvedCircularArcs(perimeter, retainedAt,
        shifted.contacts.map((contact) => ({ atMm: contact.distanceAlongContour, face: contact.face })), spacing * 2)
      : { inconclusive: shifted.reason },
    selectedGapAlternates: shifted.kind === 'proposal'
      ? selectDentalGapAlternates(perimeter, retainedAt, shifted.contacts, spacing * 2)
        .map((contact) => ({ atMm: contact.distanceAlongContour, face: contact.face }))
      : [],
  };
};
const rimCoverage = {
  outer: contourCoverage(review.region.outerEdges, review.bands.outerOtherSide,
    defaultDentalContactFootprintSettings.outerSpacing),
  opening: contourCoverage(review.region.openingEdges, review.bands.innerOtherSide,
    defaultDentalContactFootprintSettings.innerSpacing),
};
process.stdout.write(JSON.stringify({ proposed: review.placement.points.length, omitted: review.supports.dropped.length,
  modelFaces: model.indices.length / 3, supportFaces: review.supports.indices.length / 3, coreCrossingIds, rimCoverage, ...report }) + '\n');
