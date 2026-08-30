import { describe, expect, it, vi } from 'vitest';
import { LeasedLruCache } from './leasedLruCache';

describe('带 lease 的图片编辑缓存', () => {
  it('按 LRU 逐出未租用项', () => {
    const disposed = vi.fn();
    const cache = new LeasedLruCache<string>({ maxBytes: 10, dispose: disposed });
    cache.set('a', 'A', 6);
    cache.set('b', 'B', 6);
    expect(cache.lease('a')).toBeNull();
    expect(cache.lease('b')?.value).toBe('B');
    expect(disposed).toHaveBeenCalledWith('A');
  });

  it('删除仍在使用的纹理时延迟到最后一个 lease 释放', () => {
    const disposed = vi.fn();
    const cache = new LeasedLruCache<string>({ maxBytes: 20, dispose: disposed });
    cache.set('texture', 'gpu-texture', 10);
    const lease = cache.lease('texture');
    cache.delete('texture');
    expect(disposed).not.toHaveBeenCalled();
    expect(cache.lease('texture')).toBeNull();
    lease?.release();
    expect(disposed).toHaveBeenCalledWith('gpu-texture');
    expect(cache.snapshot().usedBytes).toBe(0);
  });

  it('不覆盖仍被租用的同键值，旧资源在释放时正常销毁', () => {
    const disposed = vi.fn();
    const cache = new LeasedLruCache<string>({ maxBytes: 20, dispose: disposed });
    expect(cache.set('tile', 'old', 8)).toBe(true);
    const lease = cache.lease('tile');

    expect(cache.set('tile', 'new', 8)).toBe(false);
    expect(cache.lease('tile')).toBeNull();
    expect(cache.snapshot()).toMatchObject({ usedBytes: 8, entryCount: 1, leasedCount: 1 });

    lease?.release();
    expect(disposed).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledWith('old');
    expect(cache.snapshot()).toMatchObject({ usedBytes: 0, entryCount: 0 });
  });
});
