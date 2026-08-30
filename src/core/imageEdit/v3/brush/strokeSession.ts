import {
  assertFloat32MaskTile,
  assertFloat32PremultipliedRgbaTile,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '../effects/contracts';
import {
  createTileRegion,
  enumerateTilesForRect,
  type ImageEditTileCoordinate,
} from '../tileGeometry';
import type {
  BufferedImageEditBrushPointV3,
  ImageEditBrushPointBufferStatsV3,
  ImageEditBrushPointV3,
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushStrokeOptionsV3,
  ImageEditBrushStrokeResultV3,
  ImageEditBrushTargetV3,
  ImageEditBrushTileChangeV3,
  ImageEditBrushTileSnapshotV3,
  ImageEditBrushTileV3,
} from './contracts';
import { IMAGE_EDIT_BRUSH_TILE_SIZE_V3 } from './contracts';
import { ImageEditBrushPointBufferV3 } from './pointBuffer';
import {
  imageEditBrushSegmentBoundsV3,
  rasterizeImageEditBrushSegmentV3,
} from './rasterize';
import { simplifyImageEditBrushPointsV3 } from './simplify';

type StrokeState = 'active' | 'finishing' | 'completed' | 'cancelled' | 'failed';
const RESOURCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

interface WorkingTile {
  coordinate: ImageEditTileCoordinate;
  tile: ImageEditBrushTileV3;
  oldResource: ImageEditBrushResourceReferenceV3 | null;
  changed: boolean;
}

export function imageEditBrushTileKeyV3(coordinate: ImageEditTileCoordinate): string {
  return `${coordinate.mip}/${coordinate.x}/${coordinate.y}`;
}

function assertOptions(options: ImageEditBrushStrokeOptionsV3): void {
  if (
    !Number.isSafeInteger(options.canvas.width)
    || !Number.isSafeInteger(options.canvas.height)
    || options.canvas.width < 1
    || options.canvas.height < 1
  ) throw new Error('画笔画布尺寸必须是正整数');
  if (!Number.isFinite(options.shape.size) || options.shape.size <= 0) {
    throw new Error('画笔尺寸必须是正有限数');
  }
  if (!Number.isFinite(options.shape.hardness)
    || options.shape.hardness < 0 || options.shape.hardness > 1) {
    throw new Error('画笔硬度必须位于 0～1');
  }
  if (!Number.isFinite(options.shape.opacity)
    || options.shape.opacity < 0 || options.shape.opacity > 1) {
    throw new Error('画笔不透明度必须位于 0～1');
  }
  if (typeof options.loadTile !== 'function') throw new Error('画笔缺少瓦片读取器');
  if (options.target.kind === 'mask') {
    const value = options.target.brushValue ?? 1;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('蒙版画笔值必须位于 0～1');
    }
    return;
  }
  const color = options.target.premultipliedColor;
  if (
    !['linear-light', 'perceptual-working', 'source-encoded'].includes(options.target.colorDomain)
    || !['srgb', 'display-p3', 'rec2020'].includes(options.target.workingSpace)
    || !['srgb', 'linear', 'pq', 'hlg'].includes(options.target.transferFunction)
    || !Number.isFinite(options.target.referenceWhiteNits)
    || options.target.referenceWhiteNits <= 0
  ) throw new Error('栅格画笔颜色编码无效');
  if (color.some((value) => !Number.isFinite(value))
    || color[3] > 1
    || color[3] < 0
    || (color[3] === 0 && (color[0] !== 0 || color[1] !== 0 || color[2] !== 0))) {
    throw new Error('栅格画笔颜色必须是有效的 Float32 预乘 RGBA');
  }
}

function cloneTarget(target: ImageEditBrushTargetV3): ImageEditBrushTargetV3 {
  return target.kind === 'mask'
    ? { kind: 'mask', brushValue: target.brushValue }
    : {
      kind: 'raster-rgba',
      colorDomain: target.colorDomain,
      workingSpace: target.workingSpace,
      transferFunction: target.transferFunction,
      referenceWhiteNits: target.referenceWhiteNits,
      premultipliedColor: [...target.premultipliedColor],
    };
}

function validateResource(resource: ImageEditBrushResourceReferenceV3 | null): void {
  if (!resource) return;
  if (!RESOURCE_ID_PATTERN.test(resource.resourceId)
    || !Number.isSafeInteger(resource.byteSize)
    || resource.byteSize < 0) {
    throw new Error('画笔旧瓦片资源引用无效');
  }
}

