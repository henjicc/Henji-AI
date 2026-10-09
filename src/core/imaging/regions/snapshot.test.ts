import { describe, expect, it } from 'vitest';
import { createRegionSnapshot, createSnapshotRegionSource, readRegionSource, staticRegionContext } from './index';

describe('稀疏区域快照', () => {
  it('反相默认 1、半透明瓦片、画外零覆盖，快照与读源完全独立', async () => {
    const grid = { width: 4, height: 2 };
    const tile = { x: 0, y: 0, width: 2, height: 2, data: new Float32Array([0.1, 0.4, 0.5, 0.75]) };
    const tiles = new Map([['0/0', tile]]);
    const snapshot = createRegionSnapshot({ grid, tileSize: 2, defaultValue: 0, inverted: true, tiles });
    const source = createSnapshotRegionSource(snapshot);
    tile.data.fill(1); tiles.clear(); grid.width = 10;
    snapshot.tiles.get('0/0')!.data.fill(0);
    const context = staticRegionContext({ width: 4, height: 2 }, 'v1');
    const result = await readRegionSource(source, { x: -1, y: 0, width: 6, height: 1 }, context);
    expect([...result.data]).toEqual([0, expect.closeTo(0.9, 6), expect.closeTo(0.6, 6), 1, 1, 0]);
    result.data.fill(0);
    expect((await readRegionSource(source, { x: 2, y: 0, width: 1, height: 1 }, context)).data[0]).toBe(1);
  });
  it('拒绝错网格、坏覆盖及不完整瓦片', () => {
    expect(() => createRegionSnapshot({ grid: { width: 2, height: 2 }, tileSize: 2, defaultValue: 0, inverted: false,
      tiles: new Map([['0/0', { x: 0, y: 0, width: 2, height: 2, data: new Float32Array([1, 0, Number.NaN, 0]) }]]) })).toThrow('有限值');
  });
});
