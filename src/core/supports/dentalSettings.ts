import type { LiveSupportSettings } from './settings';
import type { DentalStructure } from '../analysis/dentalPolicy';

export const defaultDentalStructure: Readonly<DentalStructure> = { treeEnabled: true, bracesEnabled: true };

/** Dental keeps tree branches and braces unless its own per-aligner switches disable them. */
export function dentalBuildSettings(settings: Readonly<LiveSupportSettings>,
  structure: Readonly<DentalStructure> = defaultDentalStructure): LiveSupportSettings {
  return { ...settings, scatterAutoTree: structure.treeEnabled, trussEnabled: structure.bracesEnabled,
    roofMode: 'OFF', roofSeededModes: [] };
}
