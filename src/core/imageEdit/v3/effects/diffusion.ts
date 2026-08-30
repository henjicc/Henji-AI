import type { DiffusionRecipe } from '../../diffusionRecipe';
import {
  assertFloat32PremultipliedRgbaTile,
  createFloat32PremultipliedRgbaTile,
  mixProcessedWithMask,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from './contracts';

const MAX_RECOVERY_GAIN = 3;
const ALPHA_EPSILON = 0.00001;

export interface DiffusionGlobalScatterV4 {
  readonly tile: Float32PremultipliedRgbaTile;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly sourceX: number;
  readonly sourceY: number;
}

export interface ApplyDiffusionV4Options {
  readonly mask?: Float32MaskTile;
  readonly globalScatter?: DiffusionGlobalScatterV4;
}

/** 与 diffusion.wgsl 的 fragment_source + 连续 mip 散射保持同一数学。 */
export function buildDiffusionScatterV4(
  source: Float32PremultipliedRgbaTile,
  recipe: DiffusionRecipe,
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(source, 'linear-light');
  const emitted = extractDiffusionSourceV4(source, recipe);
  const levels: Float32PremultipliedRgbaTile[] = [];
  let previous = emitted;
  for (const level of recipe.scatterLevels) {
    const width = Math.max(1, Math.ceil(source.width / level.divisor));
    const height = Math.max(1, Math.ceil(source.height / level.divisor));
    previous = downsampleScatter(previous, width, height);
    levels.push(previous);
  }
  if (levels.length === 0) return emitted;
  let accumulated = levels[levels.length - 1];
  for (let index = levels.length - 2; index >= 0; index -= 1) {
    accumulated = upsampleScatter(
      levels[index],
      accumulated,
      recipe.scatterLevels[index].weight,
      index === levels.length - 2
        ? recipe.scatterLevels[index + 1].weight
        : [1, 1, 1],
    );
  }
  return accumulated;
}

/** Float32 CPU 参考实现；全局散射缺省时用于完整代理图，提供时用于最终分块合成。 */
export function applyDiffusionV4(
  source: Float32PremultipliedRgbaTile,
  recipe: DiffusionRecipe,
  options: ApplyDiffusionV4Options = {},
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(source, 'linear-light');
  const emitted = extractDiffusionSourceV4(source, recipe);
  const scatter = options.globalScatter?.tile ?? buildDiffusionScatterV4(source, recipe);
  assertFloat32PremultipliedRgbaTile(scatter, 'linear-light');
  const output = new Float32Array(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const alpha = source.data[offset + 3];
      if (alpha <= ALPHA_EPSILON) continue;
      const base: Rgb = [
        source.data[offset] / alpha,
        source.data[offset + 1] / alpha,
        source.data[offset + 2] / alpha,
      ];
      let scattered = sampleGlobalScatter(scatter, source, x, y, options.globalScatter);
      if (recipe.mode === 'glow') {
        const core = crossLowpass(emitted, x, y, 2, true);
        scattered = mixRgb(scattered, core, recipe.glow.coreWeight);
      }
      const scatterLuma = luminance(scattered);
      scattered = mixRgb(scattered, [scatterLuma, scatterLuma, scatterLuma], recipe.tone.scatterDesaturation);
      scattered = multiplyRgb(scattered, recipe.tone.scatterTint);
      scattered = multiplyRgb(scattered, mixRgb([1, 1, 1], recipe.tint.rgb, recipe.tint.amount));
      scattered = scaleRgb(scattered, recipe.tint.gain);

      let color: Rgb;
      if (recipe.mode === 'glow') {
        let bloom = scaleRgb(scattered, recipe.glow.exposure);
        const bloomPeak = Math.max(...bloom);
        const heat = smoothstep(0.35, 1.4, bloomPeak);
        bloom = mixRgb(bloom, [bloomPeak, bloomPeak, bloomPeak], heat * recipe.glow.tintCoreWhite);
        color = tonemapGlow(addRgb(base, bloom), recipe.glow.shoulderKnee, recipe.glow.bleach);
      } else {
        const emittedRgb = readRgb(emitted.data, offset);
        const deduction: Rgb = [
          Math.min(base[0], emittedRgb[0] * recipe.energy.scatterFraction),
          Math.min(base[1], emittedRgb[1] * recipe.energy.scatterFraction),
          Math.min(base[2], emittedRgb[2] * recipe.energy.scatterFraction),
        ];
        const direct = maxRgb(subtractRgb(base, deduction), 0);
        const shadowResponse = smoothstep(0, 0.02, luminance(base));
        const absorption = mix(1, shadowResponse, recipe.tone.shadowAbsorption);
        color = addRgb(direct, scaleRgb(scattered, recipe.energy.scatterFraction * absorption));
        const nearBase = crossLowpass(source, x, y, 1, false);
        const farBase = crossLowpass(source, x, y, 3, false);
        color = addRgb(color, scaleRgb(subtractRgb(base, nearBase), recipe.detail.highFrequencyRetention * 0.3));
        color = addRgb(color, scaleRgb(subtractRgb(nearBase, farBase), recipe.detail.midFrequencyRetention * 0.15));
        if (recipe.mode === 'white_mist') {
          const veil = recipe.energy.veil * (0.2 + scatterLuma * 0.8);
          color = addRgb(color, [veil, veil, veil]);
        }
        color = color.map((value) => compressHighlight(value, recipe.tone.highlightCompression)) as Rgb;
        color = maxRgb(color, 0);
      }
      output[offset] = color[0] * alpha;
      output[offset + 1] = color[1] * alpha;
      output[offset + 2] = color[2] * alpha;
      output[offset + 3] = alpha;
    }
  }
  const processed = tileLike(source, output);
  return mixProcessedWithMask(source, processed, options.mask);
}

