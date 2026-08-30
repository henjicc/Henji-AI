import { describe, expect, it } from 'vitest';
import {
  analyzeVgpuImpulseReadback,
  runVgpuHdrImpulseProbe,
} from './vgpuImpulseProbe';

function rgbaFixture(
  width: number,
  height: number,
  samples: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly rgba: readonly [number, number, number, number];
  }>
): Float32Array {
  const pixels = new Float32Array(width * height * 4);
  for (const sample of samples) {
    pixels.set(sample.rgba, (sample.y * width + sample.x) * 4);
  }
  return pixels;
}

describe('VGPU HDR impulse 读回分析', () => {
  it('按 row-major RGBA 计算 HDR 能量、峰值与质心', () => {
    const pixels = rgbaFixture(5, 5, [
      { x: 2, y: 2, rgba: [8, 4, 2, 1] },
      { x: 3, y: 2, rgba: [2, 0, 0, 0] },
    ]);

    const result = analyzeVgpuImpulseReadback({
      pixels,
      width: 5,
      height: 5,
      expectedCenter: [2, 2],
    });
    const red = result.channels[0];

    expect(red.signedEnergy).toBe(10);
    expect(red.positiveEnergy).toBe(10);
    expect(red.negativeEnergy).toBe(0);
    expect(red.peak).toEqual({ value: 8, x: 2, y: 2 });
    expect(red.centroid?.[0]).toBeCloseTo(2.2, 8);
    expect(red.centroid?.[1]).toBeCloseTo(2, 8);
    expect(red.centroidOffsetPx?.[0]).toBeCloseTo(0.2, 8);
    expect(red.centroidOffsetPx?.[1]).toBeCloseTo(0, 8);
    expect(red.rmsRadiusPx).toBeCloseTo(0.4, 8);
  });

  it('单独报告负瓣与非有限读回，不让它们伪造正能量质心', () => {
    const pixels = rgbaFixture(3, 3, [
      { x: 1, y: 1, rgba: [4, 0, 0, 0] },
      { x: 0, y: 1, rgba: [-1, 0, 0, 0] },
      { x: 2, y: 1, rgba: [Number.NaN, 0, 0, 0] },
    ]);

    const red = analyzeVgpuImpulseReadback({
      pixels,
      width: 3,
      height: 3,
    }).channels[0];

    expect(red.signedEnergy).toBe(3);
    expect(red.positiveEnergy).toBe(4);
    expect(red.negativeEnergy).toBe(1);
    expect(red.nonFiniteSamples).toBe(1);
    expect(red.centroid).toEqual([1, 1]);
    expect(red.rmsRadiusPx).toBe(0);
  });

  it('拒绝尺寸与 RGBA 分量数量不一致的读回', () => {
    expect(() => analyzeVgpuImpulseReadback({
      pixels: new Float32Array(15),
      width: 2,
      height: 2,
    })).toThrow('期望 16，实际 15');
  });
});

// 真实 Dawn/WebGPU 设备依赖主机驱动，只在专项命令显式开启，避免进入日常易波动单测：
// HENJI_VGPU_GLOW_IMPULSE_PROBE=1 npx vitest run src/core/imageEdit/testing/vgpuImpulseProbe.test.ts
if (process.env.HENJI_VGPU_GLOW_IMPULSE_PROBE === '1') {
  describe('VGPU HDR impulse 真实设备专项 probe', () => {
    it('通过 Target.readFloats 保留半浮点 HDR，并保持 impulse 能量与质心', async () => {
      const { init } = await import('vgpu/node');
      const gpu = await init();

      try {
        const result = await runVgpuHdrImpulseProbe(gpu);

        expect(result.format).toBe('rgba16float');
        expect(result.pixels).toHaveLength(65 * 65 * 4);
        for (const [channel, expectedEnergy] of [8, 4, 2, 1].entries()) {
          const metrics = result.analysis.channels[channel];
          expect(metrics.signedEnergy).toBeCloseTo(expectedEnergy, 3);
          expect(metrics.negativeEnergy).toBe(0);
          expect(metrics.nonFiniteSamples).toBe(0);
          expect(metrics.peak.value).toBeCloseTo(expectedEnergy, 3);
          expect(metrics.centroidOffsetPx?.[0]).toBeCloseTo(0, 3);
          expect(metrics.centroidOffsetPx?.[1]).toBeCloseTo(0, 3);
        }
      } finally {
        gpu.dispose();
      }
    }, 30_000);
  });
}
