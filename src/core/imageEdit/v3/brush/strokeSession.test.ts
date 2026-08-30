import { describe, expect, it } from 'vitest';

import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '../effects/contracts';
import type { ImageEditTileCoordinate } from '../tileGeometry';
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTileLoaderV3,
} from './contracts';
import { IMAGE_EDIT_BRUSH_TILE_SIZE_V3 } from './contracts';
import {
  ImageEditBrushStrokeSessionV3,
  imageEditBrushTileKeyV3,
} from './strokeSession';
import { materializeImageEditBrushTileDeltaV3 } from './tileDelta';

function tileSize(
  canvas: { width: number; height: number },
  coordinate: ImageEditTileCoordinate,
): { width: number; height: number } {
  return {
    width: Math.min(IMAGE_EDIT_BRUSH_TILE_SIZE_V3, canvas.width - coordinate.x * 512),
    height: Math.min(IMAGE_EDIT_BRUSH_TILE_SIZE_V3, canvas.height - coordinate.y * 512),
  };
}

function rgbaLoader(
  canvas: { width: number; height: number },
  calls: string[],
  fill: readonly [number, number, number, number] = [0, 0, 0, 0],
  resource: ImageEditBrushResourceReferenceV3 | null = null,
): ImageEditBrushTileLoaderV3 {
  return async (coordinate) => {
    calls.push(imageEditBrushTileKeyV3(coordinate));
    const size = tileSize(canvas, coordinate);
    const data = new Float32Array(size.width * size.height * 4);
    for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset);
    return {
      tile: createFloat32PremultipliedRgbaTile(
        size.width,
        size.height,
        'linear-light',
        data,
        'srgb',
        'srgb',
        203,
      ),
      resource,
    };
  };
}

function maskLoader(
  canvas: { width: number; height: number },
  calls: string[],
  fill: number,
): ImageEditBrushTileLoaderV3 {
  return async (coordinate) => {
    calls.push(imageEditBrushTileKeyV3(coordinate));
    const size = tileSize(canvas, coordinate);
    const data = new Float32Array(size.width * size.height);
    data.fill(fill);
    return { tile: createFloat32MaskTile(size.width, size.height, data), resource: null };
  };
}

const rasterTarget = {
  kind: 'raster-rgba' as const,
  colorDomain: 'linear-light' as const,
  workingSpace: 'srgb' as const,
  transferFunction: 'srgb' as const,
  referenceWhiteNits: 203,
  premultipliedColor: [1, 0, 0, 1] as const,
};

