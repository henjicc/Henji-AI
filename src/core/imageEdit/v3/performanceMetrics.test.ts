import { describe, expect, it } from 'vitest';
import {
  imageEditResourceDriftWithinLimitV3,
  summarizeImageEditPerformanceV3,
  summarizeImageEditResourceDriftV3,
} from './performanceMetrics';

describe('图片编辑 V3 性能验收统计', () => {
  it('使用真实 p95 而不是平均值掩盖尾部延迟', () => {
    const samples = Array.from({ length: 100 }, (_, index) => ({
      metric: 'tile', durationMs: index + 1,
    }));
    expect(summarizeImageEditPerformanceV3(samples, 'tile')).toMatchObject({
      count: 100,
      p50Ms: 50,
      p95Ms: 95,
      maxMs: 100,
    });
  });

  it('资源尾部漂移采用 5% 或 20MiB 中较大者', () => {
    expect(imageEditResourceDriftWithinLimitV3(100 * 1024 * 1024, 119 * 1024 * 1024)).toBe(true);
    expect(imageEditResourceDriftWithinLimitV3(100 * 1024 * 1024, 121 * 1024 * 1024)).toBe(false);
    expect(imageEditResourceDriftWithinLimitV3(1_000 * 1024 * 1024, 1_049 * 1024 * 1024)).toBe(true);
  });

  it('持续操作指标同时保留峰值和尾部漂移，不把可释放的峰值误判为泄漏', () => {
    expect(summarizeImageEditResourceDriftV3([
      { operation: 0, totalBytes: 100 * 1024 * 1024 },
      { operation: 1, totalBytes: 140 * 1024 * 1024 },
      { operation: 2, totalBytes: 101 * 1024 * 1024 },
    ])).toMatchObject({
      sampleCount: 3,
      baselineBytes: 100 * 1024 * 1024,
      finalBytes: 101 * 1024 * 1024,
      peakBytes: 140 * 1024 * 1024,
      driftBytes: 1 * 1024 * 1024,
      allowedDriftBytes: 20 * 1024 * 1024,
      withinLimit: true,
    });
  });
});
