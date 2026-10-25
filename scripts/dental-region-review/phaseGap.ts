export type ArcCandidate = { atMm: number; face: number };
export type UnresolvedArc = { fromMm: number; toMm: number; gapMm: number; candidates: ArcCandidate[] };

/** Diagnostic only; a candidate here has not passed any support-body safety check. */
export function unresolvedCircularArcs(perimeter: number, retainedAt: number[],
  alternate: ArcCandidate[], threshold: number): UnresolvedArc[] {
  if (!Number.isFinite(perimeter) || perimeter <= 0 || !Number.isFinite(threshold) || threshold < 0) return [];
  const normalized = (at: number) => ((at % perimeter) + perimeter) % perimeter;
  const retained = [...new Set(retainedAt.filter(Number.isFinite).map(normalized))].sort((a, b) => a - b);
  const candidates = alternate.filter(({ atMm }) => Number.isFinite(atMm));
  if (!retained.length) return perimeter > threshold
    ? [{ fromMm: 0, toMm: perimeter, gapMm: perimeter, candidates }]
    : [];
  return retained.flatMap((fromMm, index) => {
    const toMm = index === retained.length - 1 ? retained[0]! + perimeter : retained[index + 1]!;
    const gapMm = toMm - fromMm;
    if (gapMm <= threshold) return [];
    return [{ fromMm, toMm, gapMm, candidates: candidates.filter(({ atMm }) => {
      const offset = normalized(atMm - fromMm);
      return offset > 0 && offset < gapMm;
    }) }];
  });
}
