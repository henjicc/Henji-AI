import { expect, it } from 'vitest';
import { sampleBilinearPixels, resampleAffinePixels } from '.';
import { createFloat32PremultipliedRgbaTile } from '../../../imageEdit/v3/effects/contracts';
import { applyExposureAdjustment } from '../../../imageEdit/v3/effects/exposure';

it('不透明像素和满覆盖在小数采样后保持 1，随后严格曝光处理仍可用', () => {
  const source = { width: 2, height: 2, data: Float32Array.from({ length: 16 }, (_, i) => i % 4 === 3 ? 1 : i % 4 === 0 ? 2 : -.2) };
  const output = new Float32Array(4);
  sampleBilinearPixels(source, .04, .17, 4, output, 0);
  expect(output[3]).toBe(1); expect(output[0]).toBe(2); expect(output[1]).toBeCloseTo(-.2);
  const tile = createFloat32PremultipliedRgbaTile(1, 1, 'linear-light', output);
  expect(() => applyExposureAdjustment(tile, { stops: .22, offset: .008, gamma: 1.03 })).not.toThrow();
  const coverage = new Float32Array(1);
  sampleBilinearPixels({ width: 2, height: 2, data: Float32Array.of(1, 1, 1, 1) }, .04, .17, 1, coverage, 0);
  expect(coverage[0]).toBe(1);
});
it('透明与夹取边缘采用同一权重，保持 HDR 与半透明预乘像素', () => {
  const source = { width: 2, height: 2, data: Float32Array.from({ length: 16 }, (_, i) => i % 4 === 3 ? .5 : i % 4 === 0 ? 2 : -.2) }, rect = { x: 0, y: 0, width: 2, height: 2 };
  const value = resampleAffinePixels(source, rect, { x: 0, y: 0, width: 1, height: 1 }, [1, 0, 0, 1, -.04, -.17], 4);
  expect(value[3]).toBe(.5); expect(value[0]).toBe(2);
  sampleBilinearPixels(source, -.5, -.5, 4, value, 0, 'clamp'); expect(value[3]).toBe(.5);
  sampleBilinearPixels(source, -.5, -.5, 4, value, 0, 'transparent'); expect(value[3]).toBe(.125);
});
