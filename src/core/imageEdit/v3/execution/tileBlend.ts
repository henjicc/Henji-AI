import { blendChannel, compositeChannel } from '../../../imaging/compositing';
import type { ImageEditBlendModeV3 } from '../layerTypes';
import {
  assertFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts';

export function applyContentMaskAndOpacityV3(
  content: Float32PremultipliedRgbaTile,
  opacity: number,
  mask?: Float32MaskTile,
): Float32PremultipliedRgbaTile {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('图层不透明度必须位于 0～1');
  if (mask && (mask.width !== content.width || mask.height !== content.height)) {
    throw new Error('内容蒙版与图层瓦片尺寸不一致');
  }
  if (mask) assertFloat32MaskTile(mask);
  if (opacity === 1 && !mask) return content;
  const data = new Float32Array(content.data.length);
  for (let pixel = 0; pixel < content.width * content.height; pixel += 1) {
    const amount = opacity * (mask?.data[pixel] ?? 1);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      data[offset + channel] = content.data[offset + channel] * amount;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    content.width, content.height, content.colorDomain, data, content.workingSpace,
    content.transferFunction, content.referenceWhiteNits,
  );
}

export function compositePremultipliedTilesV3(
  backdrop: Float32PremultipliedRgbaTile | null,
  source: Float32PremultipliedRgbaTile,
  blendMode: ImageEditBlendModeV3,
  clipping = false,
): Float32PremultipliedRgbaTile {
  if (!backdrop) return source;
  if (
    backdrop.width !== source.width
    || backdrop.height !== source.height
    || backdrop.colorDomain !== source.colorDomain
    || backdrop.workingSpace !== source.workingSpace
    || backdrop.transferFunction !== source.transferFunction
    || backdrop.referenceWhiteNits !== source.referenceWhiteNits
  ) throw new Error('合成瓦片的尺寸或颜色域不一致');
  // 稀疏蒙版之外的内容常是全透明零瓦片，所有支持的混合模式均保留背景。
  if (source.data.every(value => value === 0)) return backdrop;
  const data = new Float32Array(source.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const ba = backdrop.data[offset + 3], sa = source.data[offset + 3];
    data[offset + 3] = clipping ? ba : sa + ba * (1 - sa);
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = compositeChannel(backdrop.data[offset + channel], source.data[offset + channel], ba, sa, blendMode, clipping);
    }
  }
  return createFloat32PremultipliedRgbaTile(
    source.width, source.height, source.colorDomain, data, source.workingSpace,
    source.transferFunction, source.referenceWhiteNits,
  );
}

export function mixEffectLayerV3(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
  blendMode: ImageEditBlendModeV3,
  opacity: number,
): Float32PremultipliedRgbaTile {
  if (
    source.width !== processed.width
    || source.height !== processed.height
    || source.colorDomain !== processed.colorDomain
    || source.workingSpace !== processed.workingSpace
    || source.transferFunction !== processed.transferFunction
    || source.referenceWhiteNits !== processed.referenceWhiteNits
  ) {
    throw new Error('效果结果与输入瓦片契约不一致');
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('效果不透明度必须位于 0～1');
  const data = new Float32Array(source.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    const processedAlpha = processed.data[offset + 3];
    if (alpha === 1 && processedAlpha === 1 && blendMode === 'normal') {
      data[offset + 3] = 1;
      data[offset] = source.data[offset] + (processed.data[offset] - source.data[offset]) * opacity;
      data[offset + 1] = source.data[offset + 1] + (processed.data[offset + 1] - source.data[offset + 1]) * opacity;
      data[offset + 2] = source.data[offset + 2] + (processed.data[offset + 2] - source.data[offset + 2]) * opacity;
      continue;
    }
    data[offset + 3] = source.data[offset + 3] + (processed.data[offset + 3] - source.data[offset + 3]) * opacity;
    for (let channel = 0; channel < 3; channel += 1) {
      const original = alpha > 0 ? source.data[offset + channel] / alpha : 0;
      const adjusted = processedAlpha > 0 ? processed.data[offset + channel] / processedAlpha : 0;
      const blended = blendChannel(original, adjusted, blendMode);
      data[offset + channel] = (original + (blended - original) * opacity) * data[offset + 3];
    }
  }
  return createFloat32PremultipliedRgbaTile(
    source.width, source.height, source.colorDomain, data, source.workingSpace,
    source.transferFunction, source.referenceWhiteNits,
  );
}
