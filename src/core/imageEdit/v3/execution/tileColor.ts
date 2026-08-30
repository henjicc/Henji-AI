import type { ImageEditColorDomain } from '../renderNodeDefinition';
import {
  createFloat32PremultipliedRgbaTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts';

export function convertFloat32TileColorDomainV3(
  tile: Float32PremultipliedRgbaTile,
  target: ImageEditColorDomain,
): Float32PremultipliedRgbaTile {
  if (tile.colorDomain === target) return tile;
  const sourceIsLinear = tile.colorDomain === 'linear-light';
  const targetIsLinear = target === 'linear-light';
  if (sourceIsLinear === targetIsLinear) {
    return createFloat32PremultipliedRgbaTile(
      tile.width,
      tile.height,
      target,
      new Float32Array(tile.data),
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
        ? decodeSrgbExtended(straight)
        : encodeSrgbExtended(straight);
      data[offset + channel] = converted * alpha;
    }
  }
  return createFloat32PremultipliedRgbaTile(tile.width, tile.height, target, data);
}

/** sRGB 扩展传递函数保留负值和 HDR 头部空间，不在转换边界裁切。 */
export function decodeSrgbExtended(value: number): number {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.04045
    ? magnitude / 12.92
    : ((magnitude + 0.055) / 1.055) ** 2.4);
}

export function encodeSrgbExtended(value: number): number {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.0031308
    ? 12.92 * magnitude
    : 1.055 * (magnitude ** (1 / 2.4)) - 0.055);
}