function extractDiffusionSourceV4(
  source: Float32PremultipliedRgbaTile,
  recipe: DiffusionRecipe,
): Float32PremultipliedRgbaTile {
  const output = new Float32Array(source.data.length);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    if (alpha <= ALPHA_EPSILON) continue;
    const color: Rgb = [
      source.data[offset] / alpha,
      source.data[offset + 1] / alpha,
      source.data[offset + 2] / alpha,
    ];
    let emitted: Rgb;
    if (recipe.mode === 'glow') {
      emitted = bloomBrightPass(color, recipe);
    } else {
      const ev = Math.log2(Math.max(luminance(color), 1e-6) / 0.18);
      const knee = Math.max(recipe.source.softKneeEV, 1e-3);
      const shoulder = clamp01((ev - recipe.source.thresholdEV + knee) / (2 * knee));
      const highlight = Math.pow(shoulder * shoulder * (3 - 2 * shoulder), Math.max(recipe.source.power, 0.1));
      const ratio = mix(recipe.source.scatterFloor, 1, highlight);
      emitted = [0, 1, 2].map((channel) => Math.min(
        color[channel] * ratio * recipe.source.highlightGain,
        color[channel],
      )) as Rgb;
      const peak = Math.max(...color);
      const recovery = 1 + smoothstep(0.94, 1, peak) * recipe.source.highlightRecovery * MAX_RECOVERY_GAIN;
      emitted = scaleRgb(emitted, recovery);
    }
    output[offset] = emitted[0] * alpha;
    output[offset + 1] = emitted[1] * alpha;
    output[offset + 2] = emitted[2] * alpha;
    output[offset + 3] = alpha;
  }
  return tileLike(source, output);
}

function bloomBrightPass(color: Rgb, recipe: DiffusionRecipe): Rgb {
  const brightness = Math.max(...color);
  const threshold = 0.18 * (2 ** recipe.source.thresholdEV);
  const knee = Math.max(threshold * clamp(recipe.source.softKneeEV / 2.4, 0.1, 0.5), 1e-5);
  let soft = clamp(brightness - threshold + knee, 0, 2 * knee);
  soft = soft * soft / (4 * knee);
  return scaleRgb(color, Math.max(brightness - threshold, soft) / Math.max(brightness, 1e-5) * recipe.source.highlightGain);
}

function downsampleScatter(
  source: Float32PremultipliedRgbaTile,
  width: number,
  height: number,
): Float32PremultipliedRgbaTile {
  const output = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = (x + 0.5) * source.width / width - 0.5;
    const sy = (y + 0.5) * source.height / height - 0.5;
    const taps: readonly [number, number, number][] = [
      [0, 0, 0.125], [1, 0, 0.0625], [-1, 0, 0.0625], [0, 1, 0.0625], [0, -1, 0.0625],
      [1, 1, 0.03125], [-1, -1, 0.03125], [1, -1, 0.03125], [-1, 1, 0.03125],
      [0.5, 0.5, 0.125], [-0.5, -0.5, 0.125], [0.5, -0.5, 0.125], [-0.5, 0.5, 0.125],
    ];
    const target = (y * width + x) * 4;
    for (const [dx, dy, weight] of taps) for (let channel = 0; channel < 4; channel += 1) {
      output[target + channel] += sample(source, sx + dx, sy + dy, channel) * weight;
    }
  }
  return createFloat32PremultipliedRgbaTile(width, height, 'linear-light', output, source.workingSpace, source.transferFunction, source.referenceWhiteNits);
}

function upsampleScatter(
  high: Float32PremultipliedRgbaTile,
  low: Float32PremultipliedRgbaTile,
  highWeight: readonly [number, number, number],
  lowWeight: readonly [number, number, number],
): Float32PremultipliedRgbaTile {
  const output = new Float32Array(high.data.length);
  const taps: readonly [number, number, number][] = [
    [0, 0, 0.25], [1, 0, 0.125], [-1, 0, 0.125], [0, 1, 0.125], [0, -1, 0.125],
    [1, 1, 0.0625], [-1, -1, 0.0625], [1, -1, 0.0625], [-1, 1, 0.0625],
  ];
  for (let y = 0; y < high.height; y += 1) for (let x = 0; x < high.width; x += 1) {
    const lx = (x + 0.5) * low.width / high.width - 0.5;
    const ly = (y + 0.5) * low.height / high.height - 0.5;
    const offset = (y * high.width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      let lowSample = 0;
      for (const [dx, dy, weight] of taps) lowSample += sample(low, lx + dx, ly + dy, channel) * weight;
      const highChannelWeight = channel === 3 ? highWeight[1] : highWeight[channel];
      const lowChannelWeight = channel === 3 ? lowWeight[1] : lowWeight[channel];
      output[offset + channel] = high.data[offset + channel] * highChannelWeight + lowSample * lowChannelWeight;
    }
  }
  return tileLike(high, output);
}

