import { sanitizeMarkItem } from '../markCodec';
import {
  IMAGE_EDIT_BLEND_MODES_V3,
  collectImageEditLayerIdsV3,
  type ImageEditGroupLayerV3,
  type ImageEditJsonObjectV3,
  type ImageEditLayerCommonV3,
  type ImageEditLayerV3,
} from './layerTypes';
import type { ImageEditDocumentV3 } from './documentTypes';
import type {
  ImageEditCommandApplyResultV3,
  ImageEditCommandV3,
  ImageEditLayerCommonPatchV3,
  ImageEditRasterTileDeltaCommandV3,
} from './commandTypes';
import { cloneImageEditJsonObjectV3 } from './documentCodec';

export class ImageEditRevisionConflictErrorV3 extends Error {}
export class ImageEditCommandValidationErrorV3 extends Error {}
export class ImageEditLayerLockedErrorV3 extends Error {}

interface LayerLocation {
  layer: ImageEditLayerV3;
  parentId: string | null;
  index: number;
  ancestors: ImageEditGroupLayerV3[];
}

function findLayerLocation(
  layers: readonly ImageEditLayerV3[],
  layerId: string,
  parentId: string | null = null,
  ancestors: ImageEditGroupLayerV3[] = []
): LayerLocation | null {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer.id === layerId) return { layer, parentId, index, ancestors };
    if (layer.type === 'group') {
      const nested = findLayerLocation(layer.children, layerId, layer.id, [...ancestors, layer]);
      if (nested) return nested;
    }
  }
  return null;
}

function getContainer(
  layers: readonly ImageEditLayerV3[],
  parentId: string | null
): readonly ImageEditLayerV3[] {
  if (parentId === null) return layers;
  const location = findLayerLocation(layers, parentId);
  if (!location || location.layer.type !== 'group') {
    throw new ImageEditCommandValidationErrorV3(`目标组不存在：${parentId}`);
  }
  return location.layer.children;
}

function replaceContainer(
  layers: readonly ImageEditLayerV3[],
  parentId: string | null,
  replacement: ImageEditLayerV3[]
): ImageEditLayerV3[] {
  if (parentId === null) return replacement;
  let found = false;
  const visit = (entries: readonly ImageEditLayerV3[]): ImageEditLayerV3[] => entries.map((layer) => {
    if (layer.id === parentId) {
      if (layer.type !== 'group') throw new ImageEditCommandValidationErrorV3(`目标不是组：${parentId}`);
      found = true;
      return { ...layer, children: replacement };
    }
    if (layer.type !== 'group') return layer;
    const children = visit(layer.children);
    return children === layer.children ? layer : { ...layer, children };
  });
  const next = visit(layers);
  if (!found) throw new ImageEditCommandValidationErrorV3(`目标组不存在：${parentId}`);
  return next;
}

function assertIndex(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > length) {
    throw new ImageEditCommandValidationErrorV3(`图层位置越界：${index}`);
  }
}

function assertLayerEditable(location: LayerLocation): void {
  if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
    throw new ImageEditLayerLockedErrorV3(`图层已锁定：${location.layer.id}`);
  }
}

function assertContainerEditable(layers: readonly ImageEditLayerV3[], parentId: string | null): void {
  if (parentId === null) return;
  const location = findLayerLocation(layers, parentId);
  if (!location || location.layer.type !== 'group') {
    throw new ImageEditCommandValidationErrorV3(`目标组不存在：${parentId}`);
  }
  assertLayerEditable(location);
}

function containsLayerId(layer: ImageEditLayerV3, layerId: string): boolean {
  return layer.id === layerId || (layer.type === 'group' && layer.children.some(
    (child) => containsLayerId(child, layerId)
  ));
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as unknown as T;
}

