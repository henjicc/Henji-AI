import {
  REGISTRATION_ROTATION_ENABLED,
  RegistrationFrame,
  RegistrationRefinementSchedule,
  SimilarityTransform,
} from "./types";
import { PRECISE_REFINEMENT } from "./quality-profiles";
import { normalizedLuminance } from "./normalized-luminance";
import {
  inverseTransformPoint,
  transformComponents,
  transformScales,
} from "./transform";

interface StructuralImage {
  width: number;
  height: number;
  gradient: Float32Array;
  validMask?: Uint8Array;
}

export interface SimilarityRefinementResult {
  transform: SimilarityTransform;
  scoreBefore: number;
  scoreAfter: number;
  iterations: number;
  converged: boolean;
}

export interface TransformRefinementCandidates {
  similarity: SimilarityRefinementResult;
  anisotropic?: SimilarityRefinementResult;
}

interface CenteredParameters {
  logScaleX: number;
  logScaleY: number;
  angle: number;
  dx: number;
  dy: number;
}

const POST_APPLY_TRANSLATION_REFINEMENT: RegistrationRefinementSchedule = {
  translationSteps: [0.5, 0.25, 0.125, 0.0625, 0.03125],
  angleStepsDegrees: [0, 0, 0, 0, 0],
  scaleSteps: [0, 0, 0, 0, 0],
  scoreStrides: [2, 2, 1, 1, 1],
  maxPassesPerLevel: 3,
  translationOnlyFromLevel: 0,
};

function toStructuralImage(frame: RegistrationFrame): StructuralImage {
  const count = frame.width * frame.height;
  const gray = normalizedLuminance(frame);
  const gradient = new Float32Array(count);
  let maxGradient = 0;
  for (let y = 1; y < frame.height - 1; y++) {
    for (let x = 1; x < frame.width - 1; x++) {
      const index = y * frame.width + x;
      if (frame.validMask && !frame.validMask[index]) continue;
      const gx = gray[index + 1] - gray[index - 1];
      const gy = gray[index + frame.width] - gray[index - frame.width];
      const value = Math.hypot(gx, gy);
      gradient[index] = value;
      if (value > maxGradient) maxGradient = value;
    }
  }
  if (maxGradient > 0) {
    for (let i = 0; i < count; i++) gradient[i] /= maxGradient;
  }
  return {
    width: frame.width,
    height: frame.height,
    gradient,
    validMask: frame.validMask,
  };
}

function toCentered(
  transform: SimilarityTransform,
  width: number,
  height: number,
): CenteredParameters {
  const centerX = width / 2;
  const centerY = height / 2;
  const { scaleX, scaleY } = transformScales(transform);
  const { a, b, c, d } = transformComponents(transform);
  return {
    logScaleX: Math.log(Math.max(1e-6, scaleX)),
    logScaleY: Math.log(Math.max(1e-6, scaleY)),
    angle: REGISTRATION_ROTATION_ENABLED
      ? Math.atan2(transform.b, transform.a)
      : 0,
    dx: a * centerX + c * centerY + transform.tx - centerX,
    dy: b * centerX + d * centerY + transform.ty - centerY,
  };
}

function fromCentered(
  parameters: CenteredParameters,
  width: number,
  height: number,
): SimilarityTransform {
  const scaleX = Math.exp(parameters.logScaleX);
  const scaleY = Math.exp(parameters.logScaleY);
  const angle = REGISTRATION_ROTATION_ENABLED ? parameters.angle : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = scaleX * cos;
  const b = REGISTRATION_ROTATION_ENABLED ? scaleX * sin : 0;
  const c = REGISTRATION_ROTATION_ENABLED ? -scaleY * sin : 0;
  const d = scaleY * cos;
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    a,
    b,
    c,
    d,
    tx: centerX + parameters.dx - a * centerX - c * centerY,
    ty: centerY + parameters.dy - b * centerX - d * centerY,
  };
}

