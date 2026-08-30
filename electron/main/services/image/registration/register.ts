import type {
  RegistrationFrame,
  RegistrationOptions,
  RegistrationResult,
  SimilarityTransform,
} from "./types";
import type { RegistrationQuality } from "./quality-profiles";
import { resolveRegistrationQuality } from "./quality-profiles";
import { DEFAULT_REGISTRATION_OPTIONS } from "./options";
import {
  detectKeypoints,
  frameToGray,
  matchKeypoints,
  resizeGray,
  type GrayImage,
} from "./features";
import {
  convexHullArea,
  errorFor,
  estimateSimilarityRansac,
  median,
  refitAnisotropic,
} from "./geometry";
import {
  evaluateLocalAnchors,
  robustStructuralScore,
} from "./structural";
import { refineTransformCandidates } from "./refinement";
import { fitPhotometricModel } from "./photometric";
import {
  scaleTransformCoordinates,
  transformScales,
} from "./transform";

const IDENTITY: SimilarityTransform = { a: 1, b: 0, tx: 0, ty: 0 };

function emptyResult(startedAt: number, reason: string): RegistrationResult {
  return {
    success: false,
    model: "identity",
    transform: { ...IDENTITY },
    confidence: 0,
    diagnostics: {
      referenceKeypoints: 0,
      movingKeypoints: 0,
      matches: 0,
      inliers: 0,
      inlierRatio: 0,
      coverage: 0,
      medianError: Infinity,
      structuralScore: 0,
      changedFraction: 1,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      anisotropy: 0,
      rotationDegrees: 0,
      translationX: 0,
      translationY: 0,
      elapsedMs: Date.now() - startedAt,
      reason,
    },
  };
}
export function registerImages(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  inputOptions: Partial<RegistrationOptions> = {},
): RegistrationResult {
  const startedAt = Date.now();
  if (
    referenceFrame.width !== movingFrame.width ||
    referenceFrame.height !== movingFrame.height
  ) {
    return emptyResult(
      startedAt,
      "registration frames must have the same dimensions",
    );
  }
  const options = { ...DEFAULT_REGISTRATION_OPTIONS, ...inputOptions };
  let refinementReference: GrayImage;
  let refinementMoving: GrayImage;
  try {
    refinementReference = frameToGray(referenceFrame);
    refinementMoving = frameToGray(movingFrame);
  } catch (error) {
    return emptyResult(
      startedAt,
      error instanceof Error ? error.message : String(error),
    );
  }
  const featureScale = Math.min(
    1,
    options.featureMaxEdge /
      Math.max(refinementReference.width, refinementReference.height),
  );
  const reference = resizeGray(refinementReference, featureScale);
  const moving = resizeGray(refinementMoving, featureScale);
  const referencePoints = detectKeypoints(reference, options);
  const movingPoints = detectKeypoints(moving, options);
  const matches = matchKeypoints(
    referencePoints,
    movingPoints,
    options.ratioThreshold,
  );
  const base = emptyResult(startedAt, "insufficient reliable structure");
  base.diagnostics.referenceKeypoints = referencePoints.length;
  base.diagnostics.movingKeypoints = movingPoints.length;
  base.diagnostics.matches = matches.length;
  base.diagnostics.featureFrameWidth = reference.width;
  base.diagnostics.featureFrameHeight = reference.height;
  base.diagnostics.refinementFrameWidth = referenceFrame.width;
  base.diagnostics.refinementFrameHeight = referenceFrame.height;
  if (
    matches.length < Math.min(options.minInliers, options.minLocalAnchorInliers)
  )
    return base;

  const estimate = estimateSimilarityRansac(
    matches,
    reference.width,
    reference.height,
    options,
  );
  if (!estimate) return base;
  const anisotropic = refitAnisotropic(
    estimate.inliers,
    estimate.transform,
    reference.width,
    reference.height,
    options,
  );
  const anisotropicInliers = anisotropic
    ? matches.filter(
        (match) => errorFor(anisotropic, match) <= options.inlierThreshold,
      )
    : [];
  const anisotropicMedian = median(
    anisotropicInliers.map((match) => errorFor(anisotropic!, match)),
  );
  const similarityStructure = robustStructuralScore(
    reference,
    moving,
    estimate.transform,
  );
  const anisotropicStructure = anisotropic
    ? robustStructuralScore(reference, moving, anisotropic)
    : null;
  const useFeatureAnisotropicSeed =
    !!anisotropic &&
    anisotropicInliers.length >= estimate.inliers.length * 0.8 &&
    anisotropicMedian <=
      estimate.medianError - Math.max(0.03, estimate.medianError * 0.08) &&
    !!anisotropicStructure &&
    anisotropicStructure.score >= similarityStructure.score - 0.005;
  const refinementCoordinateScale = 1 / featureScale;
  const estimateRefinementTransform = scaleTransformCoordinates(
    estimate.transform,
    refinementCoordinateScale,
  );
  const anisotropicRefinementSeed = anisotropic
    ? scaleTransformCoordinates(anisotropic, refinementCoordinateScale)
    : null;
  const refinements = refineTransformCandidates(
    referenceFrame,
    movingFrame,
    estimateRefinementTransform,
    useFeatureAnisotropicSeed ? anisotropicRefinementSeed : null,
    options.enableAnisotropicRefinement,
    options.refinementSchedule,
  );
  let similarityTransform = refinements.similarity.transform;
  let similarityFeatureTransform = scaleTransformCoordinates(
    similarityTransform,
    featureScale,
  );
  let similarityInliers = matches.filter(
    (match) =>
      errorFor(similarityFeatureTransform, match) <= options.inlierThreshold,
  );
  let similarityMedian = median(
    similarityInliers.map((match) =>
      errorFor(similarityFeatureTransform, match),
    ),
  );
  let similarityCoverage =
    convexHullArea(similarityInliers) /
    Math.max(1, reference.width * reference.height);
  let refinementAccepted = true;
  // Direct refinement is deliberately subordinate to geometric evidence.
  // Reject it if it materially weakens the feature consensus.
  if (
    similarityInliers.length < estimate.inliers.length * 0.75 ||
    similarityMedian > estimate.medianError + 0.5
  ) {
    similarityTransform = estimateRefinementTransform;
    similarityFeatureTransform = estimate.transform;
    refinementAccepted = false;
    similarityInliers = estimate.inliers;
    similarityMedian = estimate.medianError;
    similarityCoverage = estimate.coverage;
  }
  const similarityFinalStructure = robustStructuralScore(
    reference,
    moving,
    similarityFeatureTransform,
  );
  const similarityFineScore = refinementAccepted
    ? refinements.similarity.scoreAfter
    : refinements.similarity.scoreBefore;

  let transform = similarityTransform;
  let inliers = similarityInliers;
  let medianError = similarityMedian;
  let coverage = similarityCoverage;
  let structural = similarityFinalStructure;
  let anisotropicAccepted = false;
  let anisotropicScoreGain: number | undefined;
  let anisotropicCandidateMedianError: number | undefined;
  let anisotropicCandidateInliers: number | undefined;
  let anisotropicRejectionReason: string | undefined =
    options.enableAnisotropicRefinement
      ? "insufficient anisotropic evidence"
      : "anisotropic refinement disabled";

  const anisotropicRefinement = refinements.anisotropic;
  if (anisotropicRefinement) {
    const candidate = anisotropicRefinement.transform;
    const candidateFeatureTransform = scaleTransformCoordinates(
      candidate,
      featureScale,
    );
    const candidateInliers = matches.filter(
      (match) =>
        errorFor(candidateFeatureTransform, match) <= options.inlierThreshold,
    );
    const candidateMedian = median(
      candidateInliers.map((match) =>
        errorFor(candidateFeatureTransform, match),
      ),
    );
    const candidateCoverage =
      convexHullArea(candidateInliers) /
      Math.max(1, reference.width * reference.height);
    const candidateStructural = robustStructuralScore(
      reference,
      moving,
      candidateFeatureTransform,
    );
    const candidateScales = transformScales(candidate);
    const candidateAnisotropy = Math.abs(
      candidateScales.scaleX / candidateScales.scaleY - 1,
    );
    anisotropicScoreGain =
      anisotropicRefinement.scoreAfter - similarityFineScore;
    anisotropicCandidateMedianError = candidateMedian;
    anisotropicCandidateInliers = candidateInliers.length;

    const withinTransformLimits =
      Math.abs(candidateScales.scaleX - 1) <= options.maxScaleChange &&
      Math.abs(candidateScales.scaleY - 1) <= options.maxScaleChange &&
      candidateAnisotropy <= options.maxAnisotropy;
    const preservesFeatureConsensus =
      candidateInliers.length >=
        Math.max(
          options.minLocalAnchorInliers,
          similarityInliers.length * 0.8,
        ) &&
      candidateMedian <=
        similarityMedian + Math.max(0.15, similarityMedian * 0.12) &&
      candidateCoverage >= similarityCoverage * 0.75;
    const preservesGlobalStructure =
      candidateStructural.score >= similarityFinalStructure.score - 0.005;
    // A strongly supported feature fit may be fractionally flatter in the
    // pixel objective; otherwise the extra scale degree of freedom must earn
    // a measurable subpixel structural improvement.
    const earnsExtraDegreeOfFreedom = useFeatureAnisotropicSeed
      ? anisotropicScoreGain >= -0.0005
      : anisotropicScoreGain >= 0.0001;

    if (!withinTransformLimits) {
      anisotropicRejectionReason = "anisotropic transform exceeds limits";
    } else if (!preservesFeatureConsensus) {
      anisotropicRejectionReason = "anisotropic feature consensus weakened";
    } else if (!preservesGlobalStructure) {
      anisotropicRejectionReason = "anisotropic global structure weakened";
    } else if (!earnsExtraDegreeOfFreedom) {
      anisotropicRejectionReason = "anisotropic score gain too small";
    } else {
      transform = candidate;
      inliers = candidateInliers;
      medianError = candidateMedian;
      coverage = candidateCoverage;
      structural = candidateStructural;
      anisotropicAccepted = true;
      refinementAccepted = true;
      anisotropicRejectionReason = undefined;
    }
  }
  const { scaleX, scaleY } = transformScales(transform);
  const scale = Math.sqrt(scaleX * scaleY);
  const anisotropy = Math.abs(scaleX / scaleY - 1);
  const rotationDegrees =
    (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
  const localAnchors = evaluateLocalAnchors(
    reference,
    moving,
    scaleTransformCoordinates(transform, featureScale),
    inliers,
    options,
  );
  const photometric = fitPhotometricModel(
    referenceFrame,
    movingFrame,
    transform,
    options.photometricScope,
  );
  const inlierRatio = inliers.length / matches.length;
  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.28 * Math.min(1, inliers.length / 35) +
        0.22 * Math.min(1, inlierRatio / 0.55) +
        0.22 * Math.min(1, coverage / 0.3) +
        0.14 * Math.max(0, 1 - medianError / options.inlierThreshold) +
        0.14 * structural.score,
    ),
  );
  const globalSuccess =
    inliers.length >= options.minInliers &&
    coverage >= options.minCoverage &&
    medianError <= options.inlierThreshold &&
    structural.score >= 0.28 &&
    confidence >= 0.48;
  const localAnchorConfidence = Math.max(
    0,
    Math.min(
      1,
      0.28 *
        Math.min(
          1,
          inliers.length / Math.max(10, options.minLocalAnchorInliers),
        ) +
        0.12 * Math.min(1, inlierRatio / 0.45) +
        0.2 * Math.min(1, localAnchors.cells / 5) +
        0.2 * Math.min(1, localAnchors.spread / 0.35) +
        0.2 * Math.max(0, localAnchors.structuralScore),
    ),
  );
  const localAnchorSuccess =
    !globalSuccess &&
    inliers.length >= options.minLocalAnchorInliers &&
    inlierRatio >= 0.1 &&
    localAnchors.cells >= 3 &&
    localAnchors.spread >= 0.18 &&
    medianError <= Math.min(2.5, options.inlierThreshold) &&
    localAnchors.structuralScore >= 0.7 &&
    localAnchorConfidence >= 0.55;
  const qualityAccepted = globalSuccess || localAnchorSuccess;
  const forcedSuccess = options.forceApplyResult && !qualityAccepted;
  const success = qualityAccepted || forcedSuccess;
  const finalConfidence = globalSuccess
    ? confidence
    : localAnchorSuccess
      ? localAnchorConfidence
      : Math.max(confidence, localAnchorConfidence);
  const nearIdentity =
    Math.abs(scale - 1) < 0.008 && Math.abs(rotationDegrees) < 0.35;
  return {
    success,
    model: success
      ? anisotropicAccepted
        ? "anisotropic"
        : nearIdentity
          ? "translation"
          : "similarity"
      : "identity",
    transform: success ? transform : { ...IDENTITY },
    confidence: success ? finalConfidence : 0,
    photometric,
    diagnostics: {
      referenceKeypoints: referencePoints.length,
      movingKeypoints: movingPoints.length,
      matches: matches.length,
      inliers: inliers.length,
      inlierRatio,
      coverage,
      medianError,
      structuralScore: structural.score,
      changedFraction: structural.changedFraction,
      scale,
      scaleX,
      scaleY,
      anisotropy,
      anisotropicAccepted,
      anisotropicScoreGain,
      anisotropicCandidateMedianError,
      anisotropicCandidateInliers,
      anisotropicRejectionReason,
      rotationDegrees,
      translationX: transform.tx,
      translationY: transform.ty,
      elapsedMs: Date.now() - startedAt,
      refinementScoreBefore: anisotropicAccepted
        ? anisotropicRefinement?.scoreBefore
        : refinements.similarity.scoreBefore,
      refinementScoreAfter: anisotropicAccepted
        ? anisotropicRefinement?.scoreAfter
        : similarityFineScore,
      refinementIterations: anisotropicAccepted
        ? anisotropicRefinement?.iterations
        : refinements.similarity.iterations,
      refinementAccepted,
      refinementConverged: anisotropicAccepted
        ? anisotropicRefinement?.converged
        : refinements.similarity.converged,
      featureFrameWidth: reference.width,
      featureFrameHeight: reference.height,
      refinementFrameWidth: referenceFrame.width,
      refinementFrameHeight: referenceFrame.height,
      colorGains: photometric?.gains,
      colorBiases: photometric?.biases,
      brightnessGain: photometric?.brightnessGain,
      brightnessBias: photometric?.brightnessBias,
      saturationScale: photometric?.saturationScale,
      colorRmse: photometric?.rmse,
      photometricOutlierFraction: photometric?.outlierFraction,
      photometricKind: photometric?.kind,
      photometricAccepted: photometric?.accepted,
      photometricRejectionReason: photometric?.rejectionReason,
      photometricBaselineRmse: photometric?.baselineRmse,
      photometricImprovement: photometric?.validationImprovement,
      photometricExcludedFraction: photometric?.excludedFraction,
      photometricValidationSamples: photometric?.validationSamples,
      acceptanceMode: globalSuccess
        ? "global"
        : localAnchorSuccess
          ? "local-anchors"
          : forcedSuccess
            ? "forced"
            : undefined,
      forced: forcedSuccess,
      anchorCells: localAnchors.cells,
      anchorSpread: localAnchors.spread,
      anchorStructuralScore: localAnchors.structuralScore,
      reason: forcedSuccess
        ? "forced despite quality thresholds"
        : success
          ? undefined
          : "quality thresholds not met",
    },
  };
}

export function registerLocalRedrawFrames(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  quality: RegistrationQuality,
  forceApplyResult = false,
): RegistrationResult {
  const profile = resolveRegistrationQuality(quality);
  return registerImages(referenceFrame, movingFrame, {
    maxKeypoints: profile.maxKeypoints,
    ransacIterations: profile.ransacIterations,
    featureMaxEdge: profile.featureMaxEdge,
    enableAnisotropicRefinement: profile.enableAnisotropicRefinement,
    refinementSchedule: profile.refinementSchedule,
    forceApplyResult,
  });
}
