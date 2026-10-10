import type { ImageEditWorkingSpaceV3 } from '../colorTypes';
import type { ImageEditColorDomain } from '../renderNodeDefinition';
import {
  createFloat32PremultipliedRgbaTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts';

import { linearWorkingSpaceMatrixV3, encodeSrgbExtended, decodeTransferFunctionV3, encodeTransferFunctionV3 } from '../../../imaging/colorManagement';
export { linearWorkingSpaceMatrixV3, decodeSrgbExtended, encodeSrgbExtended, decodeTransferFunctionV3, encodeTransferFunctionV3 } from '../../../imaging/colorManagement';
export type { RgbMatrix3 as ImageEditColorMatrix3V3 } from '../../../imaging/colorManagement';

export function convertFloat32TileColorDomainV3(
  tile: Float32PremultipliedRgbaTile,
  target: ImageEditColorDomain,
): Float32PremultipliedRgbaTile {
  if (tile.colorDomain === target) return tile;
  const sourceIsLinear = tile.colorDomain === 'linear-light';
  const targetIsLinear = target === 'linear-light';
  if (sourceIsLinear === targetIsLinear) {
    return createFloat32PremultipliedRgbaTile(
      tile.width, tile.height, target, new Float32Array(tile.data), tile.workingSpace,
      tile.transferFunction, tile.referenceWhiteNits,
    );
  }
  const data = new Float32Array(tile.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = tile.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const straight = tile.data[offset + channel] / alpha;
      const converted = targetIsLinear
        ? decodeTransferFunctionV3(straight, tile.transferFunction, tile.referenceWhiteNits)
        : encodeTransferFunctionV3(straight, tile.transferFunction, tile.referenceWhiteNits);
      data[offset + channel] = converted * alpha;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, target, data, tile.workingSpace,
    tile.transferFunction, tile.referenceWhiteNits,
  );
}

/** 线性 D65 RGB 原色转换；不裁切负值或超白，确保 16 位/HDR 中间结果可逆。 */
export function convertFloat32TileWorkingSpaceV3(
  tile: Float32PremultipliedRgbaTile,
  target: ImageEditWorkingSpaceV3,
): Float32PremultipliedRgbaTile {
  if (tile.workingSpace === target) return tile;
  const originalDomain = tile.colorDomain;
  const linear = convertFloat32TileColorDomainV3(tile, 'linear-light');
  const data = new Float32Array(linear.data.length);
  const matrix = linearWorkingSpaceMatrixV3(linear.workingSpace, target);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = linear.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    const red = linear.data[offset] / alpha, green = linear.data[offset + 1] / alpha, blue = linear.data[offset + 2] / alpha;
    const converted = [matrix[0] * red + matrix[1] * green + matrix[2] * blue, matrix[3] * red + matrix[4] * green + matrix[5] * blue, matrix[6] * red + matrix[7] * green + matrix[8] * blue];
    data[offset] = converted[0] * alpha;
    data[offset + 1] = converted[1] * alpha;
    data[offset + 2] = converted[2] * alpha;
  }
  const targetLinear = createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, 'linear-light', data, target,
    tile.transferFunction, tile.referenceWhiteNits,
  );
  return convertFloat32TileColorDomainV3(targetLinear, originalDomain);
}

/** 在合成边界统一完整颜色契约；参考白换算必须在线性域执行，不能仅改元数据。 */
export function convertFloat32TileColorContractV3(
  tile: Float32PremultipliedRgbaTile,
  target: Pick<Float32PremultipliedRgbaTile,
    'colorDomain' | 'workingSpace' | 'transferFunction' | 'referenceWhiteNits'>,
): Float32PremultipliedRgbaTile {
  if (tile.workingSpace === target.workingSpace
    && tile.transferFunction === target.transferFunction
    && tile.referenceWhiteNits === target.referenceWhiteNits) {
    return convertFloat32TileColorDomainV3(tile, target.colorDomain);
  }
  const linear = convertFloat32TileWorkingSpaceV3(
    convertFloat32TileColorDomainV3(tile, 'linear-light'), target.workingSpace,
  );
  const data = new Float32Array(linear.data);
  const whiteScale = linear.referenceWhiteNits / target.referenceWhiteNits;
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) data[offset + channel] *= whiteScale;
  }
  const converted = createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, 'linear-light', data, target.workingSpace,
    target.transferFunction, target.referenceWhiteNits,
  );
  return convertFloat32TileColorDomainV3(converted, target.colorDomain);
}

/** HDR/宽色域到普通屏幕的明确显示变换；仅生成预览，绝不修改权威像素。 */
export function toneMapFloat32TileToSdrV3(
  tile: Float32PremultipliedRgbaTile,
  target: Extract<ImageEditWorkingSpaceV3, 'srgb' | 'display-p3'> = 'srgb',
): Float32PremultipliedRgbaTile {
  const converted = convertFloat32TileWorkingSpaceV3(
    convertFloat32TileColorDomainV3(tile, 'linear-light'),
    target,
  );
  const data = new Float32Array(converted.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = converted.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.max(0, converted.data[offset + channel] / alpha);
      const mapped = Math.min(1, Math.max(0, (value * (2.51 * value + 0.03))
        / (value * (2.43 * value + 0.59) + 0.14)));
      data[offset + channel] = encodeSrgbExtended(mapped) * alpha;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, 'perceptual-working', data, target, 'srgb', 203,
  );
}
