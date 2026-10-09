import { createImageEditorV3RequestId, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources } from '@/commands/imageEditorV3';
import type { RegionRect, RegionSnapshot } from '@/core/imaging/regions';
import type { SelectionAlgorithm, SelectionModification } from '@/core/imaging/regions/selectionAlgorithms';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { encodeImageEditRegionSnapshotV3 } from '@/core/imageEdit/v3/selection/snapshot';
import { imageEditAdvancedSelectionIntentSchemaV3, type ImageEditAdvancedSelectionIntentV3 } from '@/core/imageEdit/v3/selection/advanced';
import { createLogger } from '@/core/logging';
import { findImageEditV3LiveLayer } from '../../application/imageEditDocumentRefs';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { createImageEditorRasterBrushTileLoaderV3 } from '../../editor/rasterBrushTilesV3';
import { mapAnnotationPointV3, invertAnnotationMatrixV3, multiplyAnnotationMatricesV3, resolveAnnotationLayerToOutputMatrixV3, resolveAnnotationOutputGeometryV3, type AnnotationMatrixV3 } from '../../editor/annotationGeometryV3';
import { ImageEditSelectionRasterClientV3 } from '../../execution/selectionRasterClientV3';
import { runAdvancedSelectionWorker } from './workerClient';
import type { AdvancedSelectionReadPort } from './workerClient';
import type { AdvancedSelectionRequest } from './protocol';

const logger = createLogger('features.image_edit_v3.selection_advanced');
export interface AdvancedSelectionPreview {
  snapshot: RegionSnapshot;
  /** Maps source pixel coordinates to original document pixels, independent of crop/zoom. */
  sourceToDocument: AnnotationMatrixV3;
  documentRevision: number;
  selectionRevision: number;
  selection: ImageEditSelectionSessionV3 | null;
}
export interface AdvancedSelectionOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** Tests inject the same pure algorithm; production always uses a Worker. */
  execute?: typeof runAdvancedSelectionWorker;
}
export type AdvancedSelectionOperation =
  | { kind: 'solve'; algorithm: SelectionAlgorithm }
  | { kind: 'modify'; mode: SelectionModification; radiusRatio: number }
  | { kind: 'feather'; radiusRatio: number };

