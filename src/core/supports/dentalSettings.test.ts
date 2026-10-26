import { expect, it } from 'vitest';
import { defaultSupportSettings } from './settings';
import { dentalBuildSettings } from './dentalSettings';

it('forces roof and cage off for a dental build without changing other support settings', () => {
  const input = { ...defaultSupportSettings, roofMode: 'CAGE' as const,
    roofSeededModes: ['CAGE' as const], scatterAutoTree: true, pillarDiameter: 0.9 };
  const result = dentalBuildSettings(input);
  expect(result.roofMode).toBe('OFF');
  expect(result.roofSeededModes).toEqual([]);
  expect(result.scatterAutoTree).toBe(true);
  expect(result.pillarDiameter).toBe(0.9);
  expect(input.roofMode).toBe('CAGE');
});

it('defaults dental trees and braces on, but lets either be disabled independently', () => {
  const input = { ...defaultSupportSettings, scatterAutoTree: false, trussEnabled: false };
  expect(dentalBuildSettings(input)).toMatchObject({ scatterAutoTree: true, trussEnabled: true });
  expect(dentalBuildSettings(input, { treeEnabled: false, bracesEnabled: true }))
    .toMatchObject({ scatterAutoTree: false, trussEnabled: true });
  expect(dentalBuildSettings(input, { treeEnabled: true, bracesEnabled: false }))
    .toMatchObject({ scatterAutoTree: true, trussEnabled: false });
});
