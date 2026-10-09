import { createImageEditAdjustmentLayerV3, createImageEditEffectLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { imageEditLayerFilterSchemaV3, imageEditLayerFiltersSchemaV3 } from '@/core/imageEdit/v3/layerModel/semantics';
import { filterStackCacheIdentity, moveFilter, removeFilter, updateFilter } from '@/core/imaging/filterStack';
import type { ImageEditLayerFilterV3, ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes';
import { createLogger } from '@/core/logging';
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import { findImageEditV3LiveLayer } from '../application/imageEditDocumentRefs';
import { materializeImageEditSelectionMaskV3 } from '../application/imageEditSelectionServiceV3';
import { imageEditFilterDefaultsV3, type ImageEditFilterChoiceV3 } from './catalog';
import { planImageEditFilterConversionV3 } from './conversion';

const logger = createLogger('features.imageEdit.filter_workspace');

function editable(bus: ImageEditCommandBusV3, layerId: string) {
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId);
  if (!location) throw new Error('请选择要应用滤镜的图层');
  if (location.layer.locked || location.ancestors.some(layer => layer.locked)) throw new Error('请先解锁图层及其父组');
  return location;
}

export function imageEditFilterWorkspaceIdentityV3(bus: ImageEditCommandBusV3, layerId: string): string {
  const { document } = bus.getSnapshot();
  const location = editable(bus, layerId);
  return filterStackCacheIdentity(location.layer.filters, {
    target: { kind: 'image_edit.layer', id: layerId }, sourceVersion: String(document.revision), time: { kind: 'static' },
    referenceGrid: document.geometry, roi: { x: 0, y: 0, width: document.geometry.width, height: document.geometry.height },
    quality: 'final', color: { workingSpace: document.color.workingSpace, transferFunction: document.color.transferFunction,
      alpha: 'premultiplied', precision: 'float32' },
  });
}

export function changeImageEditFilterV3(bus: ImageEditCommandBusV3, layerId: string, filterId: string,
  change: { kind: 'update'; patch: Partial<Omit<ImageEditLayerFilterV3, 'id'>> } | { kind: 'move'; index: number } | { kind: 'remove' }): void {
  const { layer } = editable(bus, layerId);
  const next = change.kind === 'move' ? moveFilter(layer.filters, filterId, change.index)
    : change.kind === 'remove' ? removeFilter(layer.filters, filterId) : updateFilter(layer.filters, filterId, change.patch);
  bus.dispatch({ type: 'layer.update-common', commandId: createImageEditIdV3('filter-change'),
    expectedRevision: bus.getSnapshot().document.revision, layerId, patch: { filters: imageEditLayerFiltersSchemaV3.parse(next) }, resources: collectImageEditJsonResourceIdsV3([layer.filters, next]).map(resourceId => ({ resourceId, byteSize: bus.getResourceByteSizes()[resourceId] })) });
}

/** Filters run after the target's transform, in its parent's composite grid. */
export async function addImageEditFilterV3(bus: ImageEditCommandBusV3, layerId: string, choice: ImageEditFilterChoiceV3,
  scope: 'content' | 'below', title: string, options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {}): Promise<string> {
  if (!choice.available) throw new Error(choice.reason ?? '此滤镜暂时不可用，请选择其他滤镜');
  const location = editable(bus, layerId);
  if (scope === 'content' && (location.layer.type === 'effect' || location.layer.type === 'adjustment')) throw new Error('请选择像素图层或图层组后添加图层滤镜');
  const start = bus.getSnapshot();
  const identity = imageEditFilterWorkspaceIdentityV3(bus, layerId);
  const id = createImageEditIdV3(scope === 'content' ? 'filter' : 'layer');
  const params = imageEditFilterDefaultsV3(choice, start.document.color.workingSpace);
  const layer = choice.kind === 'effect' ? createImageEditEffectLayerV3(id, title, choice.id, params)
    : createImageEditAdjustmentLayerV3(id, title, choice.id, params);
  const cancellation = new AbortController();
  const signals = options.signal ? [options.signal, bus.getLifecycleSignal()] : [bus.getLifecycleSignal()];
  const cancel = (): void => cancellation.abort();
  for (const signal of signals) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }
  const signal = cancellation.signal;
  let wroteMask = false;
  logger.info('添加滤镜开始', { event: 'image_edit.filter.add.start', context: { layerId, scope, effectId: choice.id } });
  try {
    signal.throwIfAborted();
    const selection = start.selection ? await materializeImageEditSelectionMaskV3(bus, layer, location.parentId, 'replace', signal, options.onProgress) : null;
    wroteMask = Boolean(selection);
    signal.throwIfAborted();
    if (imageEditFilterWorkspaceIdentityV3(bus, layerId) !== identity || bus.getSnapshot().selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新应用滤镜');
    const commandId = createImageEditIdV3('filter-add');
    if (scope === 'content') {
      const filter = imageEditLayerFilterSchemaV3.parse({ id, operationType: choice.kind, effectId: choice.id, params,
        enabled: true, opacity: 1, blendMode: 'normal', mask: selection?.mask ?? null });
      const filters = [...location.layer.filters, filter];
      const sizes = { ...bus.getResourceByteSizes(), ...Object.fromEntries(selection?.resources.map(resource => [resource.resourceId, resource.byteSize]) ?? []) };
      const resources = collectImageEditJsonResourceIdsV3([location.layer.filters, filters]).map(resourceId => ({ resourceId, byteSize: sizes[resourceId] }));
      bus.dispatch({ type: 'layer.update-common', commandId, expectedRevision: start.document.revision, layerId,
        patch: { filters }, resources });
    } else {
      bus.dispatch({ type: 'layer.add', commandId, expectedRevision: start.document.revision, parentId: location.parentId, index: location.index + 1,
        layer: { ...layer, mask: selection?.mask ?? null }, ...(selection ? { resources: selection.resources } : {}) });
    }
    logger.info('添加滤镜完成', { event: 'image_edit.filter.add.completed', context: { layerId, scope, effectId: choice.id } });
    return id;
  } catch (error) {
    logger.error('添加滤镜失败', error, { event: 'image_edit.filter.add.failed' });
    if (wroteMask) {
      const snapshot = bus.getPersistenceSnapshot();
      try { await new ImageEditorV3CommandRepository().collectGarbage(snapshot.document.id,
        collectImageEditJsonResourceIdsV3(snapshot.document, snapshot.retainedResources.map(resource => resource.resourceId))); }
      catch (cause) { logger.warn('滤镜临时蒙版回收失败', { event: 'image_edit.filter.gc.failed', error: cause }); }
    }
    throw error;
  } finally { for (const source of signals) source.removeEventListener('abort', cancel); }
}

export function imageEditFilterParametersV3(bus: ImageEditCommandBusV3, layerId: string, filterId: string, params: ImageEditJsonObjectV3): void {
  changeImageEditFilterV3(bus, layerId, filterId, { kind: 'update', patch: { params } });
}

/** Read-only plan shown by the confirmation UI; the same plan is committed atomically. */
export function prepareImageEditFilterConversionV3(bus: ImageEditCommandBusV3, request: Parameters<typeof planImageEditFilterConversionV3>[1]) {
  return planImageEditFilterConversionV3(bus.getSnapshot().document, request, bus.getResourceByteSizes());
}

export function commitImageEditFilterConversionV3(bus: ImageEditCommandBusV3, plan: ReturnType<typeof prepareImageEditFilterConversionV3>): string {
  if (bus.getSnapshot().document.id !== plan.documentId) throw new Error('图片文档已变化，请重新准备转换');
  const commandId = createImageEditIdV3('filter-convert');
  bus.dispatch({ type: 'document.atomic', commandId, expectedRevision: plan.expectedRevision, commands: plan.commands });
  return commandId;
}

/** Snapshot in the same parent grid as ordinary layer filters; subsequent selection edits are independent. */
export async function snapshotImageEditFilterSelectionV3(bus: ImageEditCommandBusV3, layerId: string, filterId: string, signal?: AbortSignal): Promise<string> {
  const location = editable(bus, layerId), start = bus.getSnapshot();
  if (!location.layer.filters.some(filter => filter.id === filterId)) throw new Error('滤镜不存在，请重新读取');
  const target = createImageEditEffectLayerV3(createImageEditIdV3('filter-grid'), '', 'blur', {});
  const result = await materializeImageEditSelectionMaskV3(bus, target, location.parentId, 'replace', signal);
  try {
    signal?.throwIfAborted();
    if (bus.getSnapshot().document.revision !== start.document.revision || bus.getSnapshot().selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新应用');
    const filters = updateFilter(location.layer.filters, filterId, { mask: result.mask });
    const sizes = { ...bus.getResourceByteSizes(), ...Object.fromEntries(result.resources.map(resource => [resource.resourceId, resource.byteSize])) };
    const commandId = createImageEditIdV3('filter-selection');
    bus.dispatch({ type: 'layer.update-common', commandId, expectedRevision: start.document.revision, layerId, patch: { filters },
      resources: collectImageEditJsonResourceIdsV3([location.layer.filters, filters]).map(resourceId => ({ resourceId, byteSize: sizes[resourceId] })) });
    return commandId;
  } catch (error) {
    const snapshot = bus.getPersistenceSnapshot();
    try { await new ImageEditorV3CommandRepository().collectGarbage(snapshot.document.id, collectImageEditJsonResourceIdsV3(snapshot.document, snapshot.retainedResources.map(resource => resource.resourceId))); }
    catch (cause) { logger.warn('滤镜临时蒙版回收失败', { event: 'image_edit.filter.gc.failed', error: cause }); }
    throw error;
  }
}
