import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import { createImageEditAdjustmentLayerV3, createImageEditEffectLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { IMAGE_EDIT_IDENTITY_TRANSFORM_V3 } from '@/core/imageEdit/v3/layerTypes';
import { imageEditLayerFilterSchemaV3 } from '@/core/imageEdit/v3/layerModel/semantics';
import { removeFilter } from '@/core/imaging/filterStack';
import { collectImageEditLayerResourceIdsForCommandV3, type ImageEditLeafCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import { findImageEditLayerLocationV3, isImageEditLayerLocationEditableV3 } from '../editor/layerTreeV3';

export interface ImageEditFilterConversionPlanV3 {
  documentId: string;
  expectedRevision: number;
  commands: ImageEditLeafCommandV3[];
  resultLayerId: string;
  resultFilterId: string | null;
  beforeTargets: string[];
  afterTargets: string[];
  changesOrder: boolean;
}

export function planImageEditFilterConversionV3(document: ImageEditDocumentV3,
  request: { direction: 'content-to-composite'; layerId: string; filterId: string; title: string } | { direction: 'composite-to-content'; layerId: string; targetLayerId: string },
  resourceByteSizes: Readonly<Record<string, number>>): ImageEditFilterConversionPlanV3 {
  const source = findImageEditLayerLocationV3(document.layers, request.layerId);
  if (!source || !isImageEditLayerLocationEditableV3(source)) throw new Error('请选择未锁定的滤镜或图层');
  const base = { expectedRevision: document.revision, commandId: createImageEditIdV3('filter-conversion') };
  const descriptors = (ids: string[]) => ids.map(resourceId => {
    const byteSize = resourceByteSizes[resourceId];
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error('蒙版资源信息不完整，请重新打开文档');
    return { resourceId, byteSize };
  });
  if (request.direction === 'content-to-composite') {
    const filter = source.layer.filters.find(item => item.id === request.filterId);
    if (!filter) throw new Error('滤镜不存在，请重新选择');
    const id = createImageEditIdV3('filter-layer');
    const layer = filter.operationType === 'effect' ? createImageEditEffectLayerV3(id, request.title, filter.effectId, structuredClone(filter.params), filter.enabled)
      : createImageEditAdjustmentLayerV3(id, request.title, filter.effectId, structuredClone(filter.params), filter.enabled);
    layer.mask = structuredClone(filter.mask); layer.opacity = filter.opacity; layer.blendMode = filter.blendMode;
    return { documentId: document.id, expectedRevision: document.revision, resultLayerId: id, resultFilterId: null,
      beforeTargets: [source.layer.name], afterTargets: source.container.slice(0, source.index + 1).map(item => item.name),
      changesOrder: source.layer.filters.at(-1)?.id !== filter.id,
      commands: [
        { ...base, type: 'layer.update-common', layerId: source.layer.id, patch: { filters: removeFilter(source.layer.filters, filter.id) }, resources: descriptors(collectImageEditJsonResourceIdsV3(source.layer.filters)) },
        { ...base, commandId: createImageEditIdV3('filter-conversion-add'), expectedRevision: document.revision + 1,
          type: 'layer.add', parentId: source.parentId, index: source.index + 1, layer,
          resources: descriptors(collectImageEditLayerResourceIdsForCommandV3(layer)) },
      ] };
  }
  const layer = source.layer;
  if (layer.type !== 'effect' && layer.type !== 'adjustment') throw new Error('请选择滤镜图层或调整图层');
  const target = findImageEditLayerLocationV3(document.layers, request.targetLayerId);
  if (!target || !isImageEditLayerLocationEditableV3(target) || target.parentId !== source.parentId || target.index !== source.index - 1
    || target.layer.type === 'effect' || target.layer.type === 'adjustment') throw new Error('请选择同组紧邻下方的像素图层或图层组');
  if (layer.clipping || layer.fillOpacity !== 1 || layer.maskAttachment.density !== 1
    || (layer.mask !== null && !layer.maskAttachment.enabled) || layer.filters.length > 0 || layer.maskAttachment.linked === false
    || layer.transform.some((value, index) => value !== IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index])
    || layer.maskAttachment.transform.some((value, index) => value !== IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index])) {
    throw new Error('请先恢复滤镜图层的变换、填充与蒙版浓度，再转换挂载范围');
  }
  const filter = imageEditLayerFilterSchemaV3.parse({ id: createImageEditIdV3('filter'), operationType: layer.type,
    effectId: layer.type === 'effect' ? layer.effectId : layer.adjustmentId, params: structuredClone(layer.params),
    enabled: layer.visible && layer.renderable, opacity: layer.opacity, blendMode: layer.blendMode,
    mask: layer.maskAttachment.enabled ? structuredClone(layer.mask) : null });
  return { documentId: document.id, expectedRevision: document.revision, resultLayerId: target.layer.id, resultFilterId: filter.id,
    beforeTargets: source.container.slice(0, source.index).map(item => item.name), afterTargets: [target.layer.name], changesOrder: false,
    commands: [
      { ...base, type: 'layer.update-common', layerId: target.layer.id, patch: { filters: [...target.layer.filters, filter] }, resources: descriptors(collectImageEditJsonResourceIdsV3([target.layer.filters, filter])) },
      { ...base, commandId: createImageEditIdV3('filter-conversion-remove'), expectedRevision: document.revision + 1,
        type: 'layer.delete', layerId: layer.id, resources: descriptors(collectImageEditLayerResourceIdsForCommandV3(layer)) },
    ] };
}
