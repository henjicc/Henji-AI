import type { ImageEditColorDomain } from '../renderNodeDefinition';
import type { ImageEditTransferFunctionV3, ImageEditWorkingSpaceV3 } from '../colorTypes';

export interface Float32PremultipliedRgbaTile {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  readonly storage: 'rgba-float32';
  readonly colorDomain: ImageEditColorDomain;
  /** RGB 原色定义与传递函数域分开保存，避免把 P3/Rec.2020 像素误当作 sRGB。 */
  readonly workingSpace: ImageEditWorkingSpaceV3;
  /** 从线性域进入 perceptual-working 时采用的文档传递函数。 */
  readonly transferFunction: ImageEditTransferFunctionV3;
  /** PQ 绝对亮度与内部 1.0 的换算基准；SDR/HLG 也保留以支持统一显示管线。 */
  readonly referenceWhiteNits: number;
  readonly alpha: 'premultiplied';
}

export interface Float32MaskTile {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  readonly storage: 'mask-float32';
}

export interface CpuReferenceKernelContract {
  readonly id: string;
  readonly version: number;
  readonly inputColorDomain: ImageEditColorDomain;
  readonly outputColorDomain: ImageEditColorDomain;
  readonly alpha: 'premultiplied';
  readonly precision: 'float32';
  readonly maskMix: 'source-to-processed';
}

export interface Float32TileProcessOptions {
  readonly mask?: Float32MaskTile;
}

export type StraightRgbMapper = (
  red: number,
  green: number,
  blue: number,
) => readonly [number, number, number];

export function createFloat32PremultipliedRgbaTile(
  width: number,
  height: number,
  colorDomain: ImageEditColorDomain,
  data: Float32Array,
  workingSpace: ImageEditWorkingSpaceV3 = 'srgb',
  transferFunction: ImageEditTransferFunctionV3 = 'srgb',
  referenceWhiteNits = 203,
): Float32PremultipliedRgbaTile {
  const tile: Float32PremultipliedRgbaTile = {
    width,
    height,
    data,
    storage: 'rgba-float32',
    colorDomain,
    workingSpace,
    transferFunction,
    referenceWhiteNits,
    alpha: 'premultiplied',
  };
  assertFloat32PremultipliedRgbaTile(tile);
  return tile;
}

export function createFloat32MaskTile(
  width: number,
  height: number,
  data: Float32Array,
): Float32MaskTile {
  const mask: Float32MaskTile = { width, height, data, storage: 'mask-float32' };
  assertFloat32MaskTile(mask);
  return mask;
}

export function assertFloat32PremultipliedRgbaTile(
  tile: Float32PremultipliedRgbaTile,
  expectedColorDomain?: ImageEditColorDomain,
): void {
  assertDimensions(tile.width, tile.height);
  if (!(tile.data instanceof Float32Array)) {
    throw new Error('CPU 参考内核只接受 Float32 RGBA 瓦片');
  }
  if (tile.data.length !== tile.width * tile.height * 4) {
    throw new Error('Float32 RGBA 瓦片尺寸与数据长度不一致');
  }
  if (tile.storage !== 'rgba-float32' || tile.alpha !== 'premultiplied') {
    throw new Error('CPU 参考内核要求预乘 Alpha 的 Float32 RGBA');
  }
  if (tile.workingSpace !== 'srgb' && tile.workingSpace !== 'display-p3' && tile.workingSpace !== 'rec2020') {
    throw new Error(`不支持的瓦片工作色域：${String(tile.workingSpace)}`);
  }
  if (!['srgb', 'linear', 'pq', 'hlg'].includes(tile.transferFunction)) {
    throw new Error(`不支持的瓦片传递函数：${String(tile.transferFunction)}`);
  }
  if (!Number.isFinite(tile.referenceWhiteNits) || tile.referenceWhiteNits <= 0) {
    throw new Error('瓦片参考白亮度必须为正有限数');
  }
  if (expectedColorDomain !== undefined && tile.colorDomain !== expectedColorDomain) {
    throw new Error(`颜色域不匹配：需要 ${expectedColorDomain}，实际为 ${tile.colorDomain}`);
  }
}

export function assertFloat32MaskTile(mask: Float32MaskTile): void {
  assertDimensions(mask.width, mask.height);
  if (!(mask.data instanceof Float32Array) || mask.storage !== 'mask-float32') {
    throw new Error('效果蒙版必须使用 Float32 单通道瓦片');
  }
  if (mask.data.length !== mask.width * mask.height) {
    throw new Error('Float32 蒙版尺寸与数据长度不一致');
  }
  for (const value of mask.data) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('效果蒙版值必须位于 0～1');
    }
  }
}

export function cloneFloat32Tile(
  tile: Float32PremultipliedRgbaTile,
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile);
  return createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    tile.colorDomain,
    new Float32Array(tile.data),
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  );
}

export function mapStraightRgbPreservingAlpha(
  tile: Float32PremultipliedRgbaTile,
  expectedColorDomain: ImageEditColorDomain,
  mapper: StraightRgbMapper,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile, expectedColorDomain);
  const processed = new Float32Array(tile.data.length);
  for (let offset = 0; offset < tile.data.length; offset += 4) {
    const alpha = tile.data[offset + 3];
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('Alpha 必须是 0～1 的有限浮点数');
    }
    if (alpha === 0) {
      processed[offset] = 0;
      processed[offset + 1] = 0;
      processed[offset + 2] = 0;
      processed[offset + 3] = 0;
      continue;
    }
    const mapped = mapper(
      tile.data[offset] / alpha,
      tile.data[offset + 1] / alpha,
      tile.data[offset + 2] / alpha,
    );
    processed[offset] = finite(mapped[0], '红色通道') * alpha;
    processed[offset + 1] = finite(mapped[1], '绿色通道') * alpha;
    processed[offset + 2] = finite(mapped[2], '蓝色通道') * alpha;
    processed[offset + 3] = alpha;
  }
  const result = createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    tile.colorDomain,
    processed,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  );
  return mixProcessedWithMask(tile, result, options.mask);
}

/** 蒙版 0 返回原结果，1 返回处理结果；四通道一起混合以保持预乘 Alpha。 */
export function mixProcessedWithMask(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
  mask?: Float32MaskTile,
): Float32PremultipliedRgbaTile {
  assertCompatibleTiles(source, processed);
  if (mask === undefined) return processed;
  assertFloat32MaskTile(mask);
  if (mask.width !== source.width || mask.height !== source.height) {
    throw new Error('效果蒙版与输入瓦片尺寸不一致');
  }
  const data = new Float32Array(source.data.length);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    const amount = mask.data[pixel];
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const original = source.data[offset + channel];
      data[offset + channel] = original
        + (processed.data[offset + channel] - original) * amount;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    source.width,
    source.height,
    source.colorDomain,
    data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  );
}

function assertCompatibleTiles(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
): void {
  assertFloat32PremultipliedRgbaTile(source);
  assertFloat32PremultipliedRgbaTile(processed);
  if (
    source.width !== processed.width
    || source.height !== processed.height
    || source.colorDomain !== processed.colorDomain
    || source.workingSpace !== processed.workingSpace
    || source.transferFunction !== processed.transferFunction
    || source.referenceWhiteNits !== processed.referenceWhiteNits
  ) throw new Error('原始与处理后瓦片契约不一致');
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('瓦片宽高必须是正整数');
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label}计算结果不是有限数`);
  return value;
}