function bilinear(image: StructuralImage, x: number, y: number): number | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= image.width || y0 + 1 >= image.height) {
    return null;
  }
  const i00 = y0 * image.width + x0;
  const i10 = i00 + 1;
  const i01 = i00 + image.width;
  const i11 = i01 + 1;
  if (
    image.validMask &&
    (!image.validMask[i00] ||
      !image.validMask[i10] ||
      !image.validMask[i01] ||
      !image.validMask[i11])
  ) {
    return null;
  }
  const fx = x - x0;
  const fy = y - y0;
  const top = image.gradient[i00] * (1 - fx) + image.gradient[i10] * fx;
  const bottom = image.gradient[i01] * (1 - fx) + image.gradient[i11] * fx;
  return top * (1 - fy) + bottom * fy;
}

function structuralScore(
  reference: StructuralImage,
  moving: StructuralImage,
  transform: SimilarityTransform,
  stride = 2,
): number {
  let weightedError = 0;
  let weightSum = 0;
  let samples = 0;
  for (let y = 3; y < reference.height - 3; y += stride) {
    for (let x = 3; x < reference.width - 3; x += stride) {
      const referenceIndex = y * reference.width + x;
      if (reference.validMask && !reference.validMask[referenceIndex]) continue;
      const source = inverseTransformPoint(transform, x, y);
      if (!source) return -Infinity;
      const movingX = source.x;
      const movingY = source.y;
      const movingValue = bilinear(moving, movingX, movingY);
      if (movingValue == null) continue;
      const referenceValue = reference.gradient[referenceIndex];
      const residual = Math.abs(referenceValue - movingValue);
      // Huber-like weighting suppresses generated/occluded regions while
      // emphasizing pixels that contain actual structure.
      const robustWeight = residual <= 0.12 ? 1 : 0.12 / residual;
      const structureWeight = 0.05 + Math.max(referenceValue, movingValue);
      const weight = robustWeight * structureWeight;
      weightedError += weight * residual * residual;
      weightSum += weight;
      samples++;
    }
  }
  if (samples < 100 || weightSum <= 0) return -Infinity;
  return 1 - Math.sqrt(weightedError / weightSum);
}

/** Refine a reliable feature transform within a deliberately small basin.
 * This improves subpixel placement without allowing direct alignment to
 * reinterpret a real generative edit as geometry. */
