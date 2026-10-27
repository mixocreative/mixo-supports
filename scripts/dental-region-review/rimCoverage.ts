/** Largest arclength without a built contact on a closed contour, including the wraparound seam. */
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
