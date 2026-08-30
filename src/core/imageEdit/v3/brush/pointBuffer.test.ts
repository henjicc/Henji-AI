import { describe, expect, it } from 'vitest';

import { ImageEditBrushPointBufferV3 } from './pointBuffer';
import { simplifyImageEditBrushPointsV3 } from './simplify';

describe('ImageEditBrushPointBufferV3', () => {
  it('合并 coalesced points，并用最新点原地替换屏幕空间近邻', () => {
    const buffer = new ImageEditBrushPointBufferV3(1, 2);
    buffer.appendCoalesced([
      { x: 0, y: 0, screenX: 0, screenY: 0 },
      { x: 0.25, y: 0, screenX: 0.25, screenY: 0, pressure: 0.5 },
      { x: 2, y: 0, screenX: 2, screenY: 0 },
    ]);

    expect(buffer.getStats()).toMatchObject({ inputPointCount: 3, retainedPointCount: 2 });
    expect(buffer.toArray()).toEqual([
      { x: 0.25, y: 0, screenX: 0.25, screenY: 0, pressure: 0.5 },
      { x: 2, y: 0, screenX: 2, screenY: 0, pressure: 1 },
    ]);
  });

  it('10k 点使用倍增缓冲，已有点复制总量保持 O(n)', () => {
    const buffer = new ImageEditBrushPointBufferV3(0, 64);
    for (let index = 0; index < 10_000; index += 1) {
      buffer.append({ x: index, y: 10, screenX: index * 2, screenY: 20 });
    }

    const stats = buffer.getStats();
    expect(stats).toMatchObject({ inputPointCount: 10_000, retainedPointCount: 10_000 });
    expect(stats.reallocationCount).toBeLessThanOrEqual(8);
    expect(stats.copiedScalarCount).toBeLessThan(10_000 * 5 * 2);
    expect(simplifyImageEditBrushPointsV3(buffer.toArray())).toHaveLength(2);
  });

  it('Douglas-Peucker 简化会保留直线上的显著压力变化', () => {
    const points = [
      { x: 0, y: 0, screenX: 0, screenY: 0, pressure: 1 },
      { x: 5, y: 0, screenX: 5, screenY: 0, pressure: 0.1 },
      { x: 10, y: 0, screenX: 10, screenY: 0, pressure: 1 },
    ];
    expect(simplifyImageEditBrushPointsV3(points, 1, 0.05)).toEqual(points);
  });
});
