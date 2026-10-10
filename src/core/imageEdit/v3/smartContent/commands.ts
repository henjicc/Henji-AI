import { createImageEditDocumentV3, createImageEditIdV3 } from '../documentFactory';
import type { ImageEditDocumentV3 } from '../documentTypes';
import { createImageEditLayerCommonV3, type ImageEditLayerV3 } from '../layerTypes';
import type { ImageEditCommandResourceDescriptorV3, ImageEditCommandV3, ImageEditLayerReplaceCommandV3 } from '../commandTypes';
import { collectImageEditJsonResourceIdsV3 } from '../resourceReferences';
import { findImageEditCommandLayerLocationV3 } from '../commandLayerLocation';
import { assertImageEditSmartGraphV3, listImageEditSmartInstancesV3 } from './graph';
import type { ImageEditSmartContentV3, ImageEditSmartLayerV3 } from './types';
export function createEmptyImageEditSmartLayerV3(parent: ImageEditDocumentV3, id: string, name: string): ImageEditSmartLayerV3 {
  return { ...createImageEditLayerCommonV3(id, name), type: 'smart', source: { kind: 'empty' }, tiles: {},
    content: { id: createImageEditIdV3('content'), origin: null, width: parent.geometry.width, height: parent.geometry.height,
      document: createImageEditDocumentV3({ width: parent.geometry.width, height: parent.geometry.height, color: structuredClone(parent.color) }) } };
}

export function embedImageEditRasterV3(document: ImageEditDocumentV3, layerId: string): ImageEditSmartLayerV3 {
  const layer = findImageEditCommandLayerLocationV3(document.layers, layerId)?.layer;
  if (layer?.type !== 'raster') throw new Error('请选择一个像素图层转换为智能对象');
  const { rasterCanvasSize, ...instance } = structuredClone(layer);
  const size = rasterCanvasSize ?? document.geometry;
  const contentDocument = createImageEditDocumentV3({ width: size.width, height: size.height,
    color: structuredClone(document.color) });
  const innerLayer = { ...structuredClone(layer), ...createImageEditLayerCommonV3(createImageEditIdV3('layer'), layer.name) };
  delete innerLayer.deformation;
  contentDocument.layers = [innerLayer];
  return { ...instance, type: 'smart', content: { id: createImageEditIdV3('content'), origin: null,
    document: contentDocument, width: size.width, height: size.height } };
}

export function createImageEditContentReplacementV3(document: ImageEditDocumentV3, layer: ImageEditLayerV3,
  byteSizes: Readonly<Record<string, number>>, commandId = createImageEditIdV3('command')): ImageEditLayerReplaceCommandV3 {
  const previous = findImageEditCommandLayerLocationV3(document.layers, layer.id)?.layer;
  if (!previous) throw new Error('图层已删除，请返回原图片核对');
  assertImageEditSmartGraphV3({ ...document, layers: [layer] });
  const resources: ImageEditCommandResourceDescriptorV3[] = collectImageEditJsonResourceIdsV3([previous, layer]).map(resourceId => {
    const byteSize = byteSizes[resourceId];
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error('内容资源缺失，请重新定位来源后再试');
    return { resourceId, byteSize };
  });
  return { type: 'layer.replace', commandId, expectedRevision: document.revision, layerId: layer.id, layer, resources };
}

/** 更新同一内容的全部实例；实例的变换、蒙版和 R13 滤镜保持原值。 */
export function updateImageEditSmartInstancesV3(document: ImageEditDocumentV3, content: ImageEditSmartContentV3,
  appearance: Pick<ImageEditSmartLayerV3, 'source' | 'tiles'>, byteSizes: Readonly<Record<string, number>>): ImageEditCommandV3 {
  const instances = listImageEditSmartInstancesV3(document.layers).filter(layer => layer.content.id === content.id
    || (content.origin !== null && layer.content.origin?.kind === content.origin.kind && layer.content.origin.id === content.origin.id));
  if (!instances.length) throw new Error('智能对象已删除，请返回原图片核对');
  const commands = instances.map(layer => createImageEditContentReplacementV3(document,
    { ...layer, source: { ...appearance.source }, tiles: { ...appearance.tiles }, content: structuredClone(content) }, byteSizes));
  return { type: 'document.atomic', commandId: createImageEditIdV3('command'), expectedRevision: document.revision, commands };
}

export function rasterizeImageEditSmartLayerV3(layer: ImageEditSmartLayerV3): ImageEditLayerV3 {
  const { content: _content, ...appearance } = layer;
  return { ...appearance, type: 'raster', rasterCanvasSize: { width: layer.content.width, height: layer.content.height } };
}