function sampleGlobalScatter(
  scatter: Float32PremultipliedRgbaTile,
  source: Float32PremultipliedRgbaTile,
  x: number,
  y: number,
  global?: DiffusionGlobalScatterV4,
): Rgb {
  const normalizedX = global
    ? (global.sourceX + x + 0.5) / global.documentWidth
    : (x + 0.5) / source.width;
  const normalizedY = global
    ? (global.sourceY + y + 0.5) / global.documentHeight
    : (y + 0.5) / source.height;
  const sx = normalizedX * scatter.width - 0.5;
  const sy = normalizedY * scatter.height - 0.5;
  return [sample(scatter, sx, sy, 0), sample(scatter, sx, sy, 1), sample(scatter, sx, sy, 2)];
}

function crossLowpass(tile: Float32PremultipliedRgbaTile, x: number, y: number, radius: number, premultiplied: boolean): Rgb {
  const points: readonly [number, number, number][] = [[0, 0, 0.5], [-radius, 0, 0.125], [radius, 0, 0.125], [0, -radius, 0.125], [0, radius, 0.125]];
  const result: Rgb = [0, 0, 0];
  for (const [dx, dy, weight] of points) {
    const alpha = sample(tile, x + dx, y + dy, 3);
    for (let channel = 0; channel < 3; channel += 1) {
      const value = sample(tile, x + dx, y + dy, channel);
      result[channel] += (premultiplied || alpha <= ALPHA_EPSILON ? value : value / alpha) * weight;
    }
  }
  return result;
}

function tonemapGlow(color: Rgb, knee: number, bleach: number): Rgb {
  const peak = Math.max(...color);
  if (knee >= 1 || peak <= knee) return color;
  const range = Math.max(1 - knee, 1e-4);
  const rolled = knee + range * (1 - Math.exp(-(peak - knee) / range));
  const scaled = scaleRgb(color, rolled / Math.max(peak, 1e-5));
  const overflow = clamp01((peak - rolled) / Math.max(peak, 1e-5));
  return mixRgb(scaled, [rolled, rolled, rolled], overflow * bleach);
}

function compressHighlight(value: number, amount: number): number {
  const safe = Math.max(value, 0);
  const shoulder = clamp(amount, 0, 0.45);
  if (shoulder <= 1e-5) return safe;
  const start = 1 - shoulder;
  return safe <= start ? safe : start + shoulder * (1 - Math.exp(-(safe - start) / shoulder));
}

type Rgb = [number, number, number];
const readRgb = (data: Float32Array, offset: number): Rgb => [data[offset], data[offset + 1], data[offset + 2]];
const luminance = (rgb: readonly number[]): number => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
const addRgb = (a: readonly number[], b: readonly number[]): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtractRgb = (a: readonly number[], b: readonly number[]): Rgb => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleRgb = (rgb: readonly number[], amount: number): Rgb => [rgb[0] * amount, rgb[1] * amount, rgb[2] * amount];
const multiplyRgb = (a: readonly number[], b: readonly number[]): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const maxRgb = (rgb: readonly number[], minimum: number): Rgb => [Math.max(rgb[0], minimum), Math.max(rgb[1], minimum), Math.max(rgb[2], minimum)];
const mixRgb = (a: readonly number[], b: readonly number[], amount: number): Rgb => [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)];
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const smoothstep = (low: number, high: number, value: number): number => {
  const t = clamp01((value - low) / Math.max(high - low, Number.EPSILON));
  return t * t * (3 - 2 * t);
};

function sample(tile: Float32PremultipliedRgbaTile, x: number, y: number, channel: number): number {
  const x0 = clamp(Math.floor(x), 0, tile.width - 1);
  const y0 = clamp(Math.floor(y), 0, tile.height - 1);
  const x1 = clamp(x0 + 1, 0, tile.width - 1);
  const y1 = clamp(y0 + 1, 0, tile.height - 1);
  const fx = clamp01(x - Math.floor(x));
  const fy = clamp01(y - Math.floor(y));
  const top = mix(tile.data[(y0 * tile.width + x0) * 4 + channel], tile.data[(y0 * tile.width + x1) * 4 + channel], fx);
  const bottom = mix(tile.data[(y1 * tile.width + x0) * 4 + channel], tile.data[(y1 * tile.width + x1) * 4 + channel], fx);
  return mix(top, bottom, fy);
}

function tileLike(source: Float32PremultipliedRgbaTile, data: Float32Array): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(source.width, source.height, 'linear-light', data, source.workingSpace, source.transferFunction, source.referenceWhiteNits);
}
