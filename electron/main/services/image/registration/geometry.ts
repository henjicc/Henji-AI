import {
  REGISTRATION_ROTATION_ENABLED,
  type RegistrationOptions,
  type SimilarityTransform,
} from "./types";
import type { PointMatch } from "./features";
import { DEFAULT_REGISTRATION_OPTIONS } from "./options";
import { transformPoint } from "./transform";

export function errorFor(transform: SimilarityTransform, match: PointMatch): number {
  const point = transformPoint(transform, match.movingX, match.movingY);
  return Math.hypot(point.x - match.referenceX, point.y - match.referenceY);
}
function linearFit(
  inputs: number[],
  outputs: number[],
): { slope: number; intercept: number; standardDeviation: number } | null {
  if (inputs.length < 3 || inputs.length !== outputs.length) return null;
  const inputMean =
    inputs.reduce((sum, value) => sum + value, 0) / inputs.length;
  const outputMean =
    outputs.reduce((sum, value) => sum + value, 0) / outputs.length;
  let variance = 0;
  let covariance = 0;
  for (let index = 0; index < inputs.length; index++) {
    const centered = inputs[index] - inputMean;
    variance += centered * centered;
    covariance += centered * (outputs[index] - outputMean);
  }
  if (variance < 1) return null;
  const slope = covariance / variance;
  return {
    slope,
    intercept: outputMean - slope * inputMean,
    standardDeviation: Math.sqrt(variance / inputs.length),
  };
}

/** Fit independent X/Y scales from an already robust consensus. */
export function refitAnisotropic(
  matches: PointMatch[],
  initial: SimilarityTransform,
  width: number,
  height: number,
  inputOptions: Partial<RegistrationOptions> = {},
): SimilarityTransform | null {
  if (matches.length < 6) return null;
  const options = { ...DEFAULT_REGISTRATION_OPTIONS, ...inputOptions };
  const angle = REGISTRATION_ROTATION_ENABLED
    ? Math.atan2(initial.b, initial.a)
    : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xInputs: number[] = [];
  const yInputs: number[] = [];
  const rotatedReferenceX: number[] = [];
  const rotatedReferenceY: number[] = [];
  for (const match of matches) {
    xInputs.push(match.movingX);
    yInputs.push(match.movingY);
    rotatedReferenceX.push(cos * match.referenceX + sin * match.referenceY);
    rotatedReferenceY.push(-sin * match.referenceX + cos * match.referenceY);
  }
  const xFit = linearFit(xInputs, rotatedReferenceX);
  const yFit = linearFit(yInputs, rotatedReferenceY);
  if (
    !xFit ||
    !yFit ||
    xFit.standardDeviation < width * 0.12 ||
    yFit.standardDeviation < height * 0.12
  ) {
    return null;
  }
  const scaleX = xFit.slope;
  const scaleY = yFit.slope;
  const anisotropy = Math.abs(scaleX / scaleY - 1);
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    Math.abs(scaleX - 1) > options.maxScaleChange ||
    Math.abs(scaleY - 1) > options.maxScaleChange ||
    anisotropy > options.maxAnisotropy
  ) {
    return null;
  }
  return {
    a: cos * scaleX,
    b: REGISTRATION_ROTATION_ENABLED ? sin * scaleX : 0,
    c: REGISTRATION_ROTATION_ENABLED ? -sin * scaleY : 0,
    d: cos * scaleY,
    tx: cos * xFit.intercept - sin * yFit.intercept,
    ty: sin * xFit.intercept + cos * yFit.intercept,
  };
}

function fromPair(
  first: PointMatch,
  second: PointMatch,
): SimilarityTransform | null {
  const px = second.movingX - first.movingX;
  const py = second.movingY - first.movingY;
  const qx = second.referenceX - first.referenceX;
  const qy = second.referenceY - first.referenceY;
  const denominator = px * px + py * py;
  if (denominator < 16) return null;
  const a = (qx * px + qy * py) / denominator;
  const b = REGISTRATION_ROTATION_ENABLED
    ? (qy * px - qx * py) / denominator
    : 0;
  return {
    a,
    b,
    tx:
      (first.referenceX -
        a * first.movingX +
        b * first.movingY +
        second.referenceX -
        a * second.movingX +
        b * second.movingY) /
      2,
    ty:
      (first.referenceY -
        b * first.movingX -
        a * first.movingY +
        second.referenceY -
        b * second.movingX -
        a * second.movingY) /
      2,
  };
}