/** One preview service for UI and algorithm capabilities. Preview never writes history. */
export async function previewAdvancedImageEditSelectionV3(bus: ImageEditCommandBusV3, layerId: string | null, operation: AdvancedSelectionOperation, options: AdvancedSelectionOptions = {}): Promise<AdvancedSelectionPreview> {
  const start = bus.getSnapshot(), abort = new AbortController();
  const cancel = (): void => abort.abort();
  const lifecycle = bus.getLifecycleSignal();
  const fresh = (): void => {
    abort.signal.throwIfAborted(); lifecycle.throwIfAborted(); options.signal?.throwIfAborted();
    const now = bus.getSnapshot();
    if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新预览');
  };
  fresh();
  const stop = bus.subscribe(() => { const now = bus.getSnapshot(); if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) cancel(); });
  lifecycle.addEventListener('abort', cancel, { once: true }); options.signal?.addEventListener('abort', cancel, { once: true });
  let raster: ImageEditSelectionRasterClientV3 | null = null;
  const lease = createImageEditorV3RequestId('selection-advanced-lease');
  let pinned = false;
  logger.info('高级选区预览开始', { event: 'image_edit.selection_advanced.start', context: { documentId: start.document.id, kind: operation.kind } });
  try {
    let grid = { width: start.document.geometry.width, height: start.document.geometry.height };
    let matrix: AnnotationMatrixV3 = [1, 0, 0, 1, 0, 0];
    let read: AdvancedSelectionReadPort['read'];
    let requestOperation: AdvancedSelectionRequest['operation'];
    if (operation.kind === 'solve') {
      const location = layerId ? findImageEditV3LiveLayer(start.document, layerId) : null;
      if (!location || location.layer.type !== 'raster' || !location.layer.visible || location.ancestors.some(layer => !layer.visible)) throw new Error('请选择一个可见的像素图层');
      await pinImageEditorV3RepairResources(lease, collectImageEditJsonResourceIdsV3(start.document)); pinned = true; fresh();
      const loader = createImageEditorRasterBrushTileLoaderV3({ document: start.document, layer: location.layer, resourceByteSizes: new Map(Object.entries(bus.getResourceByteSizes())) });
      grid = await loader.resolveStorageSize(abort.signal); fresh();
      matrix = multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(start.document).sourceToOutput), resolveAnnotationLayerToOutputMatrixV3(start.document, [location.layer.transform, ...location.ancestors.slice().reverse().map(parent => parent.transform)]));
      read = async (region, _pixels, signal) => {
        fresh(); const data = new Float32Array(region.width * region.height * 4);
        for (let ty = Math.floor(region.y / 512); ty * 512 < region.y + region.height; ty++) for (let tx = Math.floor(region.x / 512); tx * 512 < region.x + region.width; tx++) {
          const loaded = await loader({ mip: 0, x: tx, y: ty }, signal); fresh();
          if (loaded.tile.storage !== 'rgba-float32') throw new Error('选区像素格式不匹配');
          const tile = loaded.tile, left = Math.max(region.x, tx * 512), right = Math.min(region.x + region.width, tx * 512 + tile.width);
          for (let y = Math.max(region.y, ty * 512); y < Math.min(region.y + region.height, ty * 512 + tile.height); y++) {
            data.set(tile.data.subarray(((y - ty * 512) * tile.width + left - tx * 512) * 4, ((y - ty * 512) * tile.width + right - tx * 512) * 4), ((y - region.y) * region.width + left - region.x) * 4);
          }
        }
        return { value: { ...region, data }, premultiplied: true };
      };
      requestOperation = operation;
    } else {
      if (!start.selection) throw new Error('请先创建选区');
      if (!Number.isFinite(operation.radiusRatio) || operation.radiusRatio <= 0 || operation.radiusRatio > 1) throw new Error('修改范围必须为画面短边的 0 到 100%');
      const selection = operation.kind === 'feather' ? { ...start.selection, feather: operation.radiusRatio } : start.selection;
      raster = new ImageEditSelectionRasterClientV3();
      const reader = raster;
      read = async (region: RegionRect, _pixels, signal) => { fresh(); const data = await reader.rasterize({ selection, size: grid, region }, signal); fresh(); return { value: { ...region, data } }; };
      requestOperation = { kind: 'modify', mode: operation.kind === 'modify' ? operation.mode : 'smooth', radius: Math.max(1, Math.round(operation.radiusRatio * Math.min(grid.width, grid.height))) };
    }
    let snapshot: RegionSnapshot;
    if (operation.kind === 'feather') {
      const tiles = new Map<string, import('@/core/imaging/regions').Coverage>();
      const total = Math.ceil(grid.width / 512) * Math.ceil(grid.height / 512); let done = 0;
      options.onProgress?.(0, total);
      for (let y = 0; y < grid.height; y += 512) for (let x = 0; x < grid.width; x += 512) {
        const region = { x, y, width: Math.min(512, grid.width - x), height: Math.min(512, grid.height - y) };
        const tile = (await read(region, false, abort.signal)).value;
        if (tile.data.some(value => value > 0)) tiles.set(`${x / 512}/${y / 512}`, tile);
        options.onProgress?.(++done, total);
      }
      snapshot = { grid, tileSize: 512, defaultValue: 0, inverted: false, tiles };
    } else snapshot = await (options.execute ?? runAdvancedSelectionWorker)({ grid, context: { sourceVersion: `${start.document.id}:${start.document.revision}`, time: { kind: 'static' }, referenceGrid: grid, quality: 'final' }, operation: requestOperation }, { read }, abort.signal, options.onProgress);
    fresh();
    logger.info('高级选区预览完成', { event: 'image_edit.selection_advanced.completed', context: { documentId: start.document.id } });
    return { snapshot, sourceToDocument: matrix, documentRevision: start.document.revision, selectionRevision: start.selectionRevision, selection: start.selection };
  } catch (error) { if (!abort.signal.aborted) logger.error('高级选区预览失败', error, { event: 'image_edit.selection_advanced.failed' }); throw error; }
  finally {
    cancel(); stop(); raster?.dispose(); lifecycle.removeEventListener('abort', cancel); options.signal?.removeEventListener('abort', cancel);
    if (pinned) try { await releaseImageEditorV3RepairResources(lease); } catch (error) { logger.warn('选区预览资源释放失败', { event: 'image_edit.selection_advanced.release.failed', error }); }
  }
}