describe('ImageEditBrushStrokeSessionV3', () => {
  const oldResourceId = `sha256:${'a'.repeat(64)}`;
  const newResourceId = `sha256:${'b'.repeat(64)}`;
  it('跨越 512 边界时只读取并修改相邻两块 RGBA 瓦片', async () => {
    const canvas = { width: 1024, height: 32 };
    const calls: string[] = [];
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 6, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, calls),
    });
    session.appendCoalescedPoints([
      { x: 509, y: 16, screenX: 509, screenY: 16 },
      { x: 515, y: 16, screenX: 515, screenY: 16 },
    ]);

    const result = await session.finish();
    expect(calls).toEqual(['0/0/0', '0/1/0']);
    expect(result?.changes.map((change) => change.tileKey)).toEqual(['0/0/0', '0/1/0']);
    expect(result?.metrics).toMatchObject({ loadedTileCount: 2, changedTileCount: 2 });
    for (const change of result?.changes ?? []) {
      expect(change.tile.storage).toBe('rgba-float32');
      if (change.tile.storage !== 'rgba-float32') throw new Error('测试预期 RGBA 瓦片');
      expect(change.tile.alpha).toBe('premultiplied');
      expect(change.tile.data.some((value) => value > 0)).toBe(true);
    }
  });

  it('正确处理画布右下角的 1×1 边缘瓦片', async () => {
    const canvas = { width: 513, height: 513 };
    const calls: string[] = [];
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 1, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, calls),
    });
    session.appendPoint({ x: 512.5, y: 512.5, screenX: 1, screenY: 1 });

    const result = await session.finish();
    expect(calls).toEqual(['0/1/1']);
    expect(result?.changes[0].tile).toMatchObject({ width: 1, height: 1 });
    expect([...result!.changes[0].tile.data]).toEqual([1, 0, 0, 1]);
  });

  it('mask brush 与 eraser 使用 Float32 单通道并遵守硬度/不透明度', async () => {
    const canvas = { width: 32, height: 32 };
    const paint = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 10, hardness: 0, opacity: 0.5 },
      target: { kind: 'mask', brushValue: 1 },
      loadTile: maskLoader(canvas, [], 0),
    });
    paint.appendPoint({ x: 16, y: 16, screenX: 16, screenY: 16 });
    const painted = await paint.finish();
    const paintedTile = painted!.changes[0].tile;
    expect(paintedTile.storage).toBe('mask-float32');
    const center = paintedTile.data[15 * 32 + 15];
    expect(center).toBeGreaterThan(0);
    expect(center).toBeLessThanOrEqual(0.5);
    expect(paintedTile.data[0]).toBe(0);

    const erase = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'eraser',
      shape: { size: 10, hardness: 1, opacity: 1 },
      target: { kind: 'mask' },
      loadTile: maskLoader(canvas, [], 1),
    });
    erase.appendPoint({ x: 16, y: 16, screenX: 16, screenY: 16 });
    const erased = await erase.finish();
    expect(erased!.changes[0].tile.data[15 * 32 + 15]).toBe(0);
  });

  it('RGBA eraser 同步衰减预乘颜色和 Alpha', async () => {
    const canvas = { width: 16, height: 16 };
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'eraser',
      shape: { size: 8, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, [], [0.2, 0.4, 0.6, 1]),
    });
    session.appendPoint({ x: 8, y: 8, screenX: 8, screenY: 8 });
    const result = await session.finish();
    const tile = result!.changes[0].tile;
    const offset = (7 * 16 + 7) * 4;
    expect([...tile.data.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
  });

  it('保留工作色域契约与线性负值，不把宽色域中间结果裁黑', async () => {
    const canvas = { width: 8, height: 8 };
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 2, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, [], [-0.1, 0.2, 0.3, 1]),
    });
    session.appendPoint({ x: 4, y: 4, screenX: 4, screenY: 4 });
    const result = await session.finish();

    expect(result?.target).toMatchObject({
      workingSpace: 'srgb', transferFunction: 'srgb', referenceWhiteNits: 203,
    });
    expect(result?.changes[0].tile.data[0]).toBeCloseTo(-0.1, 6);
  });

  it('取消进行中的异步瓦片读取后不产出 delta', async () => {
    const canvas = { width: 32, height: 32 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loader: ImageEditBrushTileLoaderV3 = async (coordinate) => {
      await gate;
      return rgbaLoader(canvas, [])(coordinate, new AbortController().signal);
    };
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 4, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: loader,
    });
    session.appendPoint({ x: 8, y: 8, screenX: 8, screenY: 8 });
    const finishing = session.finish();
    session.cancel();
    release?.();
    await expect(finishing).resolves.toBeNull();
  });

  it('10k 输入点不发生 O(n²) 复制，简化后只读取一块 dirty tile', async () => {
    const canvas = { width: 2048, height: 64 };
    const calls: string[] = [];
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 2, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, calls),
      minScreenDistance: 0,
      simplifyScreenTolerance: 0.1,
    });
    for (let index = 0; index < 10_000; index += 1) {
      const x = 10 + (490 * index) / 9_999;
      session.appendPoint({ x, y: 20, screenX: x, screenY: 20 });
    }
    const result = await session.finish();

    expect(calls).toEqual(['0/0/0']);
    expect(result?.metrics).toMatchObject({
      inputPointCount: 10_000,
      retainedPointCount: 10_000,
      simplifiedPointCount: 2,
      loadedTileCount: 1,
      changedTileCount: 1,
    });
    expect(result!.metrics.copiedScalarCount).toBeLessThan(10_000 * 5 * 2);
  });

  it('持久化后生成单条 tile-delta，并同时报告旧/新历史资源', async () => {
    const canvas = { width: 32, height: 32 };
    const oldResource = { resourceId: oldResourceId, byteSize: 100 };
    const session = new ImageEditBrushStrokeSessionV3({
      canvas,
      tool: 'brush',
      shape: { size: 4, hardness: 1, opacity: 1 },
      target: rasterTarget,
      loadTile: rgbaLoader(canvas, [], [0, 0, 0, 0], oldResource),
    });
    session.appendPoint({ x: 8, y: 8, screenX: 8, screenY: 8 });
    const stroke = await session.finish();
    expect(stroke?.history).toMatchObject({
      oldResources: [oldResource],
      oldResourceBytes: 100,
      pendingNewRawBytes: 32 * 32 * 4 * 4,
    });

    const materialized = materializeImageEditBrushTileDeltaV3(stroke!, {
      commandId: 'stroke-1',
      expectedRevision: 0,
      layerId: 'raster-layer',
      persistedTiles: [{ tileKey: '0/0/0', resourceId: newResourceId, byteSize: 80 }],
    });
    expect(materialized.command).toMatchObject({
      type: 'raster.apply-tile-delta',
      changes: [{ tileKey: '0/0/0', resourceId: newResourceId, byteSize: 80 }],
    });
    expect(materialized.history).toMatchObject({
      oldResources: [oldResource],
      newResources: [{ resourceId: newResourceId, byteSize: 80 }],
      oldResourceBytes: 100,
      newResourceBytes: 80,
      retainedResourceBytes: 180,
    });
  });
});
