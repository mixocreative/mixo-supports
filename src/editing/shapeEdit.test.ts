import { describe, expect, it } from 'vitest';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { customisedAmong, scopeCounts, shapeHeading, shapePatch, shapeView } from './shapeEdit';

const defaults: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [] };
const overrides = { a: { pointDiameter: 0.5 }, b: { pointDiameter: 0.5, neckLength: 4 }, c: {} };

describe('shapeView', () => {
  it('shows the defaults when nothing is selected', () => {
    expect(shapeView(defaults, overrides, []).pointDiameter).toBe(defaults.pointDiameter);
  });

  it('shows a value the selected supports share, own or default, and leaves a differing key undefined', () => {
    const view = shapeView(defaults, overrides, ['a', 'b']);
    expect(view.pointDiameter).toBe(0.5);
    expect(view.neckLength).toBeUndefined();
    expect(view.baseDiameter).toBe(defaults.baseDiameter);
    expect(shapeView(defaults, overrides, ['a', 'c']).pointDiameter).toBeUndefined();
  });
});

describe('shapePatch', () => {
  it('writes only a changed key, and nothing for a value the field already shows', () => {
    const view = shapeView(defaults, overrides, ['a', 'b']);
    expect(shapePatch(view, 'pointDiameter', 0.5)).toBeUndefined();
    expect(shapePatch(view, 'pointDiameter', 0.6)).toEqual({ pointDiameter: 0.6 });
    expect(shapePatch(view, 'neckLength', defaults.neckLength)).toEqual({ neckLength: defaults.neckLength });
  });
});

describe('counts', () => {
  it('count the supports in scope and those with settings of their own, an empty entry not counting', () => {
    expect(customisedAmong(overrides, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b']);
    expect(scopeCounts([{ ids: ['a', 'b', 'c'], overrides }, { ids: ['x'], overrides: {} }])).toEqual({ supports: 4, customised: 2 });
  });

  it('names the heading for the defaults and for a selection', () => {
    expect(shapeHeading(0)).toEqual({ key: 'Support shape · defaults' });
    expect(shapeHeading(3)).toEqual({ key: 'Support shape · {n} selected', vars: { n: 3 } });
  });
});
