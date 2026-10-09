import { createImageEditorV3RequestId, persistImageEditorV3BrushTiles, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources } from '@/commands/imageEditorV3';
import { materializeImageEditBrushTileDeltaV3 } from '@/core/imageEdit/v3/brush/tileDelta';
import type { ImageEditBrushResourceReferenceV3, ImageEditBrushTileV3, PersistedImageEditBrushTileV3 } from '@/core/imageEdit/v3/brush/contracts';
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import { validatePaintFill, type PaintFill, type PaintSurface } from '@/core/imaging/paint';
import { createLogger } from '@/core/logging';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { resolveImageEditorBrushEditingTargetV3, type ImageEditorBrushEditingTargetV3 } from '../../editor/brushEditingTargetV3';
import { createPaintSelectionClip } from './selectionClip';
import { PaintWorkerClient } from './workerClient';

const logger = createLogger('features.image_edit_v3.paint');
export interface PaintFillOptionsV3 {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** Boundary injection only; production uses the formal loaders, Worker and resource service. */
  target?: ImageEditorBrushEditingTargetV3;
  worker?: Pick<PaintWorkerClient, 'fill' | 'dispose'>;
  persist?: (tiles: readonly { tileKey: string; tile: ImageEditBrushTileV3 }[], signal: AbortSignal) => Promise<readonly PersistedImageEditBrushTileV3[]>;
  pin?: typeof pinImageEditorV3RepairResources;
  release?: typeof releaseImageEditorV3RepairResources;
}

/** Stream one tile at a time, retain only resource metadata, then commit exactly one delta. */
export async function fillImageEditTargetV3(bus: ImageEditCommandBusV3, layerId: string, destination: 'pixels' | 'mask', fill: PaintFill, opacity: number, options: PaintFillOptionsV3 = {}): Promise<string | null> {
  validatePaintFill(fill);
  const start = bus.getSnapshot(), abort = new AbortController(), lifecycle = bus.getLifecycleSignal();
  const cancel = (): void => abort.abort();
  const fresh = (): void => {
    abort.signal.throwIfAborted(); options.signal?.throwIfAborted(); lifecycle.throwIfAborted();
    const now = bus.getSnapshot();
    if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新填充');
  };
  fresh();
  const resolved = options.target ? { ready: true as const, target: options.target } : resolveImageEditorBrushEditingTargetV3({ document: start.document,
    selectedLayerIds: [layerId], activeTool: destination === 'mask' ? 'mask-edit' : 'raster-brush', maskMode: 'paint', resourceByteSizes: new Map(Object.entries(bus.getResourceByteSizes())) });
  if (!resolved.ready) throw new Error(`无法填充：${resolved.reason}`);
  const target = resolved.target;
  const size = target.resolveStorageSize ?? (async () => start.document.geometry);
  const clip = createPaintSelectionClip(start.document, start.selection, target.matrix, size);
  const worker = options.worker ?? new PaintWorkerClient();
  const lease = createImageEditorV3RequestId('paint-fill-lease');
  const pin = options.pin ?? pinImageEditorV3RepairResources, release = options.release ?? releaseImageEditorV3RepairResources;
  const persist = options.persist ?? (async (tiles, signal) => (await persistImageEditorV3BrushTiles({ requestId: createImageEditorV3RequestId('paint-fill-persist'), tiles }, signal)).tiles);
  const resources = new Set(collectImageEditJsonResourceIdsV3(start.document));
  const changes: { tileKey: string; oldResource: ImageEditBrushResourceReferenceV3 | null }[] = [];
  const persisted: PersistedImageEditBrushTileV3[] = [];
  let pinned = false;
  const unsubscribe = bus.subscribe(() => { const now = bus.getSnapshot(); if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) cancel(); });
  lifecycle.addEventListener('abort', cancel, { once: true }); options.signal?.addEventListener('abort', cancel, { once: true });
  logger.info('填充开始', { event: 'image_edit.paint.fill.start', context: { documentId: start.document.id, layerId, destination, kind: fill.kind } });
  try {
    await pin(lease, [...resources]); pinned = true; fresh();
    const grid = await size(abort.signal); fresh();
    const total = Math.ceil(grid.width / 512) * Math.ceil(grid.height / 512); let completed = 0;
    options.onProgress?.(0, total);
    for (let y = 0; y < grid.height; y += 512) for (let x = 0; x < grid.width; x += 512) {
      fresh();
      const coordinate = { mip: 0, x: x / 512, y: y / 512 };
      const coverage = await clip.read?.(coordinate, abort.signal); fresh();
      if (coverage && !coverage.some(value => value > 0)) { options.onProgress?.(++completed, total); continue; }
      const snapshot = await target.loadTile(coordinate, abort.signal); fresh();
      const tile = { ...snapshot.tile, data: new Float32Array(snapshot.tile.data) };
      const surface: PaintSurface = { width: tile.width, height: tile.height, originX: x, originY: y,
        before: snapshot.tile.data, output: tile.data, coverage: new Float32Array(tile.width * tile.height), clip: coverage };
      const changed = await worker.fill(surface, fill, opacity, target.target.kind === 'mask', abort.signal); fresh();
      if (changed) {
        const tileKey = `0/${coordinate.x}/${coordinate.y}`;
        const written = await persist([{ tileKey, tile }], abort.signal); fresh();
        if (written.length !== 1 || written[0].tileKey !== tileKey) throw new Error('填充瓦片保存结果不匹配');
        changes.push({ tileKey, oldResource: snapshot.resource }); persisted.push(written[0]); resources.add(written[0].resourceId);
        await pin(lease, [...resources]); fresh();
      }
      options.onProgress?.(++completed, total);
    }
    fresh();
    if (!changes.length) { logger.info('填充无需更改', { event: 'image_edit.paint.fill.completed', context: { documentId: start.document.id, layerId, tileCount: 0 } }); return null; }
    const commandId = createImageEditIdV3(fill.kind === 'solid' ? 'paint-fill' : 'paint-gradient');
    const delta = materializeImageEditBrushTileDeltaV3({ changes }, { commandId, expectedRevision: start.document.revision, layerId, destination: target.destination, persistedTiles: persisted });
    unsubscribe();
    bus.dispatch(delta.command);
    logger.info('填充完成', { event: 'image_edit.paint.fill.completed', context: { documentId: start.document.id, layerId, commandId, tileCount: changes.length } });
    return commandId;
  } catch (error) {
    if (!abort.signal.aborted) logger.error('填充失败', error, { event: 'image_edit.paint.fill.failed', context: { documentId: start.document.id, layerId } });
    throw error;
  } finally {
    cancel(); unsubscribe(); worker.dispose(); clip.dispose();
    lifecycle.removeEventListener('abort', cancel); options.signal?.removeEventListener('abort', cancel);
    if (pinned) try { await release(lease); } catch (error) { logger.warn('填充资源释放失败', { event: 'image_edit.paint.fill.release.failed', error }); }
  }
}
