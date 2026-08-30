import type { RegistrationFrame, SimilarityTransform } from "./types";
import { inverseTransformPoint } from "./transform";

export type PhotometricCorrectionScope = "auto" | "luminance" | "color";
export type PhotometricModelKind = "identity" | "luminance" | "rgb";

interface ColorSample {
  x: number;
  y: number;
  reference: [number, number, number];
  moving: [number, number, number];
  validation: boolean;
  excluded: boolean;
  weight: number;
}

interface Candidate {
  kind: Exclude<PhotometricModelKind, "identity">;
  gains: [number, number, number];
  biases: [number, number, number];
}

export interface PhotometricModel {
  /** Apply reference ~= gain * moving + bias. */
  gains: [number, number, number];
  biases: [number, number, number];
  kind: PhotometricModelKind;
  accepted: boolean;
  rejectionReason?: string;
  brightnessGain: number;
  brightnessBias: number;
  saturationScale: number;
  /** Validation error after the selected mapping. */
  rmse: number;
  baselineRmse: number;
  validationImprovement: number;
  outlierFraction: number;
  excludedFraction: number;
  validationSamples: number;
  iterations: number;
  samples: number;
}

const MAX_SAMPLES = 60_000;
const MIN_VALIDATION_SAMPLES = 64;
const MAX_EXCLUDED_FRACTION = 0.45;
const LUMINANCE_WEIGHTS = [0.299, 0.587, 0.114] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pixelRgb(
  frame: RegistrationFrame,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
  const pixel = y * frame.width + x;
  if (frame.validMask && !frame.validMask[pixel]) return null;
  const offset = pixel * frame.components;
  if (frame.components >= 3) {
    return [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]];
  }
  const value = frame.data[offset];
  return [value, value, value];
}

function bilinearRgb(
  frame: RegistrationFrame,
  x: number,
  y: number,
): [number, number, number] | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const p00 = pixelRgb(frame, x0, y0);
  const p10 = pixelRgb(frame, x0 + 1, y0);
  const p01 = pixelRgb(frame, x0, y0 + 1);
  const p11 = pixelRgb(frame, x0 + 1, y0 + 1);
  if (!p00 || !p10 || !p01 || !p11) return null;
  const fx = x - x0;
  const fy = y - y0;
  return [0, 1, 2].map((channel) => {
    const top = p00[channel] * (1 - fx) + p10[channel] * fx;
    const bottom = p01[channel] * (1 - fx) + p11[channel] * fx;
    return top * (1 - fy) + bottom * fy;
  }) as [number, number, number];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function residual(
  sample: ColorSample,
  gains: readonly number[],
  biases: readonly number[],
): number {
  let squared = 0;
  for (let channel = 0; channel < 3; channel++) {
    const predicted = gains[channel] * sample.moving[channel] + biases[channel];
    const error = sample.reference[channel] - predicted;
    squared += error * error;
  }
  return Math.sqrt(squared / 3);
}

function solveAffine(
  samples: ColorSample[],
  channel: number | null,
): { gain: number; bias: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const sample of samples) {
    if (sample.validation || sample.excluded || sample.weight <= 0) continue;
    const channels = channel === null ? [0, 1, 2] : [channel];
    for (const current of channels) {
      const weight = sample.weight;
      const x = sample.moving[current];
      const y = sample.reference[current];
      sw += weight;
      sx += weight * x;
      sy += weight * y;
      sxx += weight * x * x;
      sxy += weight * x * y;
    }
  }
  const denominator = sw * sxx - sx * sx;
  if (sw <= 0 || Math.abs(denominator) < 1e-6) return { gain: 1, bias: 0 };
  return {
    gain: clamp((sw * sxy - sx * sy) / denominator, 0.65, 1.5),
    bias: clamp((sy * sxx - sx * sxy) / denominator, -48, 48),
  };
}

function fitCandidate(
  samples: ColorSample[],
  kind: Candidate["kind"],
): Candidate {
  samples.forEach((sample) => {
    sample.weight = sample.excluded ? 0 : 1;
  });
  let gains: [number, number, number] = [1, 1, 1];
  let biases: [number, number, number] = [0, 0, 0];
  for (let iteration = 0; iteration < 5; iteration++) {
    if (kind === "luminance") {
      const fit = solveAffine(samples, null);
      gains = [fit.gain, fit.gain, fit.gain];
      biases = [fit.bias, fit.bias, fit.bias];
    } else {
      const fits = [0, 1, 2].map((channel) => solveAffine(samples, channel));
      gains = fits.map((fit) => fit.gain) as [number, number, number];
      biases = fits.map((fit) => fit.bias) as [number, number, number];
    }
    const active = samples.filter(
      (sample) => !sample.validation && !sample.excluded,
    );
    const residuals = active.map((sample) => residual(sample, gains, biases));
    const delta = Math.max(3, median(residuals) * 1.5);
    active.forEach((sample, index) => {
      const error = residuals[index];
      sample.weight = error <= delta ? 1 : delta / Math.max(delta, error);
    });
  }
  return { kind, gains, biases };
}

