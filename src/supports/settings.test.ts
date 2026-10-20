import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  defaultSupportSettings,
  PRESET_KEYS,
  presetValues,
  setRoofMode,
  toPlacementSettings,
  updateSetting,
} from './settings';

describe('support settings', () => {
  it('exposes every Blender support-tab setting group except bake and proxy copies', () => {
    for (const key of [
      'touchDiameter', 'touchDepth', 'neckDiameter', 'neckLength', 'maxNeckAngle',
      'pillarDiameter', 'treeSectionIncrement', 'baseDiameter', 'baseHeight',
      'trussEnabled', 'trussDiameter', 'trussAngle', 'trussSpacing', 'trussMinHeight', 'trussTopSpacing', 'trussDistanceLimit',
      'raftEnabled', 'raftExpandWidth', 'raftFloorThickness', 'raftWallHeight', 'raftWallThickness', 'raftWallAngle', 'voxelResolution',
      'roofMode', 'roofGap', 'cageSideGap', 'cageTopGap', 'cagePitch', 'cageRingDiameter',
      'columnCount', 'columnDiameter', 'diagonalEnabled', 'diagonalDiameter', 'braceConcentric', 'braceThickness', 'braceAngle',
      'storeyFloorThickness', 'storeyEncloseCeiling',
      'labelEnabled', 'labelText', 'labelSize', 'labelHeight', 'labelMargin', 'labelOffsetX', 'labelOffsetY',
      'previewMode', 'autoSnap', 'lowPolyMode', 'resolution',
      'scatterSpacing', 'scatterAngle', 'scatterSafeDistance', 'scatterFacingDown', 'scatterIslands', 'scatterRidgeAngle',
      'scatterAutoTree', 'scatterMergeDistance', 'scatterBranchDescent', 'reinforceOverhangEdges',
      'liftHeight', 'eraseRadius', 'preset',
    ]) {
      expect(defaultSupportSettings).toHaveProperty(key);
    }
    expect(defaultSupportSettings).not.toHaveProperty('proxy');
    expect(defaultSupportSettings).not.toHaveProperty('bake');
  });

  it('defaults to the Light preset with Blender values', () => {
    expect(defaultSupportSettings).toMatchObject({
      preset: 'LIGHT', touchDiameter: 0.5, neckDiameter: 0.3, neckLength: 2, pillarDiameter: 0.8,
      baseDiameter: 3, baseHeight: 1.2, liftHeight: 5, scatterSpacing: 2, roofMode: 'OFF', labelEnabled: true,
    });
    expect(JSON.parse(JSON.stringify(defaultSupportSettings))).toEqual(defaultSupportSettings);
  });

  it('applies preset values without resetting support spacing', () => {
    const dense = updateSetting(defaultSupportSettings, 'scatterSpacing', 1);
    const heavy = applyPreset('HEAVY', dense);

    expect(applyPreset('LIGHT').touchDiameter).toBeGreaterThan(0);
    expect(heavy).toMatchObject({ preset: 'HEAVY', touchDiameter: 1, neckDiameter: 0.6, neckLength: 3, pillarDiameter: 1.5, trussDiameter: 1.5 });
    expect(heavy.scatterSpacing).toBe(1);
    expect(presetValues.MIDDLE).toMatchObject({ touchDiameter: 0.8, pillarDiameter: 1.2, scatterMergeDistance: 3 });
  });

  it('switches to Custom only when a preset-owned value is edited', () => {
    expect(updateSetting(applyPreset('HEAVY'), 'pillarDiameter', 2).preset).toBe('CUSTOM');
    expect(updateSetting(applyPreset('HEAVY'), 'scatterSpacing', 3).preset).toBe('HEAVY');
    expect(updateSetting(applyPreset('HEAVY'), 'reinforceOverhangEdges', false).preset).toBe('HEAVY');
    expect(PRESET_KEYS).toContain('touchDiameter');
    expect(PRESET_KEYS).not.toContain('scatterSpacing');
  });

  it('clamps numeric edits to Blender property limits and rounds integers', () => {
    expect(updateSetting(defaultSupportSettings, 'resolution', 1.6).resolution).toBe(3);
    expect(updateSetting(defaultSupportSettings, 'maxNeckAngle', 120).maxNeckAngle).toBe(89);
    expect(updateSetting(defaultSupportSettings, 'touchDepth', -5).touchDepth).toBe(-2);
    expect(() => updateSetting(defaultSupportSettings, 'touchDiameter', Number.NaN)).toThrow(RangeError);
  });

  it('seeds roof and cage defaults only the first time a mode is used', () => {
    const roof = setRoofMode(defaultSupportSettings, 'ROOF');
    expect(roof).toMatchObject({ roofMode: 'ROOF', columnCount: 12, diagonalEnabled: true });

    const edited = setRoofMode(updateSetting(setRoofMode(roof, 'OFF'), 'columnCount', 8), 'ROOF');
    expect(edited.columnCount).toBe(8);

    expect(setRoofMode(defaultSupportSettings, 'CAGE')).toMatchObject({ roofMode: 'CAGE', columnDiameter: 1.2, cagePitch: 10 });
  });

  it('derives placement settings for the automatic placement worker', () => {
    const settings = updateSetting(updateSetting(defaultSupportSettings, 'scatterSpacing', 4), 'scatterIslands', false);
    expect(toPlacementSettings(settings)).toEqual({
      overhangAngleDegrees: 45, spacing: 4, edgeInset: 0.5, sharpEdgeAngleDegrees: 45, includeIslands: false,
    });
  });
});
