import { ingestImageEditorV3Source, persistImageEditorV3BrushTiles, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources } from '@/commands/imageEditorV3';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { convertFloat32TileColorContractV3 } from '@/core/imageEdit/v3/execution/tileColor';
import { createImageEditDocumentV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { decodeImageEditDocumentV3 } from '@/core/imageEdit/v3/documentCodec';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type { ImageEditSmartContentV3, ImageEditSmartOriginV3 } from '@/core/imageEdit/v3/smartContent/types';
import { createImageEditContentReplacementV3, embedImageEditRasterV3, rasterizeImageEditSmartLayerV3, updateImageEditSmartInstancesV3 } from '@/core/imageEdit/v3/smartContent/commands';
import { assertImageEditSmartGraphV3 } from '@/core/imageEdit/v3/smartContent/graph';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import { createImageEditLayerCommonV3 } from '@/core/imageEdit/v3/layerTypes';
import { findImageEditCommandLayerLocationV3 } from '@/core/imageEdit/v3/commandLayerLocation';
import { createLogger } from '@/core/logging';
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3';
import { renderImageEditorV3ExportTiles } from '../export/renderExportTilesV3';
import { resolveImageEditorV3ExportGeometry } from '../export/geometry';
import { createImageMarkV3ColorMode, prepareImageEditSourceLocatorV3 } from '../application/imageEditSourceV3';
import { resolveImageSource } from '../../application/imageSourceCapabilityService';
import { ensureImageEditDocumentInstanceV3 } from '../application/imageEditDocumentLoading';
import { collectImageEditResourceRolesV3 } from '@/core/imageEdit/v3/resourceRoles';
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import { readDocument } from '@/commands/documents';
import { parseCanvasDocumentGraph } from '@/core/canvas/canvasDocumentGraph';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import { retainSmartContentResourcesV3 } from './resourceLeases';

const logger = createLogger('features.imageEdit.v3.smart_content');
export async function prepareSmartContentMutationV3(bus: ImageEditCommandBusV3, layerId: string,
  draft: { contentType?: 'smart' | 'raster'; smartDocument?: ImageEditDocumentV3; smartOrigin?: ImageEditSmartOriginV3 | null }, signal?: AbortSignal) {
  signal = signal ? AbortSignal.any([signal, bus.getLifecycleSignal()]) : bus.getLifecycleSignal();
  signal.throwIfAborted();
  const before = bus.getSnapshot().document;
  let candidate = before;
  const commands: ImageEditCommandV3[] = [];
  const currentLayer = () => findImageEditCommandLayerLocationV3(candidate.layers, layerId)?.layer;
  if (draft.contentType && draft.contentType !== currentLayer()?.type) {
    const previous = currentLayer();
    const layer = draft.contentType === 'smart' ? embedImageEditRasterV3(candidate, layerId)
      : previous?.type === 'smart' ? rasterizeImageEditSmartLayerV3(previous) : null;
    if (!layer) throw new Error('请选择像素图层或智能对象');
    const command = createImageEditContentReplacementV3(candidate, layer, bus.getResourceByteSizes());
    commands.push(command); candidate = applyImageEditCommandV3(candidate, command).document;
  }
  if (draft.smartDocument === undefined && draft.smartOrigin === undefined) return { commands, release: undefined };
  const layer = currentLayer();
  if (layer?.type !== 'smart') throw new Error('请先把像素图层转换为智能对象');
  if (draft.smartDocument && draft.smartDocument.id !== layer.content.document.id) throw new Error('内容编辑不能替换文档标识');
  if (draft.smartDocument && draft.smartOrigin) throw new Error('编辑内容和替换来源请分别执行');
  const resolved = draft.smartOrigin ? await resolveSmartContentSourceV3(draft.smartOrigin, signal) : null;
  const contentDocument = resolved ? { ...resolved.document, id: layer.content.document.id } : draft.smartDocument ?? layer.content.document;
  const appearance = await prepareSmartContentAppearanceV3(contentDocument, candidate,
    { ...bus.getResourceByteSizes(), ...resolved?.bytes }, signal);
  try {
    signal?.throwIfAborted();
    if (bus.getSnapshot().document !== before) throw new Error('原图片已改变，请重新读取后重试');
    const update = updateImageEditSmartInstancesV3(candidate, { ...layer.content, document: contentDocument,
      origin: draft.smartOrigin === undefined ? layer.content.origin : draft.smartOrigin,
      width: appearance.width, height: appearance.height }, appearance, appearance.bytes);
    commands.push(update);
    const abandon = retainSmartContentResourcesV3(bus, appearance.release);
    const ids = new Set([update.commandId, ...(update.type === 'document.atomic' ? update.commands.map(child => child.commandId) : [])]);
    return { commands, release: async () => {
      let published = false;
      for await (const entry of bus.readHistoryEntries()) {
        if (ids.has(entry.forward.commandId) || (entry.forward.type === 'document.atomic' && entry.forward.commands.some(child => ids.has(child.commandId)))) { published = true; break; }
      }
      if (!published) await abandon();
    } };
  } catch (error) { await appearance.release(); throw error; }
}
export function smartContentDescriptorsV3(document: ImageEditDocumentV3, bytes: Readonly<Record<string, number>>): ImageEditorV3ResourceDescriptor[] {
  const sparse = collectImageEditResourceRolesV3(document).sparse;
  return collectImageEditJsonResourceIdsV3(document).map(resourceRef => ({ resourceRef: resourceRef as ImageEditorV3ResourceDescriptor['resourceRef'],
    byteLength: bytes[resourceRef], mediaType: sparse.has(resourceRef) ? 'application/x-henji-brush-tile-v3' : null }));
}

export async function resolveSmartContentSourceV3(origin: ImageEditSmartOriginV3, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (origin.kind === 'image_edit.document') {
    const id = origin.id.startsWith('v3:') ? decodeURIComponent(origin.id.slice(3)) : origin.id;
    const instance = await ensureImageEditDocumentInstanceV3(id);
    signal?.throwIfAborted();
    return { document: structuredClone(instance.bus.getSnapshot().document), bytes: instance.bus.getResourceByteSizes() };
  }
  let sourceUrl: string;
  if (origin.kind === 'canvas.node') {
    const separator = origin.id.indexOf(':');
    if (separator < 1) throw new Error('请选择带画布归属的节点来源');
    const snapshot = await readDocument({ id: origin.id.slice(0, separator) });
    const node = parseCanvasDocumentGraph(snapshot.content, () => undefined).nodes.find(item => item.id === origin.id.slice(separator + 1));
    if (!node) throw new Error('来源节点已删除，请重新选择来源');
    const session = node.data.imageEditSession;
    if (session && typeof session === 'object' && 'documentRef' in session && typeof session.documentRef === 'string') {
      return resolveSmartContentSourceV3({ kind: 'image_edit.document', id: session.documentRef.replace(/^image-edit-v3:/, '') }, signal);
    }
    if (typeof node.data.imageUrl !== 'string' || !node.data.imageUrl) throw new Error('来源节点尚无可用图片');
    sourceUrl = node.data.imageUrl;
  } else sourceUrl = (await resolveImageSource(origin)).source;
  signal?.throwIfAborted();
  const source = await ingestImageEditorV3Source({ requestId: createImageEditIdV3('smart-source'), source: await prepareImageEditSourceLocatorV3(sourceUrl) }, signal);
  return { document: createImageEditDocumentV3({ width: source.metadata.width, height: source.metadata.height,
    sourceResourceId: source.resource.resourceRef, color: createImageMarkV3ColorMode(source.metadata) }),
  bytes: { [source.resource.resourceRef]: source.resource.byteLength } };
}

/** 沿唯一导出求值器逐块物化，浮点线性缓存不会把原始可编辑文档替换成 PNG。 */
export async function prepareSmartContentAppearanceV3(contentDocument: ImageEditDocumentV3,
  parent: ImageEditDocumentV3, bytes: Readonly<Record<string, number>>, signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
  transformPixels?: (tile: import('@/core/imageEdit/v3/effects/contracts').Float32PremultipliedRgbaTile) => import('@/core/imageEdit/v3/effects/contracts').Float32PremultipliedRgbaTile) {
  signal?.throwIfAborted();
  const decoded = decodeImageEditDocumentV3(contentDocument);
  if (!decoded.document) throw new Error('智能内容无效或包含循环引用');
  const document = decoded.document;
  assertImageEditSmartGraphV3({ ...parent, layers: [{ ...createImageEditLayerCommonV3('candidate', '内容'), type: 'smart',
    source: { kind: 'empty' }, tiles: {}, content: { id: 'candidate', origin: null, document, width: 1, height: 1 } }] });
  const hdr = document.color.hdrMetadata !== null || document.color.transferFunction === 'pq' || document.color.transferFunction === 'hlg';
  // HDR 沿正式 scene-linear Float32 导出；保留原传递函数/参考白，不能用清空元数据伪装 SDR。
  const renderDocument = hdr ? document : { ...document, color: { ...document.color, bitDepth: 'float32' as const } };
  const outputTransfer = hdr ? 'linear' as const : document.color.transferFunction;
  const geometry = resolveImageEditorV3ExportGeometry(document);
  const requestId = createImageEditIdV3('smart-content');
  const resultBytes = { ...bytes };
  const tiles: Record<string, string> = {};
  await pinImageEditorV3RepairResources(requestId, collectImageEditJsonResourceIdsV3(document));
  try {
    for await (const output of renderImageEditorV3ExportTiles({ document: renderDocument, resourceDescriptors: smartContentDescriptorsV3(document, bytes),
      description: { width: geometry.outputWidth, height: geometry.outputHeight, bitDepth: 32, sampleFormat: 'float', colorSpace: document.color.workingSpace,
        transferFunction: outputTransfer, alphaMode: 'straight',
        ...(document.color.iccProfileResourceId ? { iccProfileResourceRef: document.color.iccProfileResourceId as ImageEditorV3ResourceDescriptor['resourceRef'] } : {}) }, tileSize: 512, signal, onTileRendered: onProgress })) {
      signal?.throwIfAborted();
      const buffer = output.pixels instanceof Uint8Array ? output.pixels : new Uint8Array(output.pixels);
      const data = new Float32Array(output.width * output.height * 4);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
        const index = (y * output.width + x) * 4, offset = y * output.rowStride + x * 16;
        const alpha = view.getFloat32(offset + 12, true);
        for (let channel = 0; channel < 3; channel++) data[index + channel] = view.getFloat32(offset + channel * 4, true) * alpha;
        data[index + 3] = alpha;
      }
      // SDR renders Float32 in its original transfer contract so cached brush/smart tiles
      // are never relabelled. Decode that output through the shared kernel before assignment.
      const encodedTile = createFloat32PremultipliedRgbaTile(output.width, output.height, outputTransfer === 'linear' ? 'linear-light' : 'perceptual-working', data,
        document.color.workingSpace, outputTransfer, document.color.hdrMetadata?.referenceWhiteNits ?? 203);
      const sourceTile = convertFloat32TileColorContractV3(encodedTile, { ...encodedTile, colorDomain: 'linear-light' });
      const tile = transformPixels ? transformPixels(sourceTile) : convertFloat32TileColorContractV3(sourceTile, {
        colorDomain: 'linear-light', workingSpace: parent.color.workingSpace, transferFunction: parent.color.transferFunction,
        referenceWhiteNits: parent.color.hdrMetadata?.referenceWhiteNits ?? 203 });
      const tileKey = `0/${output.x / 512}/${output.y / 512}`;
      const saved = await persistImageEditorV3BrushTiles({ requestId: createImageEditIdV3('smart-tile'), tiles: [{ tileKey, tile }] }, signal);
      for (const item of saved.tiles) { tiles[item.tileKey] = item.resourceId; resultBytes[item.resourceId] = item.byteSize; }
      await pinImageEditorV3RepairResources(requestId, saved.tiles.map(item => item.resourceId));
    }
    signal?.throwIfAborted();
    return { source: { kind: 'empty' as const }, tiles, width: geometry.outputWidth, height: geometry.outputHeight, bytes: resultBytes,
      release: () => releaseImageEditorV3RepairResources(requestId) };
  } catch (error) { await releaseImageEditorV3RepairResources(requestId); throw error; }
}

