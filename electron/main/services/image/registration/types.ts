import type {
  PhotometricCorrectionScope,
  PhotometricModel,
  PhotometricModelKind,
} from "./photometric";

/** Shared sampling resolution for API input, lab layers, and placed results. */
export const REGISTRATION_FRAME_MAX_EDGE = 1024;

/** Feature matching stays bounded while the denser frame is used for refinement. */
export const REGISTRATION_FEATURE_MAX_EDGE = 640;

/** Temporary production policy: generated edit results are never rotated. */
export const REGISTRATION_ROTATION_ENABLED = false;

export interface RegistrationRefinementSchedule {
  translationSteps: readonly number[];
  angleStepsDegrees: readonly number[];
  scaleSteps: readonly number[];
  scoreStrides: readonly number[];
  maxPassesPerLevel: number;
  translationOnlyFromLevel?: number;
}

export interface RegistrationFrame {
  width: number;
  height: number;
  /** Chunky RGB/RGBA/gray 8-bit pixels. */
  data: Uint8Array;
  components: number;
  /** 255 for real pixels, 0 for padding restored after Photoshop trimming. */
  validMask?: Uint8Array;
}

export interface SimilarityTransform {
  /**
   * x' = a*x + c*y + tx; y' = b*x + d*y + ty.
   * c/d are omitted by legacy similarity transforms, where c=-b and d=a.
   */
  a: number;
  b: number;
  c?: number;
  d?: number;
  tx: number;
  ty: number;
}

export interface RegistrationOptions {
  maxKeypoints: number;
  gridColumns: number;
  gridRows: number;
  ratioThreshold: number;
  ransacIterations: number;
  inlierThreshold: number;
  minInliers: number;
  minCoverage: number;
  maxScaleChange: number;
  /** Maximum relative difference between the independently fitted X/Y scales. */
  maxAnisotropy: number;
  /** Explore a separately refined X/Y scale candidate, including near-identity corrections. */
  enableAnisotropicRefinement: boolean;
  /** Apply an estimated transform even when normal quality acceptance rejects it. */
  forceApplyResult: boolean;
  /** Select how much of the validated photometric mapping may be exposed. */
  photometricScope: PhotometricCorrectionScope;
  featureMaxEdge: number;
  refinementSchedule: RegistrationRefinementSchedule;
  maxRotationDegrees: number;
  /** Minimum geometrically consistent features for the local-anchor fallback. */
  minLocalAnchorInliers: number;
}

export interface RegistrationDiagnostics {
  referenceKeypoints: number;
  movingKeypoints: number;
  matches: number;
  inliers: number;
  inlierRatio: number;
  coverage: number;
  medianError: number;
  structuralScore: number;
  changedFraction: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  anisotropy?: number;
  anisotropicAccepted?: boolean;
  anisotropicScoreGain?: number;
  anisotropicCandidateMedianError?: number;
  anisotropicCandidateInliers?: number;
  anisotropicRejectionReason?: string;
  rotationDegrees: number;
  translationX: number;
  translationY: number;
  elapsedMs: number;
  refinementScoreBefore?: number;
  refinementScoreAfter?: number;
  refinementIterations?: number;
  refinementAccepted?: boolean;
  refinementConverged?: boolean;
  featureFrameWidth?: number;
  featureFrameHeight?: number;
  refinementFrameWidth?: number;
  refinementFrameHeight?: number;
  colorGains?: [number, number, number];
  colorBiases?: [number, number, number];
  brightnessGain?: number;
  brightnessBias?: number;
  saturationScale?: number;
  colorRmse?: number;
  photometricOutlierFraction?: number;
  photometricKind?: PhotometricModelKind;
  photometricAccepted?: boolean;
  photometricRejectionReason?: string;
  photometricBaselineRmse?: number;
  photometricImprovement?: number;
  photometricExcludedFraction?: number;
  photometricValidationSamples?: number;
  acceptanceMode?: "global" | "local-anchors" | "forced";
  forced?: boolean;
  anchorCells?: number;
  anchorSpread?: number;
  anchorStructuralScore?: number;
  captureAttempts?: number;
  captureStable?: boolean;
  captureDifference?: number;
  postVerificationApplied?: boolean;
  postVerificationTranslationX?: number;
  postVerificationTranslationY?: number;
  postVerificationScoreBefore?: number;
  postVerificationScoreAfter?: number;
  postVerificationFinalTranslationX?: number;
  postVerificationFinalTranslationY?: number;
  postVerificationReason?: string;
  localDeformationApplied?: boolean;
  localDeformationAcceptedPoints?: number;
  localDeformationCoverage?: number;
  localDeformationScoreBefore?: number;
  localDeformationScoreAfter?: number;
  localDeformationScoreGain?: number;
  localDeformationActualScoreGain?: number;
  localDeformationMaxDisplacement?: number;
  localDeformationMaxDocumentDisplacement?: number;
  localDeformationRoughness?: number;
  localDeformationMaskFraction?: number;
  localDeformationMaskReliable?: boolean;
  localDeformationMaskReason?: string;
  localDeformationRetainedFraction?: number;
  localDeformationRemovedTranslationX?: number;
  localDeformationRemovedTranslationY?: number;
  localDeformationRemovedScaleX?: number;
  localDeformationRemovedScaleY?: number;
  localDeformationAppliedScale?: number;
  localDeformationReason?: string;
  changeAwareRefinementApplied?: boolean;
  changeAwareMaskFraction?: number;
  changeAwareRetainedFraction?: number;
  changeAwareScoreBefore?: number;
  changeAwareScoreAfter?: number;
  changeAwareScoreGain?: number;
  changeAwareRefinementReason?: string;
  /** 局部重绘在几何验收失败后回退原位贴回的原因。 */
  compositionFallbackReason?: string;
  /** 变换后仍有有效模型像素覆盖的重绘选区比例。 */
  selectionCoverage?: number;
  selectedChangeFraction?: number;
  selectedMeanAbsoluteDelta?: number;
  composedSelectedChangeFraction?: number;
  composedSelectedMeanAbsoluteDelta?: number;
  compositionChangeRetention?: number;
  reason?: string;
}

export interface RegistrationResult {
  success: boolean;
  model: "identity" | "translation" | "similarity" | "anisotropic";
  transform: SimilarityTransform;
  confidence: number;
  diagnostics: RegistrationDiagnostics;
  /** Validated color mapping estimated from geometrically aligned pixels. */
  photometric?: PhotometricModel | null;
}

export type RegistrationTransform = SimilarityTransform;