function refit(matches: PointMatch[]): SimilarityTransform | null {
  if (matches.length < 2) return null;
  let pmx = 0;
  let pmy = 0;
  let qmx = 0;
  let qmy = 0;
  for (const match of matches) {
    pmx += match.movingX;
    pmy += match.movingY;
    qmx += match.referenceX;
    qmy += match.referenceY;
  }
  pmx /= matches.length;
  pmy /= matches.length;
  qmx /= matches.length;
  qmy /= matches.length;
  let denominator = 0;
  let numeratorA = 0;
  let numeratorB = 0;
  for (const match of matches) {
    const px = match.movingX - pmx;
    const py = match.movingY - pmy;
    const qx = match.referenceX - qmx;
    const qy = match.referenceY - qmy;
    denominator += px * px + py * py;
    numeratorA += qx * px + qy * py;
    numeratorB += qy * px - qx * py;
  }
  if (denominator < 1) return null;
  const a = numeratorA / denominator;
  const b = REGISTRATION_ROTATION_ENABLED ? numeratorB / denominator : 0;
  return {
    a,
    b,
    tx: qmx - a * pmx + b * pmy,
    ty: qmy - b * pmx - a * pmy,
  };
}

function isPlausible(
  transform: SimilarityTransform,
  options: RegistrationOptions,
) {
  const scale = Math.hypot(transform.a, transform.b);
  const rotation = Math.abs(
    (Math.atan2(transform.b, transform.a) * 180) / Math.PI,
  );
  return (
    Number.isFinite(scale) &&
    Math.abs(scale - 1) <= options.maxScaleChange &&
    rotation <=
      (REGISTRATION_ROTATION_ENABLED ? options.maxRotationDegrees : 1e-9)
  );
}

export function median(values: number[]): number {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function convexHullArea(matches: PointMatch[]): number {
  const points = matches
    .map((m) => ({ x: m.referenceX, y: m.referenceY }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length < 3) return 0;
  const cross = (
    o: (typeof points)[number],
    a: (typeof points)[number],
    b: (typeof points)[number],
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof points = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: typeof points = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const next = hull[(i + 1) % hull.length];
    area += hull[i].x * next.y - next.x * hull[i].y;
  }
  return Math.abs(area) / 2;
}

export function estimateSimilarityRansac(
  matches: PointMatch[],
  width: number,
  height: number,
  inputOptions: Partial<RegistrationOptions> = {},
): {
  transform: SimilarityTransform;
  inliers: PointMatch[];
  medianError: number;
  coverage: number;
} | null {
  const options = { ...DEFAULT_REGISTRATION_OPTIONS, ...inputOptions };
  if (matches.length < 2) return null;
  let state = (matches.length * 2654435761) >>> 0;
  const randomIndex = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % matches.length;
  };
  let bestTransform: SimilarityTransform | null = null;
  let bestInliers: PointMatch[] = [];
  let bestMedian = Infinity;
  for (let iteration = 0; iteration < options.ransacIterations; iteration++) {
    const firstIndex = randomIndex();
    let secondIndex = randomIndex();
    if (secondIndex === firstIndex)
      secondIndex = (secondIndex + 1) % matches.length;
    const candidate = fromPair(matches[firstIndex], matches[secondIndex]);
    if (!candidate || !isPlausible(candidate, options)) continue;
    const inliers = matches.filter(
      (match) => errorFor(candidate, match) <= options.inlierThreshold,
    );
    if (inliers.length < bestInliers.length) continue;
    const candidateMedian = median(
      inliers.map((match) => errorFor(candidate, match)),
    );
    if (inliers.length > bestInliers.length || candidateMedian < bestMedian) {
      bestTransform = candidate;
      bestInliers = inliers;
      bestMedian = candidateMedian;
    }
  }
  if (!bestTransform || bestInliers.length < 2) return null;
  const fitted = refit(bestInliers);
  if (!fitted || !isPlausible(fitted, options)) return null;
  const inliers = matches.filter(
    (match) => errorFor(fitted, match) <= options.inlierThreshold,
  );
  return {
    transform: fitted,
    inliers,
    medianError: median(inliers.map((match) => errorFor(fitted, match))),
    coverage: convexHullArea(inliers) / Math.max(1, width * height),
  };
}
