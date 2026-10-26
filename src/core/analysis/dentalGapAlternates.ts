type ArcContact = { distanceAlongContour: number; face: number };

/** Provisional source-face candidates only; this does not authorize a support body. */
export function selectDentalGapAlternates<T extends ArcContact>(
  perimeter: number, retainedAt: readonly number[], alternates: readonly T[], threshold: number,
): T[] {
  if (!Number.isFinite(perimeter) || perimeter <= 0 || !Number.isFinite(threshold) || threshold <= 0 ||
    retainedAt.length === 0 || retainedAt.some((at) => !Number.isFinite(at) || at < 0 || at >= perimeter)) return [];
  const retained = [...new Set(retainedAt)].sort((a, b) => a - b);
  const candidates = alternates.filter(({ distanceAlongContour: at }) =>
    Number.isFinite(at) && at >= 0 && at < perimeter);
  const chosen: T[] = [];
  for (let index = 0; index < retained.length; index++) {
    const from = retained[index]!;
    const to = index === retained.length - 1 ? retained[0]! + perimeter : retained[index + 1]!;
    const gap = to - from;
    if (gap <= threshold) continue;
    const midpoint = gap / 2;
    const within = candidates.map((contact) => ({ contact,
      offset: (contact.distanceAlongContour - from + perimeter) % perimeter }))
      .filter(({ offset }) => offset > 1e-6 && offset < gap - 1e-6)
      .sort((a, b) => Math.abs(a.offset - midpoint) - Math.abs(b.offset - midpoint) ||
        a.offset - b.offset || a.contact.face - b.contact.face);
    if (within[0]) chosen.push(within[0].contact);
  }
  return chosen;
}
