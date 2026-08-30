import {
  mapStraightRgbPreservingAlpha,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';

export interface ExposureAdjustmentParameters {
  /** 线性光曝光档位；+1 stop 将辐射值乘以 2。 */
  readonly stops: number;
  /** 在线性光域、gamma 之前加入的浮点偏移。 */
  readonly offset: number;
  /** 1 为中性；使用保留符号的 `pow(value, 1 / gamma)`，不裁切 HDR。 */
  readonly gamma: number;
}

export const EXPOSURE_ADJUSTMENT_CONTRACT: CpuReferenceKernelContract = {
  id: 'adjustment.exposure',
  version: 1,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

export function applyExposureAdjustment(
  tile: Float32PremultipliedRgbaTile,
  parameters: ExposureAdjustmentParameters,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  validateExposureParameters(parameters);
  const multiplier = 2 ** parameters.stops;
  const gammaExponent = 1 / parameters.gamma;
  return mapStraightRgbPreservingAlpha(
    tile,
    EXPOSURE_ADJUSTMENT_CONTRACT.inputColorDomain,
    (red, green, blue) => [
      signedPower(red * multiplier + parameters.offset, gammaExponent),
      signedPower(green * multiplier + parameters.offset, gammaExponent),
      signedPower(blue * multiplier + parameters.offset, gammaExponent),
    ],
    options,
  );
}

function validateExposureParameters(parameters: ExposureAdjustmentParameters): void {
  if (!Number.isFinite(parameters.stops)) throw new Error('曝光档位必须是有限数');
  if (!Number.isFinite(parameters.offset)) throw new Error('曝光偏移必须是有限数');
  if (!Number.isFinite(parameters.gamma) || parameters.gamma <= 0) {
    throw new Error('曝光 gamma 必须大于 0');
  }
}

function signedPower(value: number, exponent: number): number {
  if (value === 0) return 0;
  return Math.sign(value) * (Math.abs(value) ** exponent);
}
