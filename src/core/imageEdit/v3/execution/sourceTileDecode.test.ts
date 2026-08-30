import { describe, expect, it } from 'vitest';
import { decodeSrgbExtended, encodeTransferFunctionV3 } from './tileColor';
import { decodeInterleavedRgbaSourceTileV3 } from './sourceTileDecode';

describe('V3 源瓦片显式解码边界', () => {
  it('把 8 位 sRGB straight alpha 转为线性 Float32 预乘', () => {
    const result = decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 4,
      bitDepth: 8,
      sampleFormat: 'uint',
      numericRange: 'unorm8',
      byteOrder: 'little-endian',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      pixels: Uint8Array.from([128, 64, 32, 128]),
    });
    const alpha = 128 / 255;
    expect(result.data[0]).toBeCloseTo(decodeSrgbExtended(128 / 255) * alpha, 6);
    expect(result.data[1]).toBeCloseTo(decodeSrgbExtended(64 / 255) * alpha, 6);
    expect(result.data[3]).toBeCloseTo(alpha, 6);
  });

  it('按小端读取 16 位 UNORM，绝不只保留低字节', () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 48_000, true);
    view.setUint16(2, 32_000, true);
    view.setUint16(4, 16_000, true);
    view.setUint16(6, 65_535, true);
    const result = decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 8,
      bitDepth: 16,
      sampleFormat: 'uint',
      numericRange: 'unorm16',
      byteOrder: 'little-endian',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      pixels: bytes,
    });
    expect(result.data[0]).toBeCloseTo(decodeSrgbExtended(48_000 / 65_535), 6);
  });

  it('保留 float scene-linear 的负值与 HDR 头部空间', () => {
    const samples = Float32Array.from([2.5, -0.25, 0.5, 0.4]);
    const result = decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 16,
      bitDepth: 32,
      sampleFormat: 'float',
      numericRange: 'scene-linear',
      byteOrder: 'little-endian',
      transferFunction: 'linear',
      alphaMode: 'straight',
      pixels: samples.buffer,
    });
    expect(result.data[0]).toBeCloseTo(1, 6);
    expect(result.data[1]).toBeCloseTo(-0.1, 6);
    expect(result.data[2]).toBeCloseTo(0.2, 6);
    expect(result.data[3]).toBeCloseTo(0.4, 6);
  });

  it('按 Rec.2020 + PQ 元数据解码 16 位 HDR，不把编码值当 sRGB', () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    const referenceWhiteCode = Math.round(encodeTransferFunctionV3(1, 'pq', 100) * 65_535);
    view.setUint16(0, referenceWhiteCode, true);
    view.setUint16(2, referenceWhiteCode, true);
    view.setUint16(4, referenceWhiteCode, true);
    view.setUint16(6, 65_535, true);
    const result = decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 8,
      bitDepth: 16,
      sampleFormat: 'uint',
      numericRange: 'unorm16',
      byteOrder: 'little-endian',
      colorSpace: 'rec2020',
      transferFunction: 'pq',
      referenceWhiteNits: 100,
      alphaMode: 'straight',
      pixels: bytes,
    });
    expect(result.workingSpace).toBe('rec2020');
    expect(result.transferFunction).toBe('pq');
    expect(result.data[0]).toBeCloseTo(1, 3);
  });

  it('拒绝未声明或不一致的 sample format', () => {
    expect(() => decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 8,
      bitDepth: 16,
      sampleFormat: 'float',
      numericRange: 'scene-linear',
      byteOrder: 'little-endian',
      transferFunction: 'linear',
      alphaMode: 'straight',
      pixels: new Uint8Array(8),
    })).toThrow('unorm16');
    expect(() => decodeInterleavedRgbaSourceTileV3({
      width: 1,
      height: 1,
      rowStride: 8,
      bitDepth: 16,
      sampleFormat: 'uint',
      numericRange: 'unorm16',
      byteOrder: 'little-endian',
      colorSpace: 'display-p3',
      transferFunction: 'pq',
      alphaMode: 'straight',
      pixels: new Uint8Array(8),
    })).toThrow('Rec.2020');
  });
});
