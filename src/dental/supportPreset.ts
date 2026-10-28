import type { DentalStructure } from '../core/analysis/dentalPolicy';
import type { LiveSupportSettings } from '../core/supports/settings';
import { profileData } from './alignerProfiles';

/*
 * The Step 3 support settings a new aligner starts with, from its profile's `supports` block
 * (straight pillars, a fine tip, a low lift, Tree and Brace off). They are applied once, when the
 * aligner's support area is first detected for its type (`useDentalFlow`), and stored with the
 * aligner like any setting, so the operator can change every one and a saved project keeps what was
 * chosen. Older projects are not touched: a saved policy without switches keeps Tree and Brace on.
 */

/** `settings` with the profile's Step 3 values on top. */
export function dentalSupportSettings(profileId: string, settings: Readonly<LiveSupportSettings>): LiveSupportSettings {
  const { pillarDiameterMm, tipDiameterMm, liftHeightMm, raft } = profileData(profileId).supports;
  return {
    ...settings,
    // A pillar size off the presets: the preset reads Custom, as after any preset-owned edit.
    preset: 'CUSTOM',
    pillarDiameter: pillarDiameterMm,
    trussDiameter: pillarDiameterMm,
    pointDiameter: tipDiameterMm,
    touchDiameter: tipDiameterMm,
    liftHeight: liftHeightMm,
    raftEnabled: raft,
  };
}

/** The profile's Tree and Brace switches, as a new aligner's own. */
export function dentalStructureOf(profileId: string): DentalStructure {
  const { tree, brace } = profileData(profileId).supports;
  return { treeEnabled: tree, bracesEnabled: brace };
}
