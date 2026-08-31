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
  private readonly working = new Map<string, WorkingTile>();
  private pendingPoints: BufferedImageEditBrushPointV3[] = [];
  private lastRenderedPoint: BufferedImageEditBrushPointV3 | null = null;
  private renderedIncrementally = false;
  private rendering = false;
  private state: StrokeState = 'active';

  constructor(private readonly options: ImageEditBrushStrokeOptionsV3) {
    assertOptions(options);
    this.pointBuffer = new ImageEditBrushPointBufferV3(options.minScreenDistance);
  }

  appendPoint(point: ImageEditBrushPointV3): void {
    this.assertActive();
    this.appendBufferedPoint(point);
  }

  appendCoalescedPoints(points: readonly ImageEditBrushPointV3[]): void {
    this.assertActive();
    for (const point of points) this.appendBufferedPoint(point);
  }

  getPointBufferStats(): ImageEditBrushPointBufferStatsV3 {
    return this.pointBuffer.getStats();
  }

  cancel(): void {
    if (this.state === 'completed' || this.state === 'cancelled') return;
    this.state = 'cancelled';
    this.abortController.abort();
    this.pointBuffer.clear();
    this.pendingPoints = [];
  }

  /**
   * 将上次刷新后保留的屏幕抽稀点增量栅格化。返回值只包含本次触及的 dirty tiles，
   * 供手势 overlay 局部更新；持久化仍必须等 finish() 返回完整笔画结果。
   */
  async renderPending(): Promise<readonly ImageEditBrushTileChangeV3[]> {
    this.assertActive();
    if (this.rendering) throw new Error('画笔增量栅格化不能并发执行');
    this.rendering = true;
    this.renderedIncrementally = true;
    try {
      return await this.renderPendingPoints(false);
    } finally {
      this.rendering = false;
    }
  }

  async finish(): Promise<ImageEditBrushStrokeResultV3 | null> {
    if (this.state === 'cancelled') return null;
    this.assertActive();
    if (this.rendering) throw new Error('画笔增量栅格化完成前不能结束手势');
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
      if (!this.renderedIncrementally) {
        this.pendingPoints = [];
        await this.renderSegments(points);
      } else {
        await this.renderPendingPoints(true);
      }
      return this.createResult(points.length, bufferStats);
    } catch (error) {
      if (this.isCancelled()) return null;
      this.state = 'failed';
      throw error;
    }
  }

  private async renderSegments(
    points: readonly BufferedImageEditBrushPointV3[],
    dirtyKeys?: Set<string>,
    startPoint?: BufferedImageEditBrushPointV3 | null,
  ): Promise<void> {
    if (points.length === 0) return;
    const sequence = startPoint ? [startPoint, ...points] : points;
    const working = this.working;
    const segmentCount = Math.max(1, sequence.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      if (this.state === 'cancelled') return;
      const start = sequence.length === 1 ? sequence[0] : sequence[index];
      const end = sequence.length === 1 ? sequence[0] : sequence[index + 1];
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
        if (this.isCancelled()) return;
        const region = createTileRegion(
          this.options.canvas,
          coordinate,
          0,
          IMAGE_EDIT_BRUSH_TILE_SIZE_V3,
        );
        const changed = rasterizeImageEditBrushSegmentV3(
          { tile: tile.tile, originX: region.outputRect.x, originY: region.outputRect.y },
          start,
          end,
          this.options.shape,
          this.options.target,
          this.options.tool,
        );
        tile.changed = changed || tile.changed;
        if (changed) dirtyKeys?.add(imageEditBrushTileKeyV3(coordinate));
      }
    }
  }

  private createResult(
    simplifiedPointCount: number,
    bufferStats: ImageEditBrushPointBufferStatsV3,
  ): ImageEditBrushStrokeResultV3 | null {
    if (this.isCancelled()) return null;
    const changes = [...this.working.values()]
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
        simplifiedPointCount,
        loadedTileCount: this.working.size,
        changedTileCount: changes.length,
      },
    };
  }

  private async renderPendingPoints(includeTrailingPoint: boolean): Promise<ImageEditBrushTileChangeV3[]> {
    if (includeTrailingPoint) {
      const latest = this.pointBuffer.getLast();
      if (latest && this.lastRenderedPoint && !this.samePoint(latest, this.lastRenderedPoint)) {
        const pendingLast = this.pendingPoints[this.pendingPoints.length - 1];
        if (!pendingLast || !this.samePoint(pendingLast, latest)) this.pendingPoints.push(latest);
      }
    }
    const points = this.pendingPoints;
    this.pendingPoints = [];
    if (points.length === 0) return [];
    const dirtyKeys = new Set<string>();
    await this.renderSegments(points, dirtyKeys, this.lastRenderedPoint);
    if (this.isCancelled()) return [];
    this.lastRenderedPoint = points[points.length - 1];
    return [...dirtyKeys]
      .map((key) => this.working.get(key))
      .filter((entry): entry is WorkingTile => Boolean(entry?.changed))
      .map((entry) => this.toChange(entry));
  }

  private appendBufferedPoint(point: ImageEditBrushPointV3): void {
    const retained = this.pointBuffer.append(point);
    const latest = this.pointBuffer.getLast();
    if (!latest) return;
    if (retained) this.pendingPoints.push(latest);
    else if (this.pendingPoints.length > 0) this.pendingPoints[this.pendingPoints.length - 1] = latest;
  }

  private samePoint(
    left: BufferedImageEditBrushPointV3,
    right: BufferedImageEditBrushPointV3,
  ): boolean {
    return left.x === right.x && left.y === right.y
      && left.screenX === right.screenX && left.screenY === right.screenY
      && left.pressure === right.pressure;
  }

  private toChange(entry: WorkingTile): ImageEditBrushTileChangeV3 {
    return {
      tileKey: imageEditBrushTileKeyV3(entry.coordinate),
      coordinate: { ...entry.coordinate },
      tile: entry.tile,
      oldResource: entry.oldResource ? { ...entry.oldResource } : null,
      newRawByteSize: entry.tile.data.byteLength,
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