function refineStructuralTransform(
  reference: StructuralImage,
  moving: StructuralImage,
  initial: SimilarityTransform,
  allowAnisotropic = false,
  schedule: RegistrationRefinementSchedule = PRECISE_REFINEMENT,
): SimilarityRefinementResult {
  const width = reference.width;
  const height = reference.height;
  const initialParameters = toCentered(initial, width, height);
  let parameters = { ...initialParameters };
  let transform = initial;
  const scoreBefore = structuralScore(reference, moving, initial);
  let bestScore = scoreBefore;
  let iterations = 0;
  let converged = false;
  const translationSteps = schedule.translationSteps;
  const angleSteps = schedule.angleStepsDegrees.map(
    (degrees) => (degrees * Math.PI) / 180,
  );
  const scaleSteps = schedule.scaleSteps;
  const scoreStrides = schedule.scoreStrides;
  const maxPassesPerLevel = schedule.maxPassesPerLevel;

  for (let level = 0; level < translationSteps.length; level++) {
    let levelBestScore = structuralScore(
      reference,
      moving,
      transform,
      scoreStrides[level],
    );
    const translationOnly =
      schedule.translationOnlyFromLevel !== undefined &&
      level >= schedule.translationOnlyFromLevel;
    const axes: Array<[keyof CenteredParameters, number]> = [
      ["dx", translationSteps[level]],
      ["dy", translationSteps[level]],
      ...(!translationOnly && REGISTRATION_ROTATION_ENABLED
        ? ([["angle", angleSteps[level]]] as Array<
            [keyof CenteredParameters, number]
          >)
        : []),
      ...(!translationOnly
        ? ([["logScaleX", scaleSteps[level]]] as Array<
            [keyof CenteredParameters, number]
          >)
        : []),
      ...(allowAnisotropic && !translationOnly
        ? ([["logScaleY", scaleSteps[level]]] as Array<
            [keyof CenteredParameters, number]
          >)
        : []),
    ];
    for (let pass = 0; pass < maxPassesPerLevel; pass++) {
      let improved = false;
      for (const [key, step] of axes) {
        for (const direction of [-1, 1]) {
          const candidate: CenteredParameters = {
            ...parameters,
            [key]: parameters[key] + step * direction,
          };
          if (!allowAnisotropic && key === "logScaleX") {
            candidate.logScaleY += step * direction;
          }
          if (
            Math.abs(candidate.dx - initialParameters.dx) > 3 ||
            Math.abs(candidate.dy - initialParameters.dy) > 3 ||
            Math.abs(candidate.angle - initialParameters.angle) >
              (0.5 * Math.PI) / 180 ||
            Math.abs(candidate.logScaleX - initialParameters.logScaleX) >
              0.01 ||
            Math.abs(candidate.logScaleY - initialParameters.logScaleY) > 0.01
          ) {
            continue;
          }
          const candidateTransform = fromCentered(candidate, width, height);
          const score = structuralScore(
            reference,
            moving,
            candidateTransform,
            scoreStrides[level],
          );
          iterations++;
          if (score > levelBestScore + 1e-6) {
            levelBestScore = score;
            parameters = candidate;
            transform = candidateTransform;
            improved = true;
          }
        }
      }
      if (!improved) {
        if (level === translationSteps.length - 1) converged = true;
        break;
      }
    }
  }
  bestScore = structuralScore(reference, moving, transform);
  return {
    transform: bestScore > scoreBefore ? transform : initial,
    scoreBefore,
    scoreAfter: Math.max(scoreBefore, bestScore),
    iterations,
    converged,
  };
}

export function refineSimilarityTransform(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  initial: SimilarityTransform,
  allowAnisotropic = false,
  schedule: RegistrationRefinementSchedule = PRECISE_REFINEMENT,
): SimilarityRefinementResult {
  return refineStructuralTransform(
    toStructuralImage(referenceFrame),
    toStructuralImage(movingFrame),
    initial,
    allowAnisotropic,
    schedule,
  );
}

/** Measure only the residual X/Y translation after Photoshop has applied the
 * main transform. Scale and rotation are deliberately excluded. */
export function refineResidualTranslation(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
): SimilarityRefinementResult {
  return refineStructuralTransform(
    toStructuralImage(referenceFrame),
    toStructuralImage(movingFrame),
    { a: 1, b: 0, tx: 0, ty: 0 },
    false,
    POST_APPLY_TRANSLATION_REFINEMENT,
  );
}

/** Evaluate the constrained similarity and anisotropic refinements against the
 * exact same structural images. This keeps the production path and lab path on
 * one candidate-selection implementation without doubling image preparation. */
export function refineTransformCandidates(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  initial: SimilarityTransform,
  anisotropicInitial: SimilarityTransform | null,
  enableAnisotropic: boolean,
  schedule: RegistrationRefinementSchedule = PRECISE_REFINEMENT,
): TransformRefinementCandidates {
  const reference = toStructuralImage(referenceFrame);
  const moving = toStructuralImage(movingFrame);
  const similarity = refineStructuralTransform(
    reference,
    moving,
    initial,
    false,
    schedule,
  );
  if (!enableAnisotropic) return { similarity };
  return {
    similarity,
    anisotropic: refineStructuralTransform(
      reference,
      moving,
      anisotropicInitial ?? similarity.transform,
      true,
      schedule,
    ),
  };
}
