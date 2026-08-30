import { describe, expect, it } from 'vitest';
import {
  applyExposureAdjustment,
  applyGaussianBlurV2,
  applyLegacyGaussianBlurV1,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  EXPOSURE_ADJUSTMENT_CONTRACT,
  GAUSSIAN_BLUR_V2_CONTRACT,
  LEGACY_GAUSSIAN_BLUR_V1_CONTRACT,
  resolveGaussianBlurV2Geometry,
} from './index';

describe('图片编辑 V3 Float32 效果契约', () => {
  it('曝光在线性光中处理直通颜色并保持预乘 alpha', () => {
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([0.25, 0.125, 0.0625, 0.5]),
    );
    const result = applyExposureAdjustment(source, { stops: 1, offset: 0, gamma: 1 });

    expect([...result.data]).toEqual([0.5, 0.25, 0.125, 0.5]);
    expect(EXPOSURE_ADJUSTMENT_CONTRACT).toMatchObject({
      inputColorDomain: 'linear-light',
      alpha: 'premultiplied',
      precision: 'float32',
    });
  });

  it('蒙版在原结果与处理结果之间混合，0 与 1 具有精确语义', () => {
    const source = createFloat32PremultipliedRgbaTile(
      3,
      1,
      'linear-light',
      new Float32Array([
        0.25, 0.25, 0.25, 1,
        0.25, 0.25, 0.25, 1,
        0.25, 0.25, 0.25, 1,
      ]),
    );
    const mask = createFloat32MaskTile(3, 1, new Float32Array([0, 0.5, 1]));
    const result = applyExposureAdjustment(
      source,
      { stops: 1, offset: 0, gamma: 1 },
      { mask },
    );

    expect(result.data[0]).toBe(0.25);
    expect(result.data[4]).toBe(0.375);
    expect(result.data[8]).toBe(0.5);
    expect([result.data[3], result.data[7], result.data[11]]).toEqual([1, 1, 1]);
  });

  it('不接受 Uint8 中转，也不把 16 位差值或 HDR 头部量化到 8 位', () => {
    const first = 0.5 + 1 / 65_535;
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([first, 1.5, -0.125, 1]),
    );
    const result = applyExposureAdjustment(source, { stops: 0, offset: 0, gamma: 1 });

    expect(result.data).toBeInstanceOf(Float32Array);
    expect(result.data[0]).toBeCloseTo(first, 7);
    expect(result.data[0]).not.toBe(Math.round(first * 255) / 255);
    expect(result.data[1]).toBe(1.5);
    expect(result.data[2]).toBe(-0.125);
    expect(() => createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Uint8Array(4) as unknown as Float32Array,
    )).toThrow('Float32');
  });
});

describe('Gaussian Blur v2 CPU 参考实现', () => {
  it('以文档坐标计算半径、ceil(3r) halo 和大半径金字塔', () => {
    expect(resolveGaussianBlurV2Geometry({
      radius: 160,
      mip: 2,
      pyramidTargetRadius: 16,
    })).toEqual({
      radiusInDocumentPixels: 160,
      radiusAtMip: 40,
      haloInDocumentPixels: 480,
      haloAtMip: 120,
      pyramidLevel: 2,
      radiusAtPyramidLevel: 10,
    });
    expect(GAUSSIAN_BLUR_V2_CONTRACT).toMatchObject({
      version: 2,
      inputColorDomain: 'linear-light',
      alpha: 'premultiplied',
    });
  });

  it('图片边缘使用 clamp，常量预乘瓦片在边缘不变暗', () => {
    const pixel = [0.4, 0.2, 0.1, 0.5];
    const source = createFloat32PremultipliedRgbaTile(
      3,
      2,
      'linear-light',
      new Float32Array([...pixel, ...pixel, ...pixel, ...pixel, ...pixel, ...pixel]),
    );
    const result = applyGaussianBlurV2(source, { radius: 1.25, mip: 0 });

    for (let offset = 0; offset < result.data.length; offset += 4) {
      expect(result.data[offset]).toBeCloseTo(0.4, 6);
      expect(result.data[offset + 1]).toBeCloseTo(0.2, 6);
      expect(result.data[offset + 2]).toBeCloseTo(0.1, 6);
      expect(result.data[offset + 3]).toBeCloseTo(0.5, 6);
    }
  });

  it('模糊预乘 RGBA 四通道，使透明边缘不产生脏色', () => {
    const source = createFloat32PremultipliedRgbaTile(
      5,
      1,
      'linear-light',
      new Float32Array([
        0, 0, 0, 0,
        0, 0, 0, 0,
        1, 0.25, 0, 0.5,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    );
    const result = applyGaussianBlurV2(source, { radius: 1, mip: 0 });

    expect(result.data[3]).toBeGreaterThan(0);
    expect(result.data[0] / result.data[3]).toBeCloseTo(2, 5);
    expect(result.data[1] / result.data[3]).toBeCloseTo(0.5, 5);
    expect(result.data[2]).toBe(0);
  });
});

describe('旧版 Blur v1 像素兼容内核', () => {
  it('保持感知域、预乘 alpha 与旧版 120px 半径封顶契约', () => {
    const source = createFloat32PremultipliedRgbaTile(
      3,
      1,
      'perceptual-working',
      new Float32Array([
        0, 0, 0, 0,
        1, 1, 1, 1,
        0, 0, 0, 0,
      ]),
    );
    const capped = applyLegacyGaussianBlurV1(source, 320);
    const legacyMaximum = applyLegacyGaussianBlurV1(source, 120);

    expect(capped.data).toEqual(legacyMaximum.data);
    expect(capped.data[0]).toBeGreaterThan(0);
    expect(capped.data[4]).toBeLessThan(1);
    expect(LEGACY_GAUSSIAN_BLUR_V1_CONTRACT).toMatchObject({
      version: 1,
      inputColorDomain: 'perceptual-working',
      alpha: 'premultiplied',
    });
  });
});
