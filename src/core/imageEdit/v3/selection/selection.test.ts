import { describe, expect, it, vi } from 'vitest';
import { createFloat32MaskTile, type Float32MaskTile } from '../effects/contracts';
import {
  imageEditSelectionPixelCoverageV3,
  materializeImageEditSelectionMaskDeltaV3,
  planImageEditSelectionMaskV3,
  rasterizeImageEditSelectionMaskTilesV3,
  type ImageEditSelectionCombineModeV3,
  type ImageEditSelectionMaskTileChangeV3,
  type ImageEditSelectionShapeV3,
} from '.';

const oldResource = { resourceId: `sha256:${'a'.repeat(64)}`, byteSize: 128 };
const newResource = { resourceId: `sha256:${'b'.repeat(64)}`, byteSize: 96 };

async function collect(
  canvas: { width: number; height: number },
  shape: ImageEditSelectionShapeV3,
  combineMode: ImageEditSelectionCombineModeV3,
  existingTile?: Float32MaskTile,
): Promise<ImageEditSelectionMaskTileChangeV3[]> {
  const plan = planImageEditSelectionMaskV3({
    canvas,
    shape,
    combineMode,
    existingTiles: existingTile ? [{ tileKey: '0/0/0', resource: oldResource }] : [],
  });
  const changes: ImageEditSelectionMaskTileChangeV3[] = [];
  for await (const change of rasterizeImageEditSelectionMaskTilesV3({
    plan,
    loadExistingTile: async () => {
      if (!existingTile) throw new Error('不应读取不存在的瓦片');
      return existingTile;
    },
  })) changes.push(change);
  return changes;
}

