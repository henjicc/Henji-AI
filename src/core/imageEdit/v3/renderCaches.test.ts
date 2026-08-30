import { describe, expect, it, vi } from 'vitest';
import { ImageEditRenderCaches } from './renderCaches';
import { ImageEditResourceBudget } from './resourceBudget';

function createCaches() {
  const budget = new ImageEditResourceBudget({
    totalBytes: 1_000,
    cpuCacheTargetBytes: 600,
    gpuTargetBytes: 300,
  });
  return {
    budget,
    caches: new ImageEditRenderCaches<string>({
      budget,
      tierBudgets: {
        'source-proxy': 300,
        'node-tile': 300,
        'global-analysis': 200,
        viewport: 200,
      },
    }),
  };
}

describe('图片编辑 V3 四级缓存', () => {
  it('缓存分配统一进入资源账本，逐出时释放', () => {
    const { budget, caches } = createCaches();
    const dispose = vi.fn();
    expect(caches.set('node-tile', 'a', {
      value: 'A', bytes: 200, category: 'gpu', deviceGeneration: 1, dispose,
    })).toBe(true);
    expect(caches.set('node-tile', 'b', {
      value: 'B', bytes: 200, category: 'gpu', deviceGeneration: 1, dispose,
    })).toBe(true);
    expect(dispose).toHaveBeenCalledWith('A');
    expect(budget.snapshot().totalBytes).toBe(200);
  });

  it('被视口使用的纹理直到 lease 释放才销毁', () => {
    const { budget, caches } = createCaches();
    const dispose = vi.fn();
    caches.set('viewport', 'frame', {
      value: 'texture', bytes: 100, category: 'gpu', deviceGeneration: 2, dispose,
    });
    const lease = caches.lease('viewport', 'frame');
    caches.clearGpuResources();
    expect(dispose).not.toHaveBeenCalled();
    lease?.release();
    expect(dispose).toHaveBeenCalledWith('texture');
    expect(budget.snapshot().totalBytes).toBe(0);
  });

  it('设备丢失只清 GPU 资源，保留可复用的 CPU 代理', () => {
    const { caches } = createCaches();
    caches.set('source-proxy', 'proxy', {
      value: 'cpu-proxy', bytes: 100, category: 'cpu-cache', deviceGeneration: 0,
    });
    caches.set('viewport', 'frame', {
      value: 'gpu-frame', bytes: 100, category: 'gpu', deviceGeneration: 1,
    });
    caches.clearGpuResources();
    const proxyLease = caches.lease('source-proxy', 'proxy');
    expect(proxyLease?.value).toBe('cpu-proxy');
    proxyLease?.release();
    expect(caches.lease('viewport', 'frame')).toBeNull();
  });
});
