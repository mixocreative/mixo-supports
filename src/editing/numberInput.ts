/** A number setting's allowed range; `integer` rounds to whole numbers. */
export interface NumberLimits {
  min: number;
  max: number;
  integer?: boolean;
}

// A plain decimal (optional sign, digits with at most one point, optional exponent) followed by
// an optional unit the fields show: mm, °, deg or %.
const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:mm|°|deg|%)?$/i;

/**
 * A number typed the forgiving way: "2", "2.5", "2mm", "2 mm", "2,5" (decimal comma), "45°",
 * "30 %". Undefined for anything else, including NaN and infinity.
 */
export function parseNumber(text: string): number | undefined {
  let trimmed = text.trim();
  // One comma and no point is a decimal comma ("2,5"); anything else with a comma is unclear.
  if (trimmed.includes(',')) {
    if (trimmed.includes('.') || trimmed.indexOf(',') !== trimmed.lastIndexOf(',')) return undefined;
    trimmed = trimmed.replace(',', '.');
  }
  const match = NUMBER.exec(trimmed);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, limits: NumberLimits): number {
  const inside = Math.min(limits.max, Math.max(limits.min, value));
  return limits.integer ? Math.min(limits.max, Math.max(limits.min, Math.round(inside))) : inside;
}

/** The typed value held to the limits (clamped, never rejected); undefined when it is not a number. */
export function readNumberInput(text: string, limits: NumberLimits): { value: number; clamped: boolean } | undefined {
  const parsed = parseNumber(text);
  if (parsed === undefined) return undefined;
  const value = clamp(parsed, limits);
  return { value, clamped: value !== parsed };
}

/** Arrow Up / Down: one step up or down, held to the limits, rounded so 0.1 + 0.2 shows 0.3. */
export function stepNumber(value: number, step: number, direction: 1 | -1, limits: NumberLimits): number {
  return clamp(Number((value + direction * step).toFixed(6)), limits);
}

/** How a value shows in its field: at most four decimals, no trailing zeros. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}