function cloneLayer(layer: ImageEditLayerV3, idMap?: Readonly<Record<string, string>>): ImageEditLayerV3 {
  const id = idMap ? idMap[layer.id] : layer.id;
  if (!id) throw new ImageEditCommandValidationErrorV3(`缺少副本 ID：${layer.id}`);
  const common: ImageEditLayerCommonV3 = {
    id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    transform: [...layer.transform],
    mask: layer.mask ? { ...layer.mask } : null,
  };
  if (layer.type === 'raster') {
    return { ...common, type: 'raster', source: { ...layer.source }, tiles: { ...layer.tiles } };
  }
  if (layer.type === 'annotation') {
    return { ...common, type: 'annotation', annotations: jsonClone(layer.annotations) };
  }
  if (layer.type === 'effect') {
    return {
      ...common,
      type: 'effect',
      effectId: layer.effectId,
      params: jsonClone<ImageEditJsonObjectV3>(layer.params),
      renderable: layer.renderable,
      ...(layer.legacyOperation ? { legacyOperation: jsonClone(layer.legacyOperation) } : {}),
    };
  }
  if (layer.type === 'adjustment') {
    return {
      ...common,
      type: 'adjustment',
      adjustmentId: layer.adjustmentId,
      params: jsonClone<ImageEditJsonObjectV3>(layer.params),
      renderable: layer.renderable,
    };
  }
  return {
    ...common,
    type: 'group',
    isolated: layer.isolated,
    children: layer.children.map((child) => cloneLayer(child, idMap)),
  };
}

function assertTreeIdsAvailable(
  layers: readonly ImageEditLayerV3[],
  candidate: ImageEditLayerV3
): void {
  const existing = new Set(collectImageEditLayerIdsV3(layers));
  const candidateIds = collectImageEditLayerIdsV3([candidate]);
  const unique = new Set(candidateIds);
  if (candidateIds.length !== unique.size || candidateIds.some((id) => !id || existing.has(id))) {
    throw new ImageEditCommandValidationErrorV3('新增图层包含重复或无效 ID');
  }
}

function insertLayer(
  layers: readonly ImageEditLayerV3[],
  parentId: string | null,
  index: number,
  layer: ImageEditLayerV3
): ImageEditLayerV3[] {
  const container = [...getContainer(layers, parentId)];
  assertIndex(index, container.length);
  container.splice(index, 0, layer);
  return replaceContainer(layers, parentId, container);
}

function removeLayer(
  layers: readonly ImageEditLayerV3[],
  location: LayerLocation
): ImageEditLayerV3[] {
  const container = [...getContainer(layers, location.parentId)];
  container.splice(location.index, 1);
  return replaceContainer(layers, location.parentId, container);
}

function replaceLayer(
  layers: readonly ImageEditLayerV3[],
  location: LayerLocation,
  replacement: ImageEditLayerV3
): ImageEditLayerV3[] {
  const container = [...getContainer(layers, location.parentId)];
  container[location.index] = replacement;
  return replaceContainer(layers, location.parentId, container);
}

function inverseBase(command: ImageEditCommandV3, revision: number): Pick<ImageEditCommandV3, 'commandId' | 'expectedRevision'> {
  return { commandId: `${command.commandId}:inverse`, expectedRevision: revision };
}

function normalizeCommonPatch(patch: ImageEditLayerCommonPatchV3): ImageEditLayerCommonPatchV3 {
  const allowedKeys = new Set(['name', 'visible', 'locked', 'opacity', 'blendMode', 'transform']);
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !allowedKeys.has(key))) {
    throw new ImageEditCommandValidationErrorV3('图层公共属性补丁为空或包含未知字段');
  }
  if (patch.name !== undefined && typeof patch.name !== 'string') throw new ImageEditCommandValidationErrorV3('图层名称无效');
  if (patch.visible !== undefined && typeof patch.visible !== 'boolean') throw new ImageEditCommandValidationErrorV3('图层显隐值无效');
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') throw new ImageEditCommandValidationErrorV3('图层锁定值无效');
  if (patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)) {
    throw new ImageEditCommandValidationErrorV3('图层不透明度必须在 0～1 之间');
  }
  if (patch.blendMode !== undefined && !IMAGE_EDIT_BLEND_MODES_V3.includes(patch.blendMode)) {
    throw new ImageEditCommandValidationErrorV3('图层混合模式无效');
  }
  if (patch.transform !== undefined && (patch.transform.length !== 6 || !patch.transform.every(Number.isFinite))) {
    throw new ImageEditCommandValidationErrorV3('图层变换无效');
  }
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.visible === undefined ? {} : { visible: patch.visible }),
    ...(patch.locked === undefined ? {} : { locked: patch.locked }),
    ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
    ...(patch.blendMode === undefined ? {} : { blendMode: patch.blendMode }),
    ...(patch.transform === undefined ? {} : { transform: [...patch.transform] }),
  };
}

