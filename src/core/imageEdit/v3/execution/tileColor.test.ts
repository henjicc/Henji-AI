import { describe, expect, it } from 'vitest';

import { createFloat32PremultipliedRgbaTile } from '../effects';
import {
  convertFloat32TileWorkingSpaceV3,
  decodeTransferFunctionV3,
  encodeTransferFunctionV3,
  toneMapFloat32TileToSdrV3,
} from './tileColor';

describe('图片编辑 V3 专业颜色管线', () => {
  it('以参考白为基准正确往返 PQ 和 HLG', () => {
    const pqCode = encodeTransferFunctionV3(1, 'pq', 100);
    expect(pqCode).toBeCloseTo(0.508078, 5);
    expect(decodeTransferFunctionV3(pqCode, 'pq', 100)).toBeCloseTo(1, 5);

    const hlgCode = encodeTransferFunctionV3(1, 'hlg', 203);
    expect(hlgCode).toBeCloseTo(1, 6);
    expect(decodeTransferFunctionV3(hlgCode, 'hlg', 203)).toBeCloseTo(1, 6);
  });

  it('工作色域转换保留超范围值并可逆，不在中间过程静默裁切', () => {
    const p3 = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([1, 0, 0, 1]),
      'display-p3',
    );
    const srgb = convertFloat32TileWorkingSpaceV3(p3, 'srgb');
    expect(srgb.data[0]).toBeGreaterThan(1);
    expect(srgb.data[1]).toBeLessThan(0);

    const restored = convertFloat32TileWorkingSpaceV3(srgb, 'display-p3');
    expect([...restored.data]).toEqual([
      expect.closeTo(1, 5),
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
      1,
    ]);
  });

  it('HDR 到 SDR 只生成带肩部压缩的显示预览', () => {
    const hdr = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([8, 4, 2, 1]),
      'rec2020',
      'pq',
      203,
    );
    const display = toneMapFloat32TileToSdrV3(hdr);

    expect(display).toMatchObject({
      colorDomain: 'perceptual-working',
      workingSpace: 'srgb',
      transferFunction: 'srgb',
    });
    expect([...display.data.slice(0, 3)].every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(hdr.data[0]).toBe(8);
  });
});
