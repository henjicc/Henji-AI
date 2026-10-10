import { mapGeometrySelectionsV3 } from './mapSelections';
import { z } from 'zod';
import { canvasAnchorSchemaV3, canvasSizeTransformV3, createDocumentGeometryCommandV3, documentNeedsGeometryAppearanceV3, documentSizeSchemaV3 } from '@/core/imageEdit/v3/documentGeometry';
import { createImageEditIdV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditLayerCommonV3, type ImageEditSmartLayerV3 } from '@/core/imageEdit/v3/layerTypes';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import { prepareImageEditCommandV3 } from '@/core/imageEdit/v3/commandPreparation';
import { rebaseImageEditSelectionGridV3 } from '@/core/imageEdit/v3/selection/rebase';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import type { ImageEditSelectionMaskShapeV3 } from '@/core/imageEdit/v3/subjectSelection';
import type { Float32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { seamAnalysisSize, type SeamPlan } from '@/core/imaging/transforms/seam';
import type { ProxyContribution } from '@/core/imaging/transforms/seam/sampling';
import type { RegionRect, RegionSampleTime } from '@/core/imaging/regions';
import type { Affine } from '@/core/imaging/transforms';
import { createLogger } from '@/core/logging';
import { persistImageEditorV3BrushTiles, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources } from '@/commands/imageEditorV3';
import { prepareSmartContentAppearanceV3 } from '../../smartContent/service';
import { retainSmartContentResourcesV3 } from '../../smartContent/resourceLeases';
import { createImageEditorRasterBrushTileLoaderV3 } from '../../editor/rasterBrushTilesV3';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { GeometryWorkerClient } from './workerClient';

export const geometryRequestSchemaV3 = documentSizeSchemaV3.extend({ mode: z.enum(['canvas', 'resample', 'content-aware']), anchor: canvasAnchorSchemaV3.default('center'), protectSelection: z.boolean().default(true) });
export type GeometryRequestV3 = z.input<typeof geometryRequestSchemaV3>;
export interface GeometryDraftV3 { original: ImageEditDocumentV3; selectionVersion: number; command: ImageEditCommandV3; document: ImageEditDocumentV3; selection: ImageEditSelectionSessionV3 | null; bytes: Readonly<Record<string, number>>; release: () => Promise<void>; mode: 'canvas' | 'resample' | 'content-aware' }
export interface GeometryServiceOptionsV3 { signal?: AbortSignal; time?: RegionSampleTime; onProgress?: (value: number) => void }
const logger = createLogger('features.imageEdit.v3.document_geometry');
const SOURCE_READ_BUDGET = 32 * 1024 * 1024;

export async function prepareDocumentGeometryV3(bus: ImageEditCommandBusV3, request: GeometryRequestV3, options: GeometryServiceOptionsV3 = {}): Promise<GeometryDraftV3> {
  const parsed = geometryRequestSchemaV3.safeParse(request);
  if (!parsed.success) throw new Error('尺寸必须为可精确表示的正整数像素');
  const input = parsed.data, snapshot = bus.getSnapshot(), original = snapshot.document;
  if (input.width === original.geometry.width && input.height === original.geometry.height) throw new Error('尺寸没有变化');
  if (input.mode === 'content-aware' && input.protectSelection && !snapshot.selection) throw new Error('请先选择要保护的主体，或关闭保护当前选区');
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, bus.getLifecycleSignal(), ...(options.signal ? [options.signal] : [])]);
  const unsubscribe = bus.subscribe(next => { if (next.document !== original || next.selectionRevision !== snapshot.selectionRevision) controller.abort(new Error('图片或选区已改变，请重新预览')); });
  const releases: (() => Promise<void>)[] = []; const worker = new GeometryWorkerClient();
  const output = { width: input.width, height: input.height };
  const transform: Affine = input.mode === 'canvas' ? canvasSizeTransformV3(original.geometry, output, input.anchor) : [output.width / original.geometry.width, 0, 0, output.height / original.geometry.height, 0, 0];
  let replacement: ImageEditSmartLayerV3 | undefined;
  let bytes = { ...bus.getResourceByteSizes() };
  let selection = snapshot.selection ? rebaseImageEditSelectionGridV3(snapshot.selection, original.geometry, output, transform) : null;
  let namedRegions = original.namedRegions.map(region => ({ ...region, selection: rebaseImageEditSelectionGridV3(region.selection, original.geometry, output, transform) }));
  logger.info('开始准备尺寸预览', { event: 'image_edit.geometry.prepare.start', context: { documentId: original.id, mode: input.mode } });
  const release = async (): Promise<void> => { for (const dispose of releases.splice(0)) await dispose(); };
  try {
    signal.throwIfAborted();
    if (input.mode !== 'canvas' || documentNeedsGeometryAppearanceV3(original)) {
      // Embedded originals retain their reference grid, filter strengths, paths and independent masks.
      const content = { ...structuredClone(original), id: createImageEditIdV3('size-original'), geometry: { ...original.geometry, crop: null, orientation: { rotate: 0 as const, mirrored: false } } };
      const appearance = await prepareSmartContentAppearanceV3(content, original, bytes, signal, (done, total) => options.onProgress?.(done / Math.max(1, total) * 35));
      releases.push(appearance.release); bytes = appearance.bytes;
      const inner: ImageEditSmartLayerV3 = { ...createImageEditLayerCommonV3(createImageEditIdV3('size-layer'), '原稿'), type: 'smart', source: appearance.source, tiles: appearance.tiles,
        content: { id: createImageEditIdV3('size-content'), origin: null, document: content, width: appearance.width, height: appearance.height } };
      replacement = { ...inner, name: input.mode === 'canvas' ? '调整画布' : '调整图像尺寸', transform };
      if (input.mode === 'content-aware') {
        const lease = createImageEditIdV3('size-result');
        await pinImageEditorV3RepairResources(lease, []); releases.push(() => releaseImageEditorV3RepairResources(lease));
        const source = { width: appearance.width, height: appearance.height }, analysis = seamAnalysisSize(source, output);
        const loader = createImageEditorRasterBrushTileLoaderV3({ document: content, layer: { ...inner, type: 'raster', rasterCanvasSize: source }, resourceByteSizes: new Map(Object.entries(bytes)) });
        const cache = new Map<string, Float32PremultipliedRgbaTile>(); let cacheBytes = 0;
        const read = async (rect: RegionRect): Promise<Float32Array> => {
          const data = new Float32Array(rect.width * rect.height * 4);
          for (let ty = Math.floor(rect.y / 512); ty <= Math.floor((rect.y + rect.height - 1) / 512); ty++) for (let tx = Math.floor(rect.x / 512); tx <= Math.floor((rect.x + rect.width - 1) / 512); tx++) {
            signal.throwIfAborted(); const key = `${tx}/${ty}`; let tile = cache.get(key);
            if (!tile) { const value = await loader({ mip: 0, x: tx, y: ty }, signal); if (value.tile.storage !== 'rgba-float32') throw new Error('像素来源不是浮点图像'); tile = value.tile;
              while (cacheBytes + tile.data.byteLength > 64 * 1024 * 1024 && cache.size) { const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.data.byteLength; cache.delete(first); }
              cache.set(key, tile); cacheBytes += tile.data.byteLength;
            }
            const x = Math.max(rect.x, tx * 512), y = Math.max(rect.y, ty * 512), right = Math.min(rect.x + rect.width, tx * 512 + tile.width), bottom = Math.min(rect.y + rect.height, ty * 512 + tile.height);
            for (let row = y; row < bottom; row++) data.set(tile.data.subarray(((row - ty * 512) * tile.width + x - tx * 512) * 4, ((row - ty * 512) * tile.width + right - tx * 512) * 4), ((row - rect.y) * rect.width + x - rect.x) * 4);
          } return data;
        };
        const data = new Float32Array(analysis.source.width * analysis.source.height * 4), counts = new Float32Array(data.length / 4), protect = new Float32Array(counts.length);
        const tileTotal = Math.ceil(source.width / 512) * Math.ceil(source.height / 512); let tileIndex = 0;
        for (let y = 0; y < source.height; y += 512) for (let x = 0; x < source.width; x += 512) {
          const region = { x, y, width: Math.min(512, source.width - x), height: Math.min(512, source.height - y) };
          const value = await worker.run<ProxyContribution>({ kind: 'reduce', data: await read(region), region, source, proxy: analysis.source, protect: input.protectSelection ? snapshot.selection : null }, signal);
          for (let yy = 0; yy < value.region.height; yy++) for (let xx = 0; xx < value.region.width; xx++) { const a = yy * value.region.width + xx, b = (value.region.y + yy) * analysis.source.width + value.region.x + xx;
            counts[b] += value.counts[a]; protect[b] = Math.max(protect[b], value.protect[a]); for (let c = 0; c < 4; c++) data[b * 4 + c] += value.pixels[a * 4 + c];
          } options.onProgress?.(35 + ++tileIndex / tileTotal * 10);
        }
        for (let i = 0; i < counts.length; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] /= Math.max(1, counts[i]);
        await worker.run<SeamPlan>({ kind: 'plan', data, source: analysis.source, output: analysis.output, protect,
          context: { target: { kind: 'image_edit.document', id: original.id }, sourceVersion: String(original.revision), time: options.time ?? { kind: 'static' }, referenceGrid: source,
            roi: { x: 0, y: 0, ...source }, color: { workingSpace: original.color.workingSpace, transferFunction: 'linear', alpha: 'premultiplied', precision: 'float32' }, quality: 'final' } }, signal, (done, total) => options.onProgress?.(45 + done / Math.max(1, total) * 20));
        const map = async (region: RegionRect, selection?: ImageEditSelectionSessionV3): Promise<Float32Array> => {
          const sourceRect = await worker.run<RegionRect>({ kind: 'bounds', output, source, region }, signal);
          if (sourceRect.width * sourceRect.height * 16 > SOURCE_READ_BUDGET && region.width * region.height > 1) {
            const horizontal = region.width >= region.height, split = Math.floor((horizontal ? region.width : region.height) / 2);
            const first = { ...region, ...(horizontal ? { width: split } : { height: split }) }, second = { ...region, ...(horizontal ? { x: region.x + split, width: region.width - split } : { y: region.y + split, height: region.height - split }) };
            const a = await map(first, selection), b = await map(second, selection), channels = selection ? 1 : 4, result = new Float32Array(region.width * region.height * channels);
            for (const [part, values] of [[first, a], [second, b]] as const) for (let y = 0; y < part.height; y++) result.set(values.subarray(y * part.width * channels, (y + 1) * part.width * channels), ((part.y - region.y + y) * region.width + part.x - region.x) * channels);
            return result;
          }
          return worker.run<Float32Array>({ kind: 'sample', output, source, region, sourceRect, ...(selection ? { selection } : { pixels: await read(sourceRect) }) }, signal);
        };
        const regions = [...original.namedRegions.map(value => value.selection), ...(snapshot.selection ? [snapshot.selection] : [])];
        const runs: ImageEditSelectionMaskShapeV3['runs'][] = regions.map(() => []);
        const resultTiles: Record<string, string> = {}; const outputTotal = Math.ceil(output.width / 512) * Math.ceil(output.height / 512); let completed = 0;
        for (let y = 0; y < output.height; y += 512) for (let x = 0; x < output.width; x += 512) {
          const region = { x, y, width: Math.min(512, output.width - x), height: Math.min(512, output.height - y) }, pixels = await map(region);
          const tile = createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', pixels, original.color.workingSpace, original.color.transferFunction, original.color.hdrMetadata?.referenceWhiteNits ?? 203);
          const saved = await persistImageEditorV3BrushTiles({ requestId: createImageEditIdV3('size-tile'), tiles: [{ tileKey: `0/${x / 512}/${y / 512}`, tile }] }, signal);
          await pinImageEditorV3RepairResources(lease, saved.tiles.map(value => value.resourceId));
          for (const value of saved.tiles) { resultTiles[value.tileKey] = value.resourceId; bytes[value.resourceId] = value.byteSize; }
          for (let index = 0; index < regions.length; index++) { const coverage = await map(region, regions[index]);
            for (let row = 0; row < region.height; row++) for (let col = 0; col < region.width;) { const start = col, value = Math.max(0, Math.min(1, coverage[row * region.width + col++]));
              while (col < region.width && coverage[row * region.width + col] === value) col++;
              if (value > 0) runs[index].push([(region.y + row) * output.width + region.x + start, col - start, value]);
            }
          }
          options.onProgress?.(65 + ++completed / outputTotal * 35);
        }
        const selectionAt = (index: number): ImageEditSelectionSessionV3 => ({ feather: 0, inverted: false, operations: [{ combine: 'replace', invertBefore: false,
          shape: { type: 'mask', ...output, matrix: [1, 0, 0, 1, 0, 0], runs: runs[index].sort((a, b) => a[0] - b[0]) } }] });
        namedRegions = original.namedRegions.map((value, index) => ({ ...value, selection: selectionAt(index) })); selection = snapshot.selection ? selectionAt(regions.length - 1) : null;
        const resultContent = createImageEditDocumentV3({ ...output, color: original.color, documentId: createImageEditIdV3('seam-content') });
        resultContent.layers = [{ ...inner, visible: false }, { ...createImageEditRasterLayerV3(createImageEditIdV3('seam-pixels'), '缩放结果'), tiles: resultTiles }];
        resultContent.namedRegions = structuredClone(namedRegions);
        replacement = { ...createImageEditLayerCommonV3(createImageEditIdV3('seam-layer'), '内容识别缩放'), type: 'smart', source: { kind: 'empty' }, tiles: resultTiles,
          content: { id: createImageEditIdV3('seam-object'), origin: null, document: resultContent, ...output } };
      }
    }
    if (input.mode === 'resample' && (original.namedRegions.length || snapshot.selection)) {
      await worker.run<SeamPlan>({ kind: 'linear', source: original.geometry }, signal);
      const mapped = await mapGeometrySelectionsV3(worker, [...original.namedRegions.map(value => value.selection), ...(snapshot.selection ? [snapshot.selection] : [])], original.geometry, output, signal);
      namedRegions = original.namedRegions.map((value, index) => ({ ...value, selection: mapped[index] }));
      selection = snapshot.selection ? mapped[mapped.length - 1] : null;
    }
    let command = createDocumentGeometryCommandV3(original, output, transform, createImageEditIdV3('document-size'), replacement);
    if (command.type === 'document.atomic') command = { ...command, commands: command.commands.map(value => value.type === 'document.set-named-regions' ? { ...value, regions: namedRegions } : value) };
    command = prepareImageEditCommandV3(original, command, new Map(Object.entries(bytes)));
    const document = applyImageEditCommandV3(original, command).document;
    signal.throwIfAborted(); options.onProgress?.(100);
    logger.info('尺寸预览已准备', { event: 'image_edit.geometry.prepare.completed', context: { documentId: original.id, mode: input.mode } });
    return { original, selectionVersion: snapshot.selectionRevision, command, document: { ...document, revision: original.revision }, selection, bytes, release, mode: input.mode };
  } catch (error) { await release(); logger.warn('尺寸预览未应用', { event: 'image_edit.geometry.prepare.failed', error }); throw error; }
  finally { unsubscribe(); worker.dispose(); }
}
export function publishDocumentGeometryPreviewV3(bus: ImageEditCommandBusV3, draft: GeometryDraftV3): void {
  if (bus.getSnapshot().document !== draft.original || bus.getSnapshot().selectionRevision !== draft.selectionVersion) throw new Error('图片或选区已改变，请重新预览');
  bus.setPreview({ id: 'document-geometry', kind: 'document-geometry', targetId: draft.original.id, baseRevision: draft.original.revision, value: draft.document, resourceByteSizes: draft.bytes, selectionPreview: draft.selection });
}
export function commitDocumentGeometryV3(bus: ImageEditCommandBusV3, draft: GeometryDraftV3): string {
  if (bus.getSnapshot().document !== draft.original || bus.getSnapshot().selectionRevision !== draft.selectionVersion) throw new Error('图片或选区已改变，请重新预览');
  bus.clearPreview('document-geometry'); bus.dispatch(draft.command, draft.selection); retainSmartContentResourcesV3(bus, draft.release);
  logger.info('图片尺寸已调整', { event: 'image_edit.geometry.apply.completed', context: { documentId: draft.original.id, mode: draft.mode } });
  return draft.command.commandId;
}
