import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ImageEditResourceBudget,
  imageEditMemoryScale,
  setImageEditSystemMemoryBytes,
} from './resourceBudget';

describe('图片编辑 V3 资源账本', () => {
  it('超过总账只报告压力，申请照样分配', () => {
    const budget = new ImageEditResourceBudget({
      totalBytes: 1_000,
      cpuCacheTargetBytes: 400,
      gpuTargetBytes: 300,
    });
    const first = budget.acquire('gpu', 700);
    expect(budget.admission('transfer', 301)).toMatchObject({
      pressure: 'hard',
      recommendation: 'lower-mip',
    });
    const second = budget.acquire('transfer', 301);
    expect(budget.snapshot().totalBytes).toBe(1_001);
    first.release();
    second.release();
    expect(budget.snapshot().totalBytes).toBe(0);
  });

  it('软目标只给出逐出或降并发建议', () => {
    const budget = new ImageEditResourceBudget({
      totalBytes: 2_000,
      cpuCacheTargetBytes: 400,
      gpuTargetBytes: 300,
    });
    expect(budget.admission('cpu-cache', 401)).toMatchObject({
      pressure: 'soft',
      recommendation: 'evict-cache',
    });
  });

  it('lease 幂等释放并记录设备代际', () => {
    const budget = new ImageEditResourceBudget({
      totalBytes: 1_000,
      cpuCacheTargetBytes: 400,
      gpuTargetBytes: 300,
    });
    const lease = budget.acquire('in-flight', 200);
    expect(lease.deviceGeneration).toBe(0);
    budget.advanceDeviceGeneration();
    lease.release();
    lease.release();
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0, deviceGeneration: 1 });
  });

  it('随机租约序列始终不为负且最终归零', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 100 }),
      fc.shuffledSubarray(Array.from({ length: 100 }, (_, index) => index)),
      (byteSizes, releaseOrder) => {
        const budget = new ImageEditResourceBudget({
          totalBytes: 100_000,
          cpuCacheTargetBytes: 40_000,
          gpuTargetBytes: 30_000,
        });
        const leases = byteSizes.map((bytes) => budget.acquire('in-flight', bytes));
        for (const index of releaseOrder) {
          leases[index]?.release();
          leases[index]?.release();
          const snapshot = budget.snapshot();
          expect(snapshot.totalBytes).toBeGreaterThanOrEqual(0);
          expect(Object.values(snapshot.byCategory).every((bytes) => bytes >= 0)).toBe(true);
        }
        for (const lease of leases) lease.release();
        expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 });
      },
    ), { numRuns: 200 });
  });

  it('按真实物理内存取倍数，已建账本的默认目标随之更新', () => {
    const previous = imageEditMemoryScale();
    const budget = new ImageEditResourceBudget();
    try {
      setImageEditSystemMemoryBytes(64 * 1024 ** 3);
      expect(imageEditMemoryScale()).toBe(4);
      expect(budget.limits().totalBytes).toBe(4 * 1_342_177_280);
      setImageEditSystemMemoryBytes(512 * 1024 ** 3);
      expect(imageEditMemoryScale()).toBe(8);
    } finally {
      setImageEditSystemMemoryBytes(previous * 16 * 1024 ** 3);
    }
  });
});
