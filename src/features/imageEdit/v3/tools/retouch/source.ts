import type { ImageEditBrushTileLoaderV3, ImageEditBrushStrokeOptionsV3 } from '@/core/imageEdit/v3/brush/contracts';
import type { RetouchPixels, RetouchSource } from '@/core/imaging/retouch';
import type { PaintBrush, PaintDab, PaintSurface, PaintTarget } from '@/core/imaging/paint';
import type { ImageEditSize } from '@/core/imageEdit/v3/tileGeometry';
import { PaintWorkerClient } from '../paint/workerClient';
import { LeasedLruCache } from '@/core/imageEdit/v3/leasedLruCache';

/** Reads the immutable loader snapshot, never the preview or previous dab's output. */
export async function readRetouchRegion(load: ImageEditBrushTileLoaderV3, size: ImageEditSize, rect: { x: number; y: number; width: number; height: number }, signal: AbortSignal): Promise<RetouchPixels> {
  signal.throwIfAborted();
  const result: RetouchPixels = { width: rect.width, height: rect.height, originX: rect.x, originY: rect.y, data: new Float32Array(rect.width * rect.height * 4) };
  for (let ty = Math.max(0, Math.floor(rect.y / 512)); ty < Math.min(Math.ceil(size.height / 512), Math.ceil((rect.y + rect.height) / 512)); ty++) {
    for (let tx = Math.max(0, Math.floor(rect.x / 512)); tx < Math.min(Math.ceil(size.width / 512), Math.ceil((rect.x + rect.width) / 512)); tx++) {
      signal.throwIfAborted(); const { tile } = await load({ mip: 0, x: tx, y: ty }, signal); signal.throwIfAborted();
      if (tile.storage !== 'rgba-float32') throw new Error('修饰需要像素图层');
      const left = Math.max(rect.x, tx * 512), right = Math.min(rect.x + rect.width, tx * 512 + tile.width);
      for (let y = Math.max(rect.y, ty * 512); y < Math.min(rect.y + rect.height, ty * 512 + tile.height); y++) {
        result.data.set(tile.data.subarray(((y - ty * 512) * tile.width + left - tx * 512) * 4, ((y - ty * 512) * tile.width + right - tx * 512) * 4), ((y - rect.y) * rect.width + left - rect.x) * 4);
      }
    }
  }
  return result;
}

/** A stroke owns one compute client; source tiles are read from the fixed original document. */
export class RetouchStrokeCompute {
  private readonly worker = new PaintWorkerClient();
  private readonly cache = new LeasedLruCache<Awaited<ReturnType<ImageEditBrushTileLoaderV3>>>({ maxBytes: 64 * 1024 * 1024 });
  private readonly coverageCache = new LeasedLruCache<Float32Array>({ maxBytes: 16 * 1024 * 1024 });
  private readonly cachedLoad: ImageEditBrushTileLoaderV3 = async (coordinate, signal) => {
    signal.throwIfAborted(); const key = `${coordinate.mip}/${coordinate.x}/${coordinate.y}`, lease = this.cache.lease(key);
    if (lease) { const value = lease.value; lease.release(); return value; }
    const value = await this.load(coordinate, signal); signal.throwIfAborted();
    this.cache.set(key, value, value.tile.data.byteLength); return value;
  };
  constructor(private readonly load: ImageEditBrushTileLoaderV3, private readonly size: (signal: AbortSignal) => Promise<ImageEditSize>,
    private readonly mode: RetouchSource['mode'], private readonly offset: { x: number; y: number }, private readonly loadCoverage?: ImageEditBrushStrokeOptionsV3['loadCoverage']) {}

  private async readCoverage(grid: ImageEditSize, rect: { x: number; y: number; width: number; height: number }, signal: AbortSignal): Promise<Float32Array | undefined> {
    if (!this.loadCoverage) return undefined;
    const result = new Float32Array(rect.width * rect.height);
    for (let ty = Math.floor(rect.y / 512); ty < Math.ceil((rect.y + rect.height) / 512); ty++) for (let tx = Math.floor(rect.x / 512); tx < Math.ceil((rect.x + rect.width) / 512); tx++) {
      signal.throwIfAborted(); const key = `${tx}/${ty}`, lease = this.coverageCache.lease(key);
      let tile: Float32Array;
      if (lease) { tile = lease.value; lease.release(); }
      else { tile = await this.loadCoverage({ mip: 0, x: tx, y: ty }, signal); this.coverageCache.set(key, tile, tile.byteLength); }
      signal.throwIfAborted(); const width = Math.min(512, grid.width - tx * 512), left = Math.max(rect.x, tx * 512), right = Math.min(rect.x + rect.width, tx * 512 + width);
      for (let y = Math.max(rect.y, ty * 512); y < Math.min(rect.y + rect.height, (ty + 1) * 512); y++) result.set(tile.subarray((y - ty * 512) * width + left - tx * 512, (y - ty * 512) * width + right - tx * 512), (y - rect.y) * rect.width + left - rect.x);
    }
    return result;
  }

  rasterize = async (surface: PaintSurface, dabs: readonly PaintDab[], brush: PaintBrush, target: PaintTarget, _tool: 'brush' | 'eraser', signal: AbortSignal): Promise<boolean> => {
    if (target.kind !== 'rgba') throw new Error('图章与修复画笔只编辑像素，请切回像素目标');
    const grid = await this.size(signal), radius = this.mode === 'heal' ? Math.max(1, Math.ceil(brush.size / 2)) : 0;
    // A dab intersecting this tile may be centred outside it. Include its whole solve domain.
    const halo = radius ? radius * 3 + 2 : 0;
    const left = Math.max(0, surface.originX - halo), top = Math.max(0, surface.originY - halo);
    const rect = { x: left, y: top, width: Math.min(grid.width, surface.originX + surface.width + halo) - left, height: Math.min(grid.height, surface.originY + surface.height + halo) - top };
    const destination = this.mode === 'heal' ? await readRetouchRegion(this.cachedLoad, grid, rect, signal)
      : { width: surface.width, height: surface.height, originX: surface.originX, originY: surface.originY, data: surface.before };
    const source = await readRetouchRegion(this.cachedLoad, grid, { x: Math.floor(rect.x + this.offset.x), y: Math.floor(rect.y + this.offset.y), width: rect.width + 1, height: rect.height + 1 }, signal);
    const destinationCoverage = this.mode === 'heal' ? await this.readCoverage(grid, rect, signal) : undefined;
    return this.worker.retouch(surface, dabs, brush, { mode: this.mode, offset: this.offset, source, destination, destinationCoverage, healingRadius: radius }, signal);
  };
  dispose(): void { this.worker.dispose(); this.cache.clear(); this.coverageCache.clear(); }
}
