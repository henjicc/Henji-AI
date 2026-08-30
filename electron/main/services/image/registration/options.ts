import { REGISTRATION_QUALITY_PROFILES } from "./quality-profiles";
import type { RegistrationOptions } from "./types";

export const DEFAULT_REGISTRATION_OPTIONS: RegistrationOptions = {
  maxKeypoints: REGISTRATION_QUALITY_PROFILES.precise.maxKeypoints,
  gridColumns: 8,
  gridRows: 8,
  ratioThreshold: 0.88,
  ransacIterations: REGISTRATION_QUALITY_PROFILES.precise.ransacIterations,
  inlierThreshold: 3.5,
  minInliers: 14,
  minCoverage: 0.1,
  maxScaleChange: 0.4,
  maxAnisotropy: 0.08,
  enableAnisotropicRefinement:
    REGISTRATION_QUALITY_PROFILES.precise.enableAnisotropicRefinement,
  forceApplyResult: false,
  photometricScope: "auto",
  featureMaxEdge: REGISTRATION_QUALITY_PROFILES.precise.featureMaxEdge,
  refinementSchedule: REGISTRATION_QUALITY_PROFILES.precise.refinementSchedule,
  maxRotationDegrees: 25,
  minLocalAnchorInliers: 6,
};
