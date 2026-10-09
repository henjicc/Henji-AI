import { describe, expect, it } from 'vitest';
import { encodeImageEditRegionSnapshotV3 } from './snapshot';
import { appendImageEditSelectionV3, imageEditSelectionSessionSchemaV3 } from './session';
import { rasterizeImageEditSessionRegionV3 } from './sessionRaster';

describe('稀疏覆盖快照进入独立选区', () => {
  it('不量化软边，跨瓦片逐行编码，保存后原位读回', () => {
    const data = Float32Array.of(.123456789, .50000006, .8, 0);
    const shape = encodeImageEditRegionSnapshotV3({ grid: { width: 3, height: 2 }, tileSize: 2, defaultValue: .25, inverted: false,
      tiles: new Map([['0/0', { x: 0, y: 0, width: 2, height: 2, data }]]) }, [1, 0, 0, 1, 0, 0], { width: 3, height: 2 });
    const selection = imageEditSelectionSessionSchemaV3.parse(JSON.parse(JSON.stringify(appendImageEditSelectionV3(null, shape, 'replace'))));
    expect([...rasterizeImageEditSessionRegionV3(selection, { width: 3, height: 2 }, { x: 0, y: 0, width: 3, height: 2 })]).toEqual([data[0], data[1], .25, data[2], 0, .25]);
    data.fill(1); expect(shape.runs[0][2]).toBe(Math.fround(.123456789));
  });
  it('保留反选缺省值与源到文档的仿射关系', () => {
    const shape = encodeImageEditRegionSnapshotV3({ grid: { width: 2, height: 1 }, tileSize: 2, defaultValue: .25, inverted: true, tiles: new Map() }, [1, 0, 0, 1, 1, 0], { width: 4, height: 1 });
    expect(shape.matrix).toEqual([.5, 0, 0, 1, .25, 0]); expect(shape.runs).toEqual([[0, 2, .75]]);
  });
});