function validateRgbaValues(tile: Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }>): void {
  for (let offset = 0; offset < tile.data.length; offset += 4) {
    const alpha = tile.data[offset + 3];
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('画笔 RGBA 瓦片 Alpha 必须位于 0～1');
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = tile.data[offset + channel];
      if (!Number.isFinite(value) || (alpha === 0 && value !== 0)) {
        throw new Error('画笔 RGBA 瓦片必须包含有效的预乘 Float32 像素');
      }
    }
  }
}

function cloneAndValidateTile(
  snapshot: ImageEditBrushTileSnapshotV3,
  target: ImageEditBrushTargetV3,
  width: number,
  height: number,
): ImageEditBrushTileV3 {
  validateResource(snapshot.resource);
  if (snapshot.tile.width !== width || snapshot.tile.height !== height) {
    throw new Error('画笔读取器返回了错误尺寸的瓦片');
  }
  if (target.kind === 'mask' && snapshot.tile.storage === 'mask-float32') {
    assertFloat32MaskTile(snapshot.tile);
    return createFloat32MaskTile(width, height, new Float32Array(snapshot.tile.data));
  }
  if (target.kind === 'raster-rgba' && snapshot.tile.storage === 'rgba-float32') {
    assertFloat32PremultipliedRgbaTile(snapshot.tile, target.colorDomain);
    if (
      snapshot.tile.workingSpace !== target.workingSpace
      || snapshot.tile.transferFunction !== target.transferFunction
      || snapshot.tile.referenceWhiteNits !== target.referenceWhiteNits
    ) throw new Error('画笔读取器返回的瓦片颜色编码与目标不一致');
    validateRgbaValues(snapshot.tile);
    return createFloat32PremultipliedRgbaTile(
      width,
      height,
      target.colorDomain,
      new Float32Array(snapshot.tile.data),
      target.workingSpace,
      target.transferFunction,
      target.referenceWhiteNits,
    );
  }
  throw new Error('画笔读取器返回的瓦片类型与目标不一致');
}

function summarizeHistory(changes: readonly ImageEditBrushTileChangeV3[]): {
  oldResources: ImageEditBrushResourceReferenceV3[];
  oldResourceBytes: number;
  pendingNewRawBytes: number;
} {
  const byId = new Map<string, ImageEditBrushResourceReferenceV3>();
  let pendingNewRawBytes = 0;
  for (const change of changes) {
    pendingNewRawBytes += change.newRawByteSize;
    if (!Number.isSafeInteger(pendingNewRawBytes)) throw new Error('画笔新瓦片字节数溢出');
    const resource = change.oldResource;
    if (!resource) continue;
    const existing = byId.get(resource.resourceId);
    if (existing && existing.byteSize !== resource.byteSize) {
      throw new Error('同一旧瓦片资源出现了不同字节数');
    }
    byId.set(resource.resourceId, { ...resource });
  }
  const oldResources = [...byId.values()];
  const oldResourceBytes = oldResources.reduce((sum, resource) => sum + resource.byteSize, 0);
  if (!Number.isSafeInteger(oldResourceBytes)) throw new Error('画笔旧瓦片字节数溢出');
  return { oldResources, oldResourceBytes, pendingNewRawBytes };
}

export class ImageEditBrushStrokeSessionV3 {
  private readonly pointBuffer: ImageEditBrushPointBufferV3;
  private readonly abortController = new AbortController();
  private state: StrokeState = 'active';

  constructor(private readonly options: ImageEditBrushStrokeOptionsV3) {
    assertOptions(options);
    this.pointBuffer = new ImageEditBrushPointBufferV3(options.minScreenDistance);
  }

  appendPoint(point: ImageEditBrushPointV3): void {
    this.assertActive();
    this.pointBuffer.append(point);
  }

  appendCoalescedPoints(points: readonly ImageEditBrushPointV3[]): void {
    this.assertActive();
    this.pointBuffer.appendCoalesced(points);
  }

  getPointBufferStats(): ImageEditBrushPointBufferStatsV3 {
    return this.pointBuffer.getStats();
  }