function collectSamples(
  reference: RegistrationFrame,
  moving: RegistrationFrame,
  transform: SimilarityTransform,
): { samples: ColorSample[]; step: number } | null {
  const step = Math.max(
    2,
    Math.ceil(Math.sqrt((reference.width * reference.height) / MAX_SAMPLES)),
  );
  const samples: ColorSample[] = [];
  const start = Math.max(1, Math.floor(step / 2));
  for (let y = start; y < reference.height - 1; y += step) {
    for (let x = start; x < reference.width - 1; x += step) {
      const referenceColor = pixelRgb(reference, x, y);
      if (!referenceColor) continue;
      const source = inverseTransformPoint(transform, x, y);
      if (!source) return null;
      const movingColor = bilinearRgb(moving, source.x, source.y);
      if (!movingColor) continue;
      // Fully clipped values carry little information about exposure and can
      // be a genuine edit (for example black hair changed to white).
      if (
        referenceColor.some((value) => value <= 1 || value >= 254) ||
        movingColor.some((value) => value <= 1 || value >= 254)
      ) {
        continue;
      }
      const gridX = Math.floor(x / step);
      const gridY = Math.floor(y / step);
      const hash = (gridX * 73856093) ^ (gridY * 19349663);
      samples.push({
        x,
        y,
        reference: referenceColor,
        moving: movingColor,
        validation: (hash & 3) === 0,
        excluded: false,
        weight: 1,
      });
    }
  }
  return { samples, step };
}

/** Detect high-residual cells and expand them by one sampling cell.
 * This makes genuine edits ineligible for the final fit, including their
 * antialiased boundary where tiny geometric errors can create large residuals. */
function excludeChangedRegion(
  samples: ColorSample[],
  candidate: Candidate,
  width: number,
  height: number,
  step: number,
): number {
  const errors = samples
    .filter((sample) => !sample.excluded)
    .map((sample) => residual(sample, candidate.gains, candidate.biases));
  const center = median(errors);
  const mad = median(errors.map((value) => Math.abs(value - center)));
  const threshold = Math.max(8, center + Math.max(4, mad * 1.4826 * 3.5));
  const gridWidth = Math.ceil(width / step);
  const gridHeight = Math.ceil(height / step);
  const changed = new Uint8Array(gridWidth * gridHeight);
  for (const sample of samples) {
    if (sample.excluded) continue;
    if (residual(sample, candidate.gains, candidate.biases) < threshold)
      continue;
    const gridX = Math.floor(sample.x / step);
    const gridY = Math.floor(sample.y / step);
    changed[gridY * gridWidth + gridX] = 1;
  }
  const expanded = new Uint8Array(changed.length);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (!changed[y * gridWidth + x]) continue;
      for (let oy = -1; oy <= 1; oy++) {
        const targetY = y + oy;
        if (targetY < 0 || targetY >= gridHeight) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const targetX = x + ox;
          if (targetX < 0 || targetX >= gridWidth) continue;
          expanded[targetY * gridWidth + targetX] = 1;
        }
      }
    }
  }
  let newlyExcluded = 0;
  for (const sample of samples) {
    const gridX = Math.floor(sample.x / step);
    const gridY = Math.floor(sample.y / step);
    if (!sample.excluded && expanded[gridY * gridWidth + gridX]) {
      sample.excluded = true;
      newlyExcluded++;
    }
  }
  return newlyExcluded;
}

function evaluate(
  samples: ColorSample[],
  gains: readonly number[],
  biases: readonly number[],
): { rmse: number; count: number; clipping: number } {
  let squared = 0;
  let count = 0;
  let clipped = 0;
  const validation = samples.filter(
    (sample) => sample.validation && !sample.excluded,
  );
  for (const sample of validation) {
    const error = residual(sample, gains, biases);
    squared += error * error;
    count++;
    for (let channel = 0; channel < 3; channel++) {
      const source = sample.moving[channel];
      const mapped = gains[channel] * source + biases[channel];
      if (source > 2 && source < 253 && (mapped < 0 || mapped > 255)) clipped++;
    }
  }
  return {
    rmse: Math.sqrt(squared / Math.max(1, count)),
    count,
    clipping: clipped / Math.max(1, count * 3),
  };
}

