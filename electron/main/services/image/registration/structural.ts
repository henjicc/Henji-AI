import type {
  RegistrationFrame,
  RegistrationOptions,
  SimilarityTransform,
} from "./types";
import {
  bilinearSample,
  frameToGray,
  type GrayImage,
  type PointMatch,
} from "./features";
import { inverseTransformPoint } from "./transform";

function gradientMagnitude(image: GrayImage): Float32Array {
  const output = new Float32Array(image.width * image.height);
  let max = 0;
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const index = y * image.width + x;
      const gx = image.data[index + 1] - image.data[index - 1];
      const gy =
        image.data[index + image.width] - image.data[index - image.width];
      const value = Math.hypot(gx, gy);
      output[index] = value;
      if (value > max) max = value;
    }
  }
  if (max > 0) {
    for (let i = 0; i < output.length; i++) output[i] /= max;
  }
  return output;
}
export function robustStructuralScore(
  reference: GrayImage,
  moving: GrayImage,
  transform: SimilarityTransform,
): { score: number; changedFraction: number } {
  const refGradient = gradientMagnitude(reference);
  const movingGradient = gradientMagnitude(moving);
  const residuals: number[] = [];
  for (let y = 4; y < reference.height - 4; y += 3) {
    for (let x = 4; x < reference.width - 4; x += 3) {
      const source = inverseTransformPoint(transform, x, y);
      if (!source) return { score: 0, changedFraction: 1 };
      const sx = source.x;
      const sy = source.y;
      if (sx < 1 || sy < 1 || sx >= moving.width - 1 || sy >= moving.height - 1)
        continue;
      const movingX = Math.round(sx);
      const movingY = Math.round(sy);
      if (
        (reference.validMask &&
          !reference.validMask[y * reference.width + x]) ||
        (moving.validMask &&
          !moving.validMask[movingY * moving.width + movingX])
      ) {
        continue;
      }
      const movingValue = movingGradient[movingY * moving.width + movingX];
      const referenceValue = refGradient[y * reference.width + x];
      residuals.push(Math.abs(referenceValue - movingValue));
    }
  }
  if (residuals.length < 50) return { score: 0, changedFraction: 1 };
  residuals.sort((a, b) => a - b);
  const reliableCount = Math.max(1, Math.floor(residuals.length * 0.7));
  let sum = 0;
  for (let i = 0; i < reliableCount; i++) sum += residuals[i];
  const robustResidual = sum / reliableCount;
  const changed =
    residuals.filter((value) => value > 0.22).length / residuals.length;
  return {
    score: Math.max(0, Math.min(1, 1 - robustResidual / 0.24)),
    changedFraction: changed,
  };
}

/** Score a known transform on a caller-supplied validity mask. This is used
 * to compare ordinary and change-aware registration candidates against the
 * exact same unchanged pixels. */
export function evaluateRegistrationStructuralScore(
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  transform: SimilarityTransform,
): { score: number; changedFraction: number } {
  if (
    referenceFrame.width !== movingFrame.width ||
    referenceFrame.height !== movingFrame.height
  ) {
    return { score: 0, changedFraction: 1 };
  }
  return robustStructuralScore(
    frameToGray(referenceFrame),
    frameToGray(movingFrame),
    transform,
  );
}

export interface LocalAnchorEvidence {
  cells: number;
  spread: number;
  structuralScore: number;
}

/** Verify feature consensus only around unchanged anchor neighborhoods. This
 * lets a small but well-distributed part of the image support one global
 * transform without allowing the edited area itself to drive alignment. */
export function evaluateLocalAnchors(
  reference: GrayImage,
  moving: GrayImage,
  transform: SimilarityTransform,
  inliers: PointMatch[],
  options: RegistrationOptions,
): LocalAnchorEvidence {
  const cells = new Set<number>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const patchScores: number[] = [];
  for (const match of inliers) {
    const column = Math.min(
      options.gridColumns - 1,
      Math.max(
        0,
        Math.floor((match.referenceX / reference.width) * options.gridColumns),
      ),
    );
    const row = Math.min(
      options.gridRows - 1,
      Math.max(
        0,
        Math.floor((match.referenceY / reference.height) * options.gridRows),
      ),
    );
    cells.add(row * options.gridColumns + column);
    minX = Math.min(minX, match.referenceX);
    minY = Math.min(minY, match.referenceY);
    maxX = Math.max(maxX, match.referenceX);
    maxY = Math.max(maxY, match.referenceY);

    let count = 0;
    let refSum = 0;
    let movingSum = 0;
    let refSquared = 0;
    let movingSquared = 0;
    let product = 0;
    for (let oy = -8; oy <= 8; oy += 2) {
      for (let ox = -8; ox <= 8; ox += 2) {
        const rx = match.referenceX + ox;
        const ry = match.referenceY + oy;
        const source = inverseTransformPoint(transform, rx, ry);
        if (!source) continue;
        const mx = source.x;
        const my = source.y;
        if (
          rx < 0 ||
          ry < 0 ||
          rx >= reference.width ||
          ry >= reference.height ||
          mx < 0 ||
          my < 0 ||
          mx >= moving.width - 1 ||
          my >= moving.height - 1
        ) {
          continue;
        }
        const refX = Math.round(rx);
        const refY = Math.round(ry);
        const movingX = Math.round(mx);
        const movingY = Math.round(my);
        if (
          (reference.validMask &&
            !reference.validMask[refY * reference.width + refX]) ||
          (moving.validMask &&
            !moving.validMask[movingY * moving.width + movingX])
        ) {
          continue;
        }
        const refValue = bilinearSample(reference, rx, ry);
        const movingValue = bilinearSample(moving, mx, my);
        count++;
        refSum += refValue;
        movingSum += movingValue;
        refSquared += refValue * refValue;
        movingSquared += movingValue * movingValue;
        product += refValue * movingValue;
      }
    }
    if (count < 30) continue;
    const covariance = product - (refSum * movingSum) / count;
    const refVariance = refSquared - (refSum * refSum) / count;
    const movingVariance = movingSquared - (movingSum * movingSum) / count;
    const denominatorNcc = Math.sqrt(
      Math.max(0, refVariance) * Math.max(0, movingVariance),
    );
    if (denominatorNcc > 1e-6) {
      patchScores.push(Math.max(-1, Math.min(1, covariance / denominatorNcc)));
    }
  }

  patchScores.sort((a, b) => a - b);
  const structuralScore = patchScores.length
    ? patchScores[Math.floor(patchScores.length / 2)]
    : 0;
  const spread = Number.isFinite(minX)
    ? Math.hypot(maxX - minX, maxY - minY) /
      Math.max(1, Math.hypot(reference.width, reference.height))
    : 0;
  return { cells: cells.size, spread, structuralScore };
}
