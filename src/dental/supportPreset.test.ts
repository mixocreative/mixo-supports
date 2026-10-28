import { describe, expect, it } from 'vitest';
import { defaultSupportSettings } from '../core/supports/settings';
import { profileData } from './alignerProfiles';
import { dentalStructureOf, dentalSupportSettings } from './supportPreset';

describe('dental Step 3 defaults from the aligner profile', () => {
  it('start a new reference aligner with straight 1.4 mm pillars, a 0.45 mm tip, a 3.5 mm lift and the raft', () => {
    const settings = dentalSupportSettings('reference-aligner', { ...defaultSupportSettings, labelText: 'A1' });
    expect(settings).toMatchObject({ preset: 'CUSTOM', pillarDiameter: 1.4, trussDiameter: 1.4, pointDiameter: 0.45, touchDiameter: 0.45, liftHeight: 3.5, raftEnabled: true });
    // Everything else is the operator's: untouched.
    expect(settings.labelText).toBe('A1');
    expect(settings.neckLength).toBe(defaultSupportSettings.neckLength);
    expect(settings.contactShape).toBe(defaultSupportSettings.contactShape);
  });

  it('turn Tree and Brace on for a new aligner (D3; an older project without switches keeps both on)', () => {
    expect(dentalStructureOf('reference-aligner')).toEqual({ treeEnabled: true, bracesEnabled: true });
    expect(profileData('reference-aligner').supports).toEqual({ pillarDiameterMm: 1.4, tipDiameterMm: 0.45, liftHeightMm: 3.5, tree: true, brace: true, raft: true });
  });
});