  cancel(): void {
    if (this.state === 'completed' || this.state === 'cancelled') return;
    this.state = 'cancelled';
    this.abortController.abort();
    this.pointBuffer.clear();
  }

  async finish(): Promise<ImageEditBrushStrokeResultV3 | null> {
    if (this.state === 'cancelled') return null;
    this.assertActive();
    this.state = 'finishing';
    const bufferStats = this.pointBuffer.getStats();
    const points = simplifyImageEditBrushPointsV3(
      this.pointBuffer.toArray(),
      this.options.simplifyScreenTolerance,
      this.options.simplifyPressureTolerance,
    );
    if (points.length === 0) {
      this.state = 'completed';
      return null;
    }
    try {
      return await this.render(points, bufferStats);
    } catch (error) {
      if (this.isCancelled()) return null;
      this.state = 'failed';
      throw error;
    }
  }

  private async render(
    points: readonly BufferedImageEditBrushPointV3[],
    bufferStats: ImageEditBrushPointBufferStatsV3,
  ): Promise<ImageEditBrushStrokeResultV3 | null> {
    const working = new Map<string, WorkingTile>();
    const segmentCount = Math.max(1, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      if (this.state === 'cancelled') return null;
      const start = points.length === 1 ? points[0] : points[index];
      const end = points.length === 1 ? points[0] : points[index + 1];
      const bounds = imageEditBrushSegmentBoundsV3(start, end, this.options.shape.size);
      if (!bounds) continue;
      const coordinates = enumerateTilesForRect(
        this.options.canvas,
        0,
        bounds,
        IMAGE_EDIT_BRUSH_TILE_SIZE_V3,
      );
      for (const coordinate of coordinates) {
        const tile = await this.getWorkingTile(working, coordinate);
        if (this.isCancelled()) return null;
        const region = createTileRegion(
          this.options.canvas,
          coordinate,
          0,
          IMAGE_EDIT_BRUSH_TILE_SIZE_V3,
        );
        tile.changed = rasterizeImageEditBrushSegmentV3(
          { tile: tile.tile, originX: region.outputRect.x, originY: region.outputRect.y },
          start,
          end,
          this.options.shape,
          this.options.target,
          this.options.tool,
        ) || tile.changed;
      }
    }
    if (this.isCancelled()) return null;
    const changes = [...working.values()]
      .filter((entry) => entry.changed)
      .sort((left, right) => left.coordinate.y - right.coordinate.y
        || left.coordinate.x - right.coordinate.x)
      .map<ImageEditBrushTileChangeV3>((entry) => ({
        tileKey: imageEditBrushTileKeyV3(entry.coordinate),
        coordinate: { ...entry.coordinate },
        tile: entry.tile,
        oldResource: entry.oldResource ? { ...entry.oldResource } : null,
        newRawByteSize: entry.tile.data.byteLength,
      }));
    this.state = 'completed';
    if (changes.length === 0) return null;
    return {
      target: cloneTarget(this.options.target),
      changes,
      history: summarizeHistory(changes),
      metrics: {
        ...bufferStats,
        simplifiedPointCount: points.length,
        loadedTileCount: working.size,
        changedTileCount: changes.length,
      },
    };
  }

  private async getWorkingTile(
    working: Map<string, WorkingTile>,
    coordinate: ImageEditTileCoordinate,
  ): Promise<WorkingTile> {
    const key = imageEditBrushTileKeyV3(coordinate);
    const existing = working.get(key);
    if (existing) return existing;
    const region = createTileRegion(
      this.options.canvas,
      coordinate,
      0,
      IMAGE_EDIT_BRUSH_TILE_SIZE_V3,
    );
    const snapshot = await this.options.loadTile(coordinate, this.abortController.signal);
    if (this.isCancelled()) throw new Error('画笔操作已取消');
    const entry: WorkingTile = {
      coordinate: { ...coordinate },
      tile: cloneAndValidateTile(
        snapshot,
        this.options.target,
        region.outputRect.width,
        region.outputRect.height,
      ),
      oldResource: snapshot.resource ? { ...snapshot.resource } : null,
      changed: false,
    };
    working.set(key, entry);
    return entry;
  }

  private assertActive(): void {
    if (this.state !== 'active') throw new Error(`当前画笔状态不能继续输入：${this.state}`);
  }

  private isCancelled(): boolean {
    return this.state === 'cancelled';
  }
}