function applyLayerCommand(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  nextRevision: number
): { layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3; pixelBytes?: number } {
  const base = inverseBase(command, nextRevision);
  if (command.type === 'layer.add') {
    assertContainerEditable(document.layers, command.parentId);
    const layer = cloneLayer(command.layer);
    if (layer.locked) throw new ImageEditCommandValidationErrorV3('不能直接添加已锁定的图层');
    assertTreeIdsAvailable(document.layers, layer);
    return {
      layers: insertLayer(document.layers, command.parentId, command.index, layer),
      inverse: { ...base, type: 'layer.delete', layerId: layer.id },
    };
  }
  if (command.type === 'layer.delete') {
    const location = findLayerLocation(document.layers, command.layerId);
    if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${command.layerId}`);
    assertLayerEditable(location);
    return {
      layers: removeLayer(document.layers, location),
      inverse: {
        ...base,
        type: 'layer.add',
        parentId: location.parentId,
        index: location.index,
        layer: cloneLayer(location.layer),
      },
    };
  }
  if (command.type === 'layer.move') {
    const location = findLayerLocation(document.layers, command.layerId);
    if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${command.layerId}`);
    assertLayerEditable(location);
    assertContainerEditable(document.layers, command.parentId);
    if (command.parentId && containsLayerId(location.layer, command.parentId)) {
      throw new ImageEditCommandValidationErrorV3('不能把组移动到自身或后代中');
    }
    const without = removeLayer(document.layers, location);
    const moved = insertLayer(without, command.parentId, command.index, location.layer);
    return {
      layers: moved,
      inverse: { ...base, type: 'layer.move', layerId: command.layerId, parentId: location.parentId, index: location.index },
    };
  }
  if (command.type === 'layer.duplicate') {
    const location = findLayerLocation(document.layers, command.layerId);
    if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${command.layerId}`);
    assertLayerEditable(location);
    assertContainerEditable(document.layers, command.parentId);
    const duplicate = cloneLayer(location.layer, command.idMap);
    assertTreeIdsAvailable(document.layers, duplicate);
    return {
      layers: insertLayer(document.layers, command.parentId, command.index, duplicate),
      inverse: { ...base, type: 'layer.delete', layerId: duplicate.id },
    };
  }
  if (command.type === 'layer.group') {
    if (command.layerIds.length === 0 || command.group.children.length > 0 || command.group.locked) {
      throw new ImageEditCommandValidationErrorV3('分组命令必须提供图层且目标组必须为空');
    }
    const locations = command.layerIds.map((id) => findLayerLocation(document.layers, id));
    if (locations.some((entry) => !entry)) throw new ImageEditCommandValidationErrorV3('待分组图层不存在');
    const resolved = locations as LayerLocation[];
    const parentId = resolved[0].parentId;
    if (resolved.some((entry) => entry.parentId !== parentId)) throw new ImageEditCommandValidationErrorV3('只能分组同一容器中的图层');
    resolved.forEach(assertLayerEditable);
    const ordered = [...resolved].sort((left, right) => left.index - right.index);
    if (ordered.some((entry, index) => index > 0 && entry.index !== ordered[index - 1].index + 1)) {
      throw new ImageEditCommandValidationErrorV3('只能分组连续图层');
    }
    const group = { ...cloneLayer(command.group), children: ordered.map((entry) => entry.layer) } as ImageEditGroupLayerV3;
    assertTreeIdsAvailable(document.layers, { ...group, children: [] });
    const container = [...getContainer(document.layers, parentId)];
    container.splice(ordered[0].index, ordered.length, group);
    return {
      layers: replaceContainer(document.layers, parentId, container),
      inverse: { ...base, type: 'layer.ungroup', groupId: group.id },
    };
  }
  if (command.type === 'layer.ungroup') {
    const location = findLayerLocation(document.layers, command.groupId);
    if (!location || location.layer.type !== 'group') throw new ImageEditCommandValidationErrorV3('待解散的组不存在');
    assertLayerEditable(location);
    if (location.layer.children.some((child) => child.locked)) throw new ImageEditLayerLockedErrorV3('组内包含锁定图层');
    const container = [...getContainer(document.layers, location.parentId)];
    container.splice(location.index, 1, ...location.layer.children);
    return {
      layers: replaceContainer(document.layers, location.parentId, container),
      inverse: {
        ...base,
        type: 'layer.group',
        layerIds: location.layer.children.map((child) => child.id),
        group: { ...cloneLayer(location.layer), children: [] } as ImageEditGroupLayerV3,
      },
    };
  }
  return applyLayerContentCommand(document, command, nextRevision);
}

function applyLayerContentCommand(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  nextRevision: number
): { layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3; pixelBytes?: number } {
  const base = inverseBase(command, nextRevision);
  const layerId = 'layerId' in command ? command.layerId : '';
  const location = findLayerLocation(document.layers, layerId);
  if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${layerId}`);
  if (command.type === 'layer.update-common') {
    const patch = normalizeCommonPatch(command.patch);
    const keys = Object.keys(patch) as (keyof ImageEditLayerCommonPatchV3)[];
    if (location.layer.locked && keys.some((key) => key !== 'locked')) throw new ImageEditLayerLockedErrorV3(`图层已锁定：${layerId}`);
    if (location.ancestors.some((ancestor) => ancestor.locked)) throw new ImageEditLayerLockedErrorV3(`图层所在组已锁定：${layerId}`);
    const inversePatch: ImageEditLayerCommonPatchV3 = {};
    for (const key of keys) {
      Object.assign(inversePatch, { [key]: location.layer[key] });
    }
    const nextLayer = { ...location.layer, ...patch } as ImageEditLayerV3;
    return { layers: replaceLayer(document.layers, location, nextLayer), inverse: { ...base, type: 'layer.update-common', layerId, patch: inversePatch } };
  }
  assertLayerEditable(location);
  if (command.type === 'layer.update-params') {
    if (location.layer.type !== 'effect' && location.layer.type !== 'adjustment') {
      throw new ImageEditCommandValidationErrorV3('目标不是效果或调整图层');
    }
    if (!location.layer.renderable) {
      throw new ImageEditCommandValidationErrorV3('不可渲染的兼容图层不能修改参数');
    }
    const params = cloneImageEditJsonObjectV3(command.params);
    if (!params) throw new ImageEditCommandValidationErrorV3('图层参数不是安全 JSON 对象');
    return {
      layers: replaceLayer(document.layers, location, { ...location.layer, params }),
      inverse: {
        ...base,
        type: 'layer.update-params',
        layerId,
        params: jsonClone(location.layer.params),
      },
    };
  }
  if (command.type === 'group.update-isolation') {
    if (location.layer.type !== 'group') {
      throw new ImageEditCommandValidationErrorV3('目标不是图层组');
    }
    return {
      layers: replaceLayer(document.layers, location, { ...location.layer, isolated: command.isolated }),
      inverse: {
        ...base,
        type: 'group.update-isolation',
        layerId,
        isolated: location.layer.isolated,
      },
    };
  }
  if (command.type === 'layer.set-mask') {
    if (command.mask && (!command.mask.resourceId || typeof command.mask.inverted !== 'boolean')) {
      throw new ImageEditCommandValidationErrorV3('蒙版引用无效');
    }
    return {
      layers: replaceLayer(document.layers, location, { ...location.layer, mask: command.mask ? { ...command.mask } : null }),
      inverse: { ...base, type: 'layer.set-mask', layerId, mask: location.layer.mask ? { ...location.layer.mask } : null },
    };
  }
  if (
    command.type === 'annotation.add'
    || command.type === 'annotation.update'
    || command.type === 'annotation.delete'
  ) {
    if (location.layer.type !== 'annotation') throw new ImageEditCommandValidationErrorV3('目标不是标注图层');
    const annotations = [...location.layer.annotations];
    if (command.type === 'annotation.add') {
      assertIndex(command.index, annotations.length);
      if (annotations.some((entry) => entry.id === command.annotation.id)) throw new ImageEditCommandValidationErrorV3('标注 ID 重复');
      const annotation = sanitizeMarkItem(command.annotation);
      if (!annotation) throw new ImageEditCommandValidationErrorV3('标注内容无效');
      annotations.splice(command.index, 0, annotation);
      return { layers: replaceLayer(document.layers, location, { ...location.layer, annotations }), inverse: { ...base, type: 'annotation.delete', layerId, annotationId: command.annotation.id } };
    }
    const index = annotations.findIndex((entry) => entry.id === command.annotationId);
    if (index < 0) throw new ImageEditCommandValidationErrorV3(`标注不存在：${command.annotationId}`);
    const previous = annotations[index];
    if (command.type === 'annotation.delete') {
      annotations.splice(index, 1);
      return { layers: replaceLayer(document.layers, location, { ...location.layer, annotations }), inverse: { ...base, type: 'annotation.add', layerId, index, annotation: jsonClone(previous) } };
    }
    if (command.annotation.id !== command.annotationId) throw new ImageEditCommandValidationErrorV3('更新标注时不能修改 ID');
    const annotation = sanitizeMarkItem(command.annotation);
    if (!annotation) throw new ImageEditCommandValidationErrorV3('标注内容无效');
    annotations[index] = annotation;
    return { layers: replaceLayer(document.layers, location, { ...location.layer, annotations }), inverse: { ...base, type: 'annotation.update', layerId, annotationId: command.annotationId, annotation: jsonClone(previous) } };
  }
  if (command.type === 'raster.apply-tile-delta') {
    if (location.layer.type !== 'raster') throw new ImageEditCommandValidationErrorV3('目标不是栅格图层');
    if (command.changes.length === 0) throw new ImageEditCommandValidationErrorV3('栅格瓦片增量不能为空');
    const tiles = { ...location.layer.tiles };
    const inverseChanges: ImageEditRasterTileDeltaCommandV3['changes'] = [];
    const keys = new Set<string>();
    let pixelBytes = 0;
    for (const change of command.changes) {
      if (!change.tileKey || ['__proto__', 'constructor', 'prototype'].includes(change.tileKey)
        || keys.has(change.tileKey) || !Number.isSafeInteger(change.byteSize) || change.byteSize < 0
        || (change.resourceId !== null && !change.resourceId)) throw new ImageEditCommandValidationErrorV3('栅格瓦片增量无效');
      keys.add(change.tileKey);
      inverseChanges.push({ tileKey: change.tileKey, resourceId: tiles[change.tileKey] ?? null, byteSize: change.byteSize });
      if (change.resourceId === null) delete tiles[change.tileKey];
      else tiles[change.tileKey] = change.resourceId;
      pixelBytes += change.byteSize;
      if (!Number.isSafeInteger(pixelBytes)) throw new ImageEditCommandValidationErrorV3('栅格瓦片历史字节数溢出');
    }
    return {
      layers: replaceLayer(document.layers, location, { ...location.layer, tiles }),
      inverse: { ...base, type: 'raster.apply-tile-delta', layerId, changes: inverseChanges },
      pixelBytes,
    };
  }
  throw new ImageEditCommandValidationErrorV3(`不支持的图片编辑命令：${command.type}`);
}

function estimateHistoryBytes(command: ImageEditCommandV3, inverse: ImageEditCommandV3, pixelBytes = 0): number {
  const metadataBytes = new TextEncoder().encode(JSON.stringify([command, inverse])).byteLength;
  return Math.max(metadataBytes, pixelBytes);
}

export function applyImageEditCommandV3(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3
): ImageEditCommandApplyResultV3 {
  if (command.expectedRevision !== document.revision) {
    throw new ImageEditRevisionConflictErrorV3(
      `图片文档 revision 冲突：期望 ${command.expectedRevision}，实际 ${document.revision}`
    );
  }
  if (!Number.isSafeInteger(command.expectedRevision) || document.revision >= Number.MAX_SAFE_INTEGER) {
    throw new ImageEditCommandValidationErrorV3('图片文档 revision 无效或已耗尽');
  }
  const nextRevision = document.revision + 1;
  const result = applyLayerCommand(document, command, nextRevision);
  return {
    document: { ...document, revision: nextRevision, layers: result.layers },
    inverse: result.inverse,
    historyBytes: estimateHistoryBytes(command, result.inverse, result.pixelBytes),
  };
}