function saturation(rgb: [number, number, number]): number {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max <= 1 ? 0 : (max - min) / max;
}

export function fitPhotometricModel(
  reference: RegistrationFrame,
  moving: RegistrationFrame,
  transform: SimilarityTransform,
  scope: PhotometricCorrectionScope = "auto",
): PhotometricModel | null {
  const collected = collectSamples(reference, moving, transform);
  if (!collected || collected.samples.length < 100) return null;
  const { samples, step } = collected;

  // The first robust color fit exists only to discover edited pixels. Those
  // pixels are then hard-excluded; they never participate in the final fit.
  let iterations = 0;
  for (let iteration = 0; iteration < 2; iteration++) {
    iterations++;
    const initial = fitCandidate(samples, "rgb");
    if (
      excludeChangedRegion(
        samples,
        initial,
        reference.width,
        reference.height,
        step,
      ) === 0
    ) {
      break;
    }
  }

  const excluded = samples.filter((sample) => sample.excluded).length;
  const excludedFraction = excluded / samples.length;
  const luminance = fitCandidate(samples, "luminance");
  const color = fitCandidate(samples, "rgb");
  const identityEvaluation = evaluate(samples, [1, 1, 1], [0, 0, 0]);
  const luminanceEvaluation = evaluate(
    samples,
    luminance.gains,
    luminance.biases,
  );
  const colorEvaluation = evaluate(samples, color.gains, color.biases);

  let selected = luminance;
  let selectedEvaluation = luminanceEvaluation;
  if (scope === "color") {
    selected = color;
    selectedEvaluation = colorEvaluation;
  } else if (scope === "auto") {
    const colorMustGain = Math.max(0.35, identityEvaluation.rmse * 0.03);
    if (colorEvaluation.rmse + colorMustGain < luminanceEvaluation.rmse) {
      selected = color;
      selectedEvaluation = colorEvaluation;
    }
  }

  const absoluteImprovement = identityEvaluation.rmse - selectedEvaluation.rmse;
  const relativeImprovement =
    absoluteImprovement / Math.max(1, identityEvaluation.rmse);
  const reachedSafetyLimit =
    selected.gains.some((gain) => gain <= 0.6501 || gain >= 1.4999) ||
    selected.biases.some((bias) => Math.abs(bias) >= 47.99);
  let rejectionReason: string | undefined;
  if (excludedFraction > MAX_EXCLUDED_FRACTION) {
    rejectionReason = "changed area is too large";
  } else if (selectedEvaluation.count < MIN_VALIDATION_SAMPLES) {
    rejectionReason = "insufficient unchanged validation samples";
  } else if (reachedSafetyLimit) {
    rejectionReason = "correction reached safety limits";
  } else if (selectedEvaluation.rmse > 24) {
    rejectionReason = "residual color error is too large";
  } else if (selectedEvaluation.clipping > 0.03) {
    rejectionReason = "correction would clip too many colors";
  } else if (absoluteImprovement < 0.75 || relativeImprovement < 0.08) {
    rejectionReason = "validation improvement is too small";
  }
  const accepted = !rejectionReason;

  let referenceSaturation = 0;
  let movingSaturation = 0;
  let saturationSamples = 0;
  for (const sample of samples) {
    if (sample.excluded) continue;
    referenceSaturation += saturation(sample.reference);
    movingSaturation += saturation(sample.moving);
    saturationSamples++;
  }
  const meanReferenceSaturation =
    referenceSaturation / Math.max(1, saturationSamples);
  const meanMovingSaturation =
    movingSaturation / Math.max(1, saturationSamples);
  const brightnessGain = selected.gains.reduce(
    (sum, value, index) => sum + value * LUMINANCE_WEIGHTS[index],
    0,
  );
  const brightnessBias = selected.biases.reduce(
    (sum, value, index) => sum + value * LUMINANCE_WEIGHTS[index],
    0,
  );

  return {
    gains: selected.gains,
    biases: selected.biases,
    kind: selected.kind,
    accepted,
    rejectionReason,
    brightnessGain,
    brightnessBias,
    saturationScale:
      meanMovingSaturation > 1e-4
        ? clamp(meanReferenceSaturation / meanMovingSaturation, 0.25, 4)
        : 1,
    rmse: selectedEvaluation.rmse,
    baselineRmse: identityEvaluation.rmse,
    validationImprovement: relativeImprovement,
    outlierFraction: excludedFraction,
    excludedFraction,
    validationSamples: selectedEvaluation.count,
    iterations,
    samples: samples.length,
  };
}