describe('图片编辑 V3 选择转稀疏蒙版', () => {
  it('矩形跨越 512 边界时只生成两个局部瓦片，并使用精确面积覆盖', async () => {
    const changes = await collect(
      { width: 1024, height: 4 },
      { type: 'rectangle', x: 511.5, y: 1, width: 1, height: 1 },
      'replace',
    );

    expect(changes.map((change) => change.tileKey)).toEqual(['0/0/0', '0/1/0']);
    expect(changes[0].newTile?.width).toBe(512);
    expect(changes[1].newTile?.width).toBe(512);
    expect(changes[0].newTile?.data[1 * 512 + 511]).toBe(0.5);
    expect(changes[1].newTile?.data[1 * 512]).toBe(0.5);
    expect(changes.every((change) => change.newTile!.data.length === 512 * 4)).toBe(true);
  });

  it('椭圆固定 4×4 子像素采样产生对称且确定的抗锯齿边缘', () => {
    const shape = { type: 'ellipse', x: 0, y: 0, width: 3, height: 3 } as const;
    const first = imageEditSelectionPixelCoverageV3(shape, 0, 0);
    const mirrored = imageEditSelectionPixelCoverageV3(shape, 2, 0);
    const center = imageEditSelectionPixelCoverageV3(shape, 1, 1);

    expect(first).toBe(mirrored);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    expect(center).toBe(1);
    expect(imageEditSelectionPixelCoverageV3(shape, 0, 0)).toBe(first);
  });

  it('自由套索采用偶奇规则闭合，并把图形裁到文档边界', async () => {
    const changes = await collect(
      { width: 4, height: 4 },
      {
        type: 'lasso',
        points: [{ x: -2, y: -2 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
      },
      'replace',
    );

    expect(changes).toHaveLength(1);
    const data = changes[0].newTile!.data;
    expect(data[0]).toBe(1);
    expect(data[3 * 4 + 3]).toBe(0);
    expect([...data].some((value) => value > 0 && value < 1)).toBe(true);
  });

  it.each([
    ['replace', [1, 0]],
    ['add', [1, 0.75]],
    ['subtract', [0, 0.75]],
    ['intersect', [0.25, 0]],
  ] as const)('%s 组合保持蒙版值在 0～1', async (combineMode, expected) => {
    const existing = createFloat32MaskTile(2, 1, new Float32Array([0.25, 0.75]));
    const changes = await collect(
      { width: 2, height: 1 },
      { type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      combineMode,
      existing,
    );

    expect(changes).toHaveLength(1);
    expect([...changes[0].newTile!.data]).toEqual(expected);
    expect([...changes[0].newTile!.data].every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('空 replace 选区删除已有稀疏瓦片，不生成零值资源', async () => {
    const existing = createFloat32MaskTile(2, 1, new Float32Array([1, 0.5]));
    const changes = await collect(
      { width: 2, height: 1 },
      { type: 'rectangle', x: 1, y: 1, width: 0, height: 0 },
      'replace',
      existing,
    );

    expect(changes).toEqual([expect.objectContaining({
      tileKey: '0/0/0',
      oldResource,
      newTile: null,
      newRawByteSize: 0,
    })]);
  });

  it.each(['replace', 'intersect'] as const)(
    '%s 会直接删除选区边界外旧瓦片且不读取像素',
    async (combineMode) => {
      const loader = vi.fn();
      const plan = planImageEditSelectionMaskV3({
        canvas: { width: 1024, height: 8 },
        shape: { type: 'rectangle', x: 0, y: 0, width: 8, height: 8 },
        combineMode,
        existingTiles: [{ tileKey: '0/1/0', resource: oldResource }],
      });
      const changes: ImageEditSelectionMaskTileChangeV3[] = [];
      for await (const change of rasterizeImageEditSelectionMaskTilesV3({
        plan,
        loadExistingTile: loader,
      })) changes.push(change);

      expect(loader).not.toHaveBeenCalled();
      expect(changes).toContainEqual(expect.objectContaining({
        tileKey: '0/1/0',
        oldResource,
        newTile: null,
      }));
      if (combineMode === 'replace') {
        expect(changes).toContainEqual(expect.objectContaining({ tileKey: '0/0/0' }));
      }
    },
  );

  it('极端长宽比只规划末端一个瓦片，不枚举整幅图片像素', async () => {
    const loader = vi.fn();
    const plan = planImageEditSelectionMaskV3({
      canvas: { width: 1_000_000, height: 1 },
      shape: { type: 'rectangle', x: 999_999, y: 0, width: 1, height: 1 },
      combineMode: 'add',
    });
    const changes: ImageEditSelectionMaskTileChangeV3[] = [];
    for await (const change of rasterizeImageEditSelectionMaskTilesV3({
      plan,
      loadExistingTile: loader,
    })) changes.push(change);

    expect(plan.tileCoordinates).toEqual([{ mip: 0, x: 1953, y: 0 }]);
    expect(changes).toHaveLength(1);
    expect(changes[0].newTile?.width).toBe(64);
    expect(changes[0].newTile?.data.length).toBe(64);
    expect(loader).not.toHaveBeenCalled();
  });

  it('相同输入逐位确定，且流式迭代期间最多暴露单个瓦片', async () => {
    const run = async (): Promise<Float32Array[]> => {
      const plan = planImageEditSelectionMaskV3({
        canvas: { width: 1024, height: 512 },
        shape: { type: 'ellipse', x: 500, y: 100, width: 40, height: 40 },
        combineMode: 'replace',
      });
      const tiles: Float32Array[] = [];
      for await (const change of rasterizeImageEditSelectionMaskTilesV3({
        plan,
        loadExistingTile: async () => { throw new Error('不应读取空蒙版'); },
      })) tiles.push(new Float32Array(change.newTile!.data));
      return tiles;
    };
    const first = await run();
    const second = await run();

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    first.forEach((tile, index) => expect([...tile]).toEqual([...second[index]]));
    expect(first.every((tile) => tile.length === 512 * 512)).toBe(true);
  });

  it('拒绝 NaN、过少/过多套索点和瓦片炸弹', () => {
    expect(() => planImageEditSelectionMaskV3({
      canvas: { width: 10, height: 10 },
      shape: { type: 'rectangle', x: Number.NaN, y: 0, width: 1, height: 1 },
      combineMode: 'replace',
    })).toThrow('有限数');
    expect(() => planImageEditSelectionMaskV3({
      canvas: { width: 10, height: 10 },
      shape: { type: 'lasso', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      combineMode: 'replace',
    })).toThrow('至少需要 3 个点');
    expect(() => planImageEditSelectionMaskV3({
      canvas: { width: 10, height: 10 },
      shape: {
        type: 'lasso',
        points: Array.from({ length: 8_193 }, (_, index) => ({ x: index % 10, y: index % 9 })),
      },
      combineMode: 'replace',
    })).toThrow('顶点数量超出上限');
    expect(() => planImageEditSelectionMaskV3({
      canvas: { width: 1_000_000, height: 2_048 },
      shape: { type: 'rectangle', x: 0, y: 0, width: 1_000_000, height: 2_048 },
      combineMode: 'replace',
    })).toThrow('安全上限');
    expect(() => planImageEditSelectionMaskV3({
      canvas: { width: 10, height: 10 },
      shape: { type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      combineMode: 'replace',
      existingTiles: [{
        tileKey: '0/0/0',
        resource: { resourceId: oldResource.resourceId, byteSize: 0 },
      }],
    })).toThrow('资源无效');
  });

  it('持久化后可直接生成 mask.apply-tile-delta 的替换与删除 payload', () => {
    expect(materializeImageEditSelectionMaskDeltaV3({
      commandId: 'selection-1',
      expectedRevision: 7,
      layerId: 'layer-1',
      maskId: 'mask-1',
      changes: [
        { tileKey: '0/0/0', oldResource, newResource },
        { tileKey: '0/1/0', oldResource: newResource, newResource: null },
      ],
    })).toEqual({
      type: 'mask.apply-tile-delta',
      commandId: 'selection-1',
      expectedRevision: 7,
      layerId: 'layer-1',
      maskId: 'mask-1',
      changes: [
        {
          tileKey: '0/0/0',
          previousResourceId: oldResource.resourceId,
          previousByteSize: 128,
          resourceId: newResource.resourceId,
          byteSize: 96,
        },
        {
          tileKey: '0/1/0',
          previousResourceId: newResource.resourceId,
          previousByteSize: 96,
          resourceId: null,
          byteSize: 0,
        },
      ],
    });
  });

  it('取消后在下一个瓦片/行边界停止', async () => {
    const controller = new AbortController();
    const plan = planImageEditSelectionMaskV3({
      canvas: { width: 2, height: 1 },
      shape: { type: 'rectangle', x: 0, y: 0, width: 2, height: 1 },
      combineMode: 'replace',
    });
    controller.abort();
    const iterator = rasterizeImageEditSelectionMaskTilesV3({
      plan,
      loadExistingTile: async () => { throw new Error('不应读取'); },
      signal: controller.signal,
    });
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
