import {
  assertFloat32PremultipliedRgbaTile,
  cloneFloat32Tile,
  mapStraightRgbPreservingAlpha,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';

export interface HslAdjustmentParameters {
  readonly hueDegrees: number;
  readonly saturation: number;
  readonly lightness: number;
}

export const HSL_ADJUSTMENT_CONTRACT: CpuReferenceKernelContract = {
  id: 'adjustment.hsl',
  version: 1,
  inputColorDomain: 'perceptual-working',
  outputColorDomain: 'perceptual-working',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

export function applyHslAdjustment(
  tile: Float32PremultipliedRgbaTile,
  parameters: HslAdjustmentParameters,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  validateParameters(parameters);
  assertFloat32PremultipliedRgbaTile(tile, HSL_ADJUSTMENT_CONTRACT.inputColorDomain);
  if (
    parameters.hueDegrees === 0
    && parameters.saturation === 0
    && parameters.lightness === 0
  ) return cloneFloat32Tile(tile);

  return mapStraightRgbPreservingAlpha(
    tile,
    HSL_ADJUSTMENT_CONTRACT.inputColorDomain,
    (red, green, blue) => {
      // HSL 的定义域为 [0,1]。Float32 头部/负色域不被丢弃，而是作为残差带回结果。
      const bounded: readonly [number, number, number] = [
        clampUnit(red),
        clampUnit(green),
        clampUnit(blue),
      ];
      const residual: readonly [number, number, number] = [
        red - bounded[0],
        green - bounded[1],
        blue - bounded[2],
      ];
      const hsl = rgbToHsl(bounded[0], bounded[1], bounded[2]);
      const adjusted = hslToRgb(
        positiveModulo(hsl[0] + parameters.hueDegrees / 360, 1),
        adjustUnit(hsl[1], parameters.saturation),
        adjustUnit(hsl[2], parameters.lightness),
      );
      return [
        adjusted[0] + residual[0],
        adjusted[1] + residual[1],
        adjusted[2] + residual[2],
      ];
    },
    options,
  );
}

function rgbToHsl(red: number, green: number, blue: number): readonly [number, number, number] {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return [0, 0, lightness];
  let hue: number;
  if (maximum === red) hue = ((green - blue) / delta) / 6;
  else if (maximum === green) hue = (((blue - red) / delta) + 2) / 6;
  else hue = (((red - green) / delta) + 4) / 6;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return [positiveModulo(hue, 1), saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue * 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  let base: readonly [number, number, number];
  if (sector < 1) base = [chroma, second, 0];
  else if (sector < 2) base = [second, chroma, 0];
  else if (sector < 3) base = [0, chroma, second];
  else if (sector < 4) base = [0, second, chroma];
  else if (sector < 5) base = [second, 0, chroma];
  else base = [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return [base[0] + offset, base[1] + offset, base[2] + offset];
}

function adjustUnit(value: number, amount: number): number {
  return amount >= 0 ? value + (1 - value) * amount : value * (1 + amount);
}

function validateParameters(parameters: HslAdjustmentParameters): void {
  if (!Number.isFinite(parameters.hueDegrees)) throw new Error('HSL 色相必须是有限数');
  if (
    !Number.isFinite(parameters.saturation)
    || parameters.saturation < -1
    || parameters.saturation > 1
  ) throw new Error('HSL 饱和度必须位于 -1～1');
  if (
    !Number.isFinite(parameters.lightness)
    || parameters.lightness < -1
    || parameters.lightness > 1
  ) throw new Error('HSL 明度必须位于 -1～1');
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
