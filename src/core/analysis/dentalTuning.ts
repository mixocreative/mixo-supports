/**
 * The operator's strip controls of a two-contour area. Defaults and limits are aligner-profile data
 * (`src/dental/tuning.ts`); Rust validates the numbers again against the profile it is given.
 */
export interface DentalTuning {
  setbackMm: number;
  stripWidthMm: number;
  density: number;
}
