import {
  REGISTRATION_FEATURE_MAX_EDGE,
  REGISTRATION_FRAME_MAX_EDGE,
  type RegistrationRefinementSchedule,
} from "./types";

export type RegistrationQuality = "fast" | "precise" | "extreme";

export interface RegistrationQualityProfile {
  quality: RegistrationQuality;
  frameMaxEdge: number;
  featureMaxEdge: number;
  maxKeypoints: number;
  ransacIterations: number;
  enableAnisotropicRefinement: boolean;
  refinementSchedule: RegistrationRefinementSchedule;
}
const FAST_REFINEMENT: RegistrationRefinementSchedule = {
  translationSteps: [1, 0.5, 0.25, 0.125],
  angleStepsDegrees: [0.08, 0.04, 0.02, 0.01],
  scaleSteps: [0.0015, 0.00075, 0.000375, 0.0001875],
  scoreStrides: [4, 4, 3, 2],
  maxPassesPerLevel: 2,
};

export const PRECISE_REFINEMENT: RegistrationRefinementSchedule = {
  translationSteps: [1, 0.5, 0.25, 0.125, 0.0625, 0.03125],
  angleStepsDegrees: [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025],
  scaleSteps: [0.0015, 0.00075, 0.000375, 0.0001875, 0.00009375, 0.000046875],
  scoreStrides: [4, 4, 3, 3, 2, 2],
  maxPassesPerLevel: 4,
};

const EXTREME_REFINEMENT: RegistrationRefinementSchedule = {
  translationSteps: [1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125],
  angleStepsDegrees: [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025, 0.00125, 0.000625],
  scaleSteps: [
    0.0015, 0.00075, 0.000375, 0.0001875, 0.00009375, 0.000046875, 0.0000234375,
    0.00001171875,
  ],
  scoreStrides: [4, 4, 3, 3, 2, 2, 1, 1],
  maxPassesPerLevel: 5,
  /** The last two levels only remove residual translation; they cannot reshape edits. */
  translationOnlyFromLevel: 6,
};

export const REGISTRATION_QUALITY_PROFILES: Record<
  RegistrationQuality,
  RegistrationQualityProfile
> = {
  fast: {
    quality: "fast",
    frameMaxEdge: 640,
    featureMaxEdge: 480,
    maxKeypoints: 360,
    ransacIterations: 600,
    enableAnisotropicRefinement: false,
    refinementSchedule: FAST_REFINEMENT,
  },
  precise: {
    quality: "precise",
    frameMaxEdge: REGISTRATION_FRAME_MAX_EDGE,
    featureMaxEdge: REGISTRATION_FEATURE_MAX_EDGE,
    maxKeypoints: 540,
    ransacIterations: 900,
    enableAnisotropicRefinement: true,
    refinementSchedule: PRECISE_REFINEMENT,
  },
  extreme: {
    quality: "extreme",
    frameMaxEdge: 1536,
    featureMaxEdge: 768,
    maxKeypoints: 700,
    ransacIterations: 1200,
    enableAnisotropicRefinement: true,
    refinementSchedule: EXTREME_REFINEMENT,
  },
};

export function resolveRegistrationQuality(
  quality: RegistrationQuality | string | null | undefined,
): RegistrationQualityProfile {
  return quality === "fast" || quality === "extreme"
    ? REGISTRATION_QUALITY_PROFILES[quality]
    : REGISTRATION_QUALITY_PROFILES.precise;
}

export function getRegistrationQualityProfile(
  quality: RegistrationQuality,
): RegistrationQualityProfile {
  return REGISTRATION_QUALITY_PROFILES[quality];
}
