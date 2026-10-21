import { describe, expect, it, vi } from 'vitest';
import type { Vector } from '../core/vec3';
import { brushFill, createStroke, zoneFill } from './stroke';

describe('createStroke', () => {
  it('begins on the left button only', () => {
    const stroke = createStroke();
    expect(stroke.begin(2)).toBe(false);
    expect(stroke.begin(1)).toBe(false);
    expect(stroke.active).toBe(false);
    expect(stroke.begin(0)).toBe(true);
    expect(stroke.active).toBe(true);
  });

  it('samples while the button is held and ends on a move with no button (a release the window never saw)', () => {
    const onEnd = vi.fn();
    const stroke = createStroke(onEnd);
    expect(stroke.move(true)).toBe('idle');
    stroke.begin(0);
    expect(stroke.move(true)).toBe('sample');
    expect(stroke.move(false)).toBe('end');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(stroke.active).toBe(false);
    expect(stroke.move(false)).toBe('idle');
  });

  it('ends once on release, cancel or blur: end is idempotent', () => {
    const onEnd = vi.fn();
    const stroke = createStroke(onEnd);
    expect(stroke.end()).toBe(false);
    stroke.begin(0);
    expect(stroke.end()).toBe(true);
    expect(stroke.end()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a new press ends the stroke still open first', () => {
    const onEnd = vi.fn();
    const stroke = createStroke(onEnd);
    stroke.begin(0);
    stroke.samples([0, 0, 0], brushFill(1));
    expect(stroke.begin(2)).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
    expect(stroke.begin(0)).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // The new stroke starts afresh: no gap filled from the old one.
    expect(stroke.samples([5, 0, 0], brushFill(1))).toEqual([[5, 0, 0]]);
  });

  it('samples nothing outside a stroke', () => {
    expect(createStroke().samples([0, 0, 0], brushFill(1))).toEqual([]);
  });
});

describe('Drag over fill (brushFill)', () => {
  it('fills the gap of a fast drag and always paints the hit itself', () => {
    const stroke = createStroke();
    stroke.begin(0);
    expect(stroke.samples([0, 0, 0], brushFill(1))).toEqual([[0, 0, 0]]);
    const jump = stroke.samples([3, 0, 0], brushFill(1));
    expect(jump.at(-1)).toEqual([3, 0, 0]);
    // Every point of the 3 mm jump lies within the 1 mm brush of some sample.
    for (let x = 0; x <= 3; x += 0.25) expect(jump.some(([sx]) => Math.abs(sx - x) <= 1)).toBe(true);
    // A short move paints only the hit.
    expect(stroke.samples([3.2, 0, 0], brushFill(1))).toEqual([[3.2, 0, 0]]);
  });
});

describe('zone fill (zoneFill)', () => {
  it('lays a stamp only once the brush moved far enough, filling the gap', () => {
    const stroke = createStroke();
    stroke.begin(0);
    expect(stroke.samples([0, 0, 0], zoneFill(2))).toEqual([[0, 0, 0]]);
    // Closer than the stamp spacing: no stamp, and the last stamp stays the reference.
    expect(stroke.samples([0.4, 0, 0], zoneFill(2))).toEqual([]);
    const far = stroke.samples([6, 0, 0], zoneFill(2));
    expect(far.at(-1)).toEqual([6, 0, 0]);
    expect(far.length).toBeGreaterThan(1);
    const xs = [0, ...far.map(([x]) => x)];
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('starts each stroke without a reference stamp', () => {
    const stroke = createStroke();
    stroke.begin(0);
    stroke.samples([0, 0, 0], zoneFill(2));
    stroke.end();
    stroke.begin(0);
    const first: Vector[] = stroke.samples([10, 0, 0], zoneFill(2));
    expect(first).toEqual([[10, 0, 0]]);
  });
});
