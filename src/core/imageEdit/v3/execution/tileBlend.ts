import type { ImageEditBlendModeV3 } from '../layerTypes';
import {
  assertFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts';

function blendChannel(backdrop: number, source: number, mode: ImageEditBlendModeV3): number {
  if (mode === 'multiply') return backdrop * source;
  if (mode === 'screen') return backdrop + source - backdrop * source;
  if (mode === 'overlay') {
    return backdrop <= 0.5
      ? 2 * backdrop * source
      : 1 - 2 * (1 - backdrop) * (1 - source);
  }
  if (mode === 'soft-light') {
    if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
    const curve = backdrop <= 0.25
      ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
      : Math.sqrt(Math.max(0, backdrop));
    return backdrop + (2 * source - 1) * (curve - backdrop);
  }
  return source;
}

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
  const data = new Float32Array(content.data.length);
  for (let pixel = 0; pixel < content.width * content.height; pixel += 1) {
    const amount = opacity * (mask?.data[pixel] ?? 1);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      data[offset + channel] = content.data[offset + channel] * amount;
    }
  }
  return createFloat32PremultipliedRgbaTile(content.width, content.height, content.colorDomain, data);
}

export function compositePremultipliedTilesV3(
  backdrop: Float32PremultipliedRgbaTile | null,
  source: Float32PremultipliedRgbaTile,
  blendMode: ImageEditBlendModeV3,
): Float32PremultipliedRgbaTile {
  if (!backdrop) return source;
  if (
    backdrop.width !== source.width
    || backdrop.height !== source.height
    || backdrop.colorDomain !== source.colorDomain
  ) throw new Error('合成瓦片的尺寸或颜色域不一致');
  const data = new Float32Array(source.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const backdropAlpha = backdrop.data[offset + 3];
    const sourceAlpha = source.data[offset + 3];
    const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
    data[offset + 3] = outputAlpha;
    for (let channel = 0; channel < 3; channel += 1) {
      const backdropStraight = backdropAlpha > 0 ? backdrop.data[offset + channel] / backdropAlpha : 0;
      const sourceStraight = sourceAlpha > 0 ? source.data[offset + channel] / sourceAlpha : 0;
      const blended = blendChannel(backdropStraight, sourceStraight, blendMode);
      data[offset + channel] = (1 - sourceAlpha) * backdrop.data[offset + channel]
        + (1 - backdropAlpha) * source.data[offset + channel]
        + backdropAlpha * sourceAlpha * blended;
    }
  }
  return createFloat32PremultipliedRgbaTile(source.width, source.height, source.colorDomain, data);
}

export function mixEffectLayerV3(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
  blendMode: ImageEditBlendModeV3,
  opacity: number,
): Float32PremultipliedRgbaTile {
  if (source.width !== processed.width || source.height !== processed.height) {
    throw new Error('效果结果与输入瓦片尺寸不一致');
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('效果不透明度必须位于 0～1');
  const data = new Float32Array(source.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    data[offset + 3] = source.data[offset + 3] + (processed.data[offset + 3] - source.data[offset + 3]) * opacity;
    for (let channel = 0; channel < 3; channel += 1) {
      const original = alpha > 0 ? source.data[offset + channel] / alpha : 0;
      const processedAlpha = processed.data[offset + 3];
      const adjusted = processedAlpha > 0 ? processed.data[offset + channel] / processedAlpha : 0;
      const blended = blendChannel(original, adjusted, blendMode);
      data[offset + channel] = (original + (blended - original) * opacity) * data[offset + 3];
    }
  }
  return createFloat32PremultipliedRgbaTile(source.width, source.height, source.colorDomain, data);
}
