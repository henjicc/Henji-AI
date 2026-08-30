import { createFloat32PremultipliedRgbaTile, type Float32PremultipliedRgbaTile } from '../effects';
import type { ImageEditTransferFunctionV3, ImageEditWorkingSpaceV3 } from '../colorTypes';
import {
  convertFloat32TileWorkingSpaceV3,
  decodeTransferFunctionV3,
} from './tileColor';

export interface InterleavedRgbaSourceTileV3 {
  width: number;
  height: number;
  rowStride: number;
  bitDepth: 8 | 16 | 32;
  sampleFormat: 'uint' | 'float';
  numericRange: 'unorm8' | 'unorm16' | 'scene-linear';
  byteOrder: 'little-endian';
  colorSpace?: ImageEditWorkingSpaceV3;
  transferFunction: ImageEditTransferFunctionV3;
  referenceWhiteNits?: number;
  alphaMode: 'straight';
  pixels: ArrayBuffer | Uint8Array;
}

function sourceBytes(source: InterleavedRgbaSourceTileV3): Uint8Array {
  return source.pixels instanceof Uint8Array
    ? new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength)
    : new Uint8Array(source.pixels);
}

function bytesPerChannel(bitDepth: InterleavedRgbaSourceTileV3['bitDepth']): number {
  return bitDepth === 8 ? 1 : bitDepth === 16 ? 2 : 4;
}

function assertSourceContract(source: InterleavedRgbaSourceTileV3, bytes: Uint8Array): void {
  if (!Number.isSafeInteger(source.width) || source.width < 1) throw new Error('源瓦片宽度无效');
  if (!Number.isSafeInteger(source.height) || source.height < 1) throw new Error('源瓦片高度无效');
  const packedRow = source.width * 4 * bytesPerChannel(source.bitDepth);
  if (!Number.isSafeInteger(source.rowStride) || source.rowStride < packedRow) {
    throw new Error('源瓦片 rowStride 无效');
  }
  if (bytes.byteLength < source.rowStride * source.height) throw new Error('源瓦片像素缓冲区不完整');
  if (source.bitDepth === 32 && (source.sampleFormat !== 'float' || source.numericRange !== 'scene-linear')) {
    throw new Error('32-bit 源瓦片必须是 scene-linear float');
  }
  if (source.bitDepth === 32 && source.transferFunction !== 'linear') {
    throw new Error('scene-linear float 源瓦片必须声明 linear 传递函数');
  }
  const colorSpace = source.colorSpace ?? 'srgb';
  if ((source.transferFunction === 'pq' || source.transferFunction === 'hlg') && colorSpace !== 'rec2020') {
    throw new Error('PQ/HLG 源瓦片必须声明 Rec.2020 原色');
  }
  if (
    source.referenceWhiteNits !== undefined
    && (!Number.isFinite(source.referenceWhiteNits) || source.referenceWhiteNits <= 0)
  ) throw new Error('源瓦片参考白亮度无效');
  if (source.bitDepth === 16 && (source.sampleFormat !== 'uint' || source.numericRange !== 'unorm16')) {
    throw new Error('16-bit 源瓦片必须是 unorm16');
  }
  if (source.bitDepth === 8 && (source.sampleFormat !== 'uint' || source.numericRange !== 'unorm8')) {
    throw new Error('8-bit 源瓦片必须是 unorm8');
  }
}

function readSample(
  view: DataView,
  byteOffset: number,
  source: InterleavedRgbaSourceTileV3,
): number {
  if (source.bitDepth === 8) return view.getUint8(byteOffset) / 255;
  if (source.bitDepth === 16) return view.getUint16(byteOffset, true) / 65_535;
  return view.getFloat32(byteOffset, true);
}

/** 将明确格式的 straight RGBA 边界转换为效果内核唯一接受的线性 Float32 预乘瓦片。 */
export function decodeInterleavedRgbaSourceTileV3(
  source: InterleavedRgbaSourceTileV3,
  targetWorkingSpace: ImageEditWorkingSpaceV3 = source.colorSpace ?? 'srgb',
): Float32PremultipliedRgbaTile {
  const bytes = sourceBytes(source);
  assertSourceContract(source, bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(source.width * source.height * 4);
  const channelBytes = bytesPerChannel(source.bitDepth);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = y * source.rowStride + x * 4 * channelBytes;
      const targetOffset = (y * source.width + x) * 4;
      const alpha = readSample(view, sourceOffset + 3 * channelBytes, source);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('源瓦片 Alpha 超出 0～1');
      output[targetOffset + 3] = alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        const encoded = readSample(view, sourceOffset + channel * channelBytes, source);
        if (!Number.isFinite(encoded)) throw new Error('源瓦片颜色通道不是有限数');
        const linear = decodeTransferFunctionV3(
          encoded,
          source.transferFunction,
          source.referenceWhiteNits,
        );
        output[targetOffset + channel] = linear * alpha;
      }
    }
  }
  const decoded = createFloat32PremultipliedRgbaTile(
    source.width,
    source.height,
    'linear-light',
    output,
    source.colorSpace ?? 'srgb',
    source.transferFunction,
    source.referenceWhiteNits,
  );
  return convertFloat32TileWorkingSpaceV3(decoded, targetWorkingSpace);
}
