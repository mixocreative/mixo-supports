import { describe, expect, it } from 'vitest';
import { canvasCursor } from './style';

describe('canvasCursor', () => {
  const brush = { radius: 3, mode: 'select' } as const;
  it('shows the mode default, and the brush icon only while a brush is over the object', () => {
    expect(canvasCursor({ kind: 'none' }, false)).toBe('');
    expect(canvasCursor({ kind: 'pick' }, true)).toBe('default');
    expect(canvasCursor({ kind: 'add', remove: false }, true)).toBe('crosshair');
    expect(canvasCursor({ kind: 'drag', brush, sizing: false }, false)).toBe('grab');
    expect(canvasCursor({ kind: 'drag', brush, sizing: false }, true)).toContain('data:image/svg+xml');
    const zones = { kind: 'zones', brush: { radius: 3, kind: 'paint' } } as const;
    expect(canvasCursor(zones, false)).toBe('crosshair');
    expect(canvasCursor(zones, true)).not.toEqual(canvasCursor({ kind: 'drag', brush, sizing: false }, true));
  });
});

describe('canvasCursor in Drag over', () => {
  it('draws Unselect with a cursor of its own, not only another colour', () => {
    const at = (mode: 'select' | 'unselect') => canvasCursor({ kind: 'drag', brush: { radius: 3, mode }, sizing: false }, true);
    expect(at('unselect')).not.toEqual(at('select'));
    expect(decodeURIComponent(at('unselect'))).toContain('M23 19h7');
    expect(canvasCursor({ kind: 'drag', brush: { radius: 3, mode: 'unselect' }, sizing: false }, false)).toBe('grab');
  });
});