export function convertSmartContentV3(bus: ImageEditCommandBusV3, layerId: string, type: 'smart' | 'raster'): string {
  const document = bus.getSnapshot().document;
  const previous = findImageEditCommandLayerLocationV3(document.layers, layerId)?.layer;
  const layer = type === 'smart' ? embedImageEditRasterV3(document, layerId)
    : previous?.type === 'smart' ? rasterizeImageEditSmartLayerV3(previous) : null;
  if (!layer) throw new Error('请选择一个智能对象进行栅格化');
  const command = createImageEditContentReplacementV3(document, layer, bus.getResourceByteSizes());
  bus.dispatch(command); return command.commandId;
}

export async function updateSmartContentV3(bus: ImageEditCommandBusV3, layerId: string, contentDocument: ImageEditDocumentV3,
  options: { origin?: ImageEditSmartOriginV3 | null; expectedContent?: ImageEditSmartContentV3; bytes?: Readonly<Record<string, number>>; signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void; confirm?: () => Promise<void> } = {}): Promise<string> {
  const parent = bus.getSnapshot().document;
  const layer = findImageEditCommandLayerLocationV3(parent.layers, layerId)?.layer;
  if (layer?.type !== 'smart') throw new Error('智能对象已删除，请返回原图片核对');
  const signal = options.signal ? AbortSignal.any([options.signal, bus.getLifecycleSignal()]) : bus.getLifecycleSignal();
  logger.info('开始更新智能内容', { event: 'image_edit.smart_content.update.start', context: { documentId: parent.id, layerId } });
  let applied = false;
  let release: (() => Promise<void>) | undefined;
  try {
    if (options.expectedContent && JSON.stringify(layer.content) !== JSON.stringify(options.expectedContent)) {
      throw new Error('原图片中的智能内容已更新，请返回后重新打开内容');
    }
    const appearance = await prepareSmartContentAppearanceV3(contentDocument, parent,
      { ...bus.getResourceByteSizes(), ...options.bytes }, signal, options.onProgress);
    release = appearance.release;
    signal.throwIfAborted();
    if (bus.getSnapshot().document !== parent) throw new Error('原图片已改变，保留内容修改，请核对后重试');
    const command = updateImageEditSmartInstancesV3(parent, { ...layer.content, document: structuredClone(contentDocument),
      origin: options.origin === undefined ? layer.content.origin : options.origin, width: appearance.width, height: appearance.height },
    appearance, appearance.bytes);
    bus.dispatch(command);
    applied = true;
    retainSmartContentResourcesV3(bus, appearance.release);
    await options.confirm?.();
    logger.info('智能内容已更新', { event: 'image_edit.smart_content.update.completed', context: { documentId: parent.id, layerId } });
    return command.commandId;
  } catch (error) { logger.error('智能内容更新失败，保留修改供核对或重试', error, { event: 'image_edit.smart_content.update.failed' }); throw error; }
  finally { if (!applied) await release?.(); }
}