/** A shared owner supplies the lossless Float32 session adapter. No GRAY8 fallback. */
export function commitAdvancedImageEditSelectionV3(bus: ImageEditCommandBusV3, preview: AdvancedSelectionPreview, encode: (snapshot: RegionSnapshot, matrix: AnnotationMatrixV3) => ImageEditSelectionSessionV3): number | null {
  const now = bus.getSnapshot();
  if (now.document.revision !== preview.documentRevision || now.selectionRevision !== preview.selectionRevision) throw new Error('图片或选区已变化，请重新预览');
  return bus.setSelection(encode(preview.snapshot, preview.sourceToDocument));
}

/** Public intent coordinates are relative to the uncropped document, shared by UI and Application Control. */
export async function previewImageEditSelectionIntentV3(bus: ImageEditCommandBusV3, layerId: string | null, input: ImageEditAdvancedSelectionIntentV3,
  combine: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace', options: AdvancedSelectionOptions = {}): Promise<AdvancedSelectionPreview & { result: ImageEditSelectionSessionV3 }> {
  const intent = imageEditAdvancedSelectionIntentSchemaV3.parse(input), document = bus.getSnapshot().document;
  const location = layerId ? findImageEditV3LiveLayer(document, layerId) : null;
  const sourceToDocument = location ? multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(document).sourceToOutput),
    resolveAnnotationLayerToOutputMatrixV3(document, [location.layer.transform, ...location.ancestors.slice().reverse().map(parent => parent.transform)])) : [1, 0, 0, 1, 0, 0] as const;
  const inverse = invertAnnotationMatrixV3(sourceToDocument);
  const point = (p: { x: number; y: number }): { x: number; y: number } => {
    const mapped = mapAnnotationPointV3(inverse, [p.x * document.geometry.width, p.y * document.geometry.height]);
    return { x: Math.floor(mapped[0]), y: Math.floor(mapped[1]) };
  };
  const operation: AdvancedSelectionOperation = intent.kind === 'modify'
    ? intent.mode === 'feather' ? { kind: 'feather', radiusRatio: intent.radiusRatio } : { kind: 'modify', mode: intent.mode, radiusRatio: intent.radiusRatio }
    : { kind: 'solve', algorithm: intent.kind === 'wand' ? { kind: 'wand', seed: point(intent.point), tolerance: intent.tolerance, contiguous: intent.contiguous }
      : intent.kind === 'color-range' ? { kind: 'color-range', samples: intent.points.map(point), tolerance: intent.tolerance }
        : { kind: 'focus', range: intent.range, noise: intent.noise } };
  const preview = await previewAdvancedImageEditSelectionV3(bus, layerId, operation, options);
  const shape = encodeImageEditRegionSnapshotV3(preview.snapshot, preview.sourceToDocument, document.geometry);
  const result = intent.kind === 'modify' ? { ...appendImageEditSelectionV3(null, shape, 'replace'), feather: 0 }
    : appendImageEditSelectionV3(preview.selection, shape, combine);
  return { ...preview, result };
}

export function applyImageEditSelectionPreviewV3(bus: ImageEditCommandBusV3, preview: AdvancedSelectionPreview & { result: ImageEditSelectionSessionV3 }): number | null {
  return commitAdvancedImageEditSelectionV3(bus, preview, () => preview.result);
}
