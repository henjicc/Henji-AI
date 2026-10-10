import { parseImageEditSharedEffectParametersV3 } from './operationCatalog';
import { parseImageColorGradeParams } from '../../imaging/adjustments/schema';
import {
  cloneImageEditMaskReferenceV3,
  collectImageEditLayerIdsV3,
  isImageEditSparseMaskReferenceV3,
  isValidImageEditMaskReferenceV3,
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
} from './commandTypes';
import { normalizeImageEditLayerCommonPatchV3 } from './commandCommonPatch';
import { applyImageEditOutputGeometryCommandV3 } from './commandDocumentReducer';
import {
  ImageEditCommandValidationErrorV3,
  ImageEditLayerLockedErrorV3,
  ImageEditRevisionConflictErrorV3,
} from './commandErrors';
import { calculateImageEditCommandHistoryResourcesV3 } from './commandHistoryResources';
import { cloneImageEditJsonObjectV3 } from './documentCodec';
import { applyImageEditTileDeltaV3 } from './commandTileDeltaReducer';
import {
  decodeImageEditLayerSetMaskResourceMetadataV3,
  ImageEditMaskResourceMetadataErrorV3,
  invertImageEditSetMaskResourceMetadataV3,
} from './commandMaskResourceMetadata';
import {
  findImageEditCommandLayerLocationV3 as findLayerLocation,
  type ImageEditCommandLayerLocationV3 as LayerLocation,
} from './commandLayerLocation';
import { assertImageEditStructuralCommandResourcesV3 } from './commandLayerResourceMetadata';
import { assertImageEditLayerSemanticsV3 } from './layerModel/semantics';
import { imageEditNamedRegionsSchemaV3 } from './namedRegions';
import { assertImageEditSmartGraphV3, assertImageEditSmartInstancesConsistentV3 } from './smartContent/graph';
import { createImageEditLayerContentRegistryV3 } from './layerEntries/base';

export {
  ImageEditCommandValidationErrorV3,
  ImageEditLayerLockedErrorV3,
  ImageEditRevisionConflictErrorV3,
} from './commandErrors';

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
    fillOpacity: layer.fillOpacity,
    clipping: layer.clipping,
    maskAttachment: jsonClone(layer.maskAttachment),
    filters: jsonClone(layer.filters),
    blendMode: layer.blendMode,
    transform: [...layer.transform],
    ...(layer.deformation === undefined ? {} : { deformation: jsonClone(layer.deformation) }),
    mask: layer.mask ? cloneImageEditMaskReferenceV3(layer.mask) : null,
  };
  if (layer.type === 'raster') {
    return { ...common, type: 'raster', source: { ...layer.source }, tiles: { ...layer.tiles },
      ...(layer.rasterCanvasSize ? { rasterCanvasSize: { ...layer.rasterCanvasSize } } : {}) };
  }
  if (layer.type === 'smart') {
    return { ...common, type: 'smart', source: { ...layer.source }, tiles: { ...layer.tiles }, content: structuredClone(layer.content) };
  }
  if (layer.type === 'text') return { ...layer, ...common, content: jsonClone(layer.content) };
  if (layer.type === 'shape' || layer.type === 'path') return { ...layer, ...common, content: jsonClone(layer.content) };
  if (layer.type === 'effect') {
    return {
      ...common,
      type: 'effect',
      effectId: layer.effectId,
      params: jsonClone<ImageEditJsonObjectV3>(layer.params),
      renderable: layer.renderable,
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

function applyLayerCommand(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  nextRevision: number,
  allowLegacyResourceMetadata: boolean,
): { layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3 } {
  const base = inverseBase(command, nextRevision);
  assertImageEditStructuralCommandResourcesV3(
    document,
    command,
    allowLegacyResourceMetadata,
  );
  const structuralResources = 'resources' in command && command.resources
    ? command.resources.map((resource) => ({ ...resource }))
    : undefined;
  if (command.type === 'layer.move-many') {
    if (!command.moves.length || new Set(command.moves.map(move => move.layerId)).size !== command.moves.length) {
      throw new ImageEditCommandValidationErrorV3('请选择不重复的待移动图层');
    }
    const ids = new Set(command.moves.map(move => move.layerId));
    const locations = command.moves.map(move => {
      const location = findLayerLocation(document.layers, move.layerId);
      if (!location) throw new ImageEditCommandValidationErrorV3('待移动图层不存在');
      assertLayerEditable(location);
      assertContainerEditable(document.layers, move.parentId);
      if (location.ancestors.some(ancestor => ids.has(ancestor.id))
        || (move.parentId && command.moves.some(entry => {
          const source = findLayerLocation(document.layers, entry.layerId);
          return source && containsLayerId(source.layer, move.parentId!);
        }))) throw new ImageEditCommandValidationErrorV3('不能同时移动组与后代，或放入待移动组的后代');
      return location;
    });
    const remove = (layers: readonly ImageEditLayerV3[]): ImageEditLayerV3[] => layers
      .filter(layer => !ids.has(layer.id))
      .map(layer => layer.type === 'group' ? { ...layer, children: remove(layer.children) } : layer);
    let layers = remove(document.layers);
    const destinations = new Map<string | null, typeof command.moves>();
    for (const move of command.moves) {
      const entries = destinations.get(move.parentId) ?? [];
      entries.push(move); destinations.set(move.parentId, entries);
    }
    for (const [parentId, moves] of destinations) {
      const container = [...getContainer(layers, parentId)];
      const ordered = moves.slice().sort((left, right) => left.index - right.index);
      if (new Set(ordered.map(move => move.index)).size !== ordered.length) {
        throw new ImageEditCommandValidationErrorV3('目标图层位置不能重复');
      }
      for (const move of ordered) {
        assertIndex(move.index, container.length);
        const location = locations.find(entry => entry.layer.id === move.layerId)!;
        container.splice(move.index, 0, location.layer);
      }
      layers = replaceContainer(layers, parentId, container);
    }
    return { layers, inverse: { ...base, type: 'layer.move-many', moves: locations.map(location => ({
      layerId: location.layer.id, parentId: location.parentId, index: location.index,
    })) } };
  }
  if (command.type === 'layer.add') {
    assertContainerEditable(document.layers, command.parentId);
    const layer = cloneLayer(command.layer);
    if (layer.locked) throw new ImageEditCommandValidationErrorV3('不能直接添加已锁定的图层');
    assertTreeIdsAvailable(document.layers, layer);
    return {
      layers: insertLayer(document.layers, command.parentId, command.index, layer),
      inverse: {
        ...base,
        type: 'layer.delete',
        layerId: layer.id,
        ...(structuralResources ? { resources: structuralResources } : {}),
      },
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
        ...(structuralResources ? { resources: structuralResources } : {}),
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
      inverse: {
        ...base,
        type: 'layer.delete',
        layerId: duplicate.id,
        ...(structuralResources ? { resources: structuralResources } : {}),
      },
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
      inverse: {
        ...base,
        type: 'layer.ungroup',
        groupId: group.id,
        ...(structuralResources ? { resources: structuralResources } : {}),
      },
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
        ...(structuralResources ? { resources: structuralResources } : {}),
      },
    };
  }
  return applyLayerContentCommand(
    document,
    command,
    nextRevision,
    allowLegacyResourceMetadata,
  );
}

function applyLayerContentCommand(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  nextRevision: number,
  allowLegacyResourceMetadata = false,
): { layers: ImageEditLayerV3[]; inverse: ImageEditCommandV3 } {
  const base = inverseBase(command, nextRevision);
  const layerId = 'layerId' in command ? command.layerId : '';
  const location = findLayerLocation(document.layers, layerId);
  if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${layerId}`);
  if (command.type === 'layer.update-common') {
    const patch = normalizeImageEditLayerCommonPatchV3(command.patch);
    if (patch.transform
      && (location.layer.type === 'effect' || location.layer.type === 'adjustment')
      && patch.transform.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) {
      throw new ImageEditCommandValidationErrorV3('效果和调整图层不支持空间变换');
    }
    const keys = Object.keys(patch) as (keyof ImageEditLayerCommonPatchV3)[];
    if (location.layer.locked && keys.some((key) => key !== 'locked')) throw new ImageEditLayerLockedErrorV3(`图层已锁定：${layerId}`);
    if (location.ancestors.some((ancestor) => ancestor.locked)) throw new ImageEditLayerLockedErrorV3(`图层所在组已锁定：${layerId}`);
    const inversePatch: ImageEditLayerCommonPatchV3 = {};
    for (const key of keys) {
      Object.assign(inversePatch, { [key]: key === 'deformation' ? location.layer.deformation ?? null : location.layer[key] });
    }
    const nextLayer = { ...location.layer, ...patch } as ImageEditLayerV3;
    return { layers: replaceLayer(document.layers, location, nextLayer), inverse: { ...base, type: 'layer.update-common', layerId, patch: inversePatch,
      ...(command.resources ? { resources: command.resources.map(resource => ({ ...resource })) } : {}) } };
  }
  assertLayerEditable(location);
  if (command.type === 'layer.replace') {
    if (command.layer.id !== layerId) throw new ImageEditCommandValidationErrorV3('替换内容不能改变实例标识');
    assertImageEditSmartGraphV3(command.layer);
    const layer = createImageEditLayerContentRegistryV3().parse(command.layer.type, command.layer);
    return { layers: replaceLayer(document.layers, location, cloneLayer(layer)), inverse: {
      ...base, type: 'layer.replace', layerId, layer: cloneLayer(location.layer), resources: command.resources,
    } };
  }
  if (command.type === 'layer.update-params') {
    if (location.layer.type !== 'effect' && location.layer.type !== 'adjustment') {
      throw new ImageEditCommandValidationErrorV3('目标不是效果或调整图层');
    }
    if (!location.layer.renderable) {
      throw new ImageEditCommandValidationErrorV3('不可渲染的兼容图层不能修改参数');
    }
    const params = cloneImageEditJsonObjectV3(command.params);
    if (!params) throw new ImageEditCommandValidationErrorV3('图层参数不是安全 JSON 对象');
    if (location.layer.type === 'effect') parseImageEditSharedEffectParametersV3(location.layer.effectId, params);
    if (location.layer.type === 'adjustment' && location.layer.adjustmentId === 'color_grade') {
      parseImageColorGradeParams(params);
    }
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
    if (command.mask && !isValidImageEditMaskReferenceV3(command.mask)) {
      throw new ImageEditCommandValidationErrorV3('蒙版引用无效');
    }
    let resourceMetadata: ReturnType<typeof decodeImageEditLayerSetMaskResourceMetadataV3>;
    try {
      resourceMetadata = decodeImageEditLayerSetMaskResourceMetadataV3(
        command,
        location.layer.mask,
      );
      if (!resourceMetadata && !allowLegacyResourceMetadata) {
        throw new ImageEditMaskResourceMetadataErrorV3('蒙版资源元数据必须成对提供');
      }
    } catch (error) {
      if (error instanceof ImageEditMaskResourceMetadataErrorV3) {
        throw new ImageEditCommandValidationErrorV3(error.message);
      }
      throw error;
    }
    return {
      layers: replaceLayer(document.layers, location, {
        ...location.layer,
        mask: command.mask ? cloneImageEditMaskReferenceV3(command.mask) : null,
      }),
      inverse: {
        ...base,
        type: 'layer.set-mask',
        layerId,
        mask: location.layer.mask ? cloneImageEditMaskReferenceV3(location.layer.mask) : null,
        ...invertImageEditSetMaskResourceMetadataV3(resourceMetadata),
      },
    };
  }
  if (command.type === 'raster.apply-tile-delta') {
    if (location.layer.type !== 'raster') throw new ImageEditCommandValidationErrorV3('目标不是栅格图层');
    const { tiles, inverseChanges } = applyImageEditTileDeltaV3(
      location.layer.tiles,
      command.changes,
      '栅格',
    );
    return {
      layers: replaceLayer(document.layers, location, { ...location.layer, tiles }),
      inverse: { ...base, type: 'raster.apply-tile-delta', layerId, changes: inverseChanges },
    };
  }
  if (command.type === 'mask.apply-tile-delta') {
    const mask = location.layer.mask;
    if (!mask || !isImageEditSparseMaskReferenceV3(mask) || mask.maskId !== command.maskId) {
      throw new ImageEditRevisionConflictErrorV3('目标稀疏蒙版已被替换或删除');
    }
    const { tiles, inverseChanges } = applyImageEditTileDeltaV3(mask.tiles, command.changes, '蒙版');
    return {
      layers: replaceLayer(document.layers, location, {
        ...location.layer,
        mask: { ...mask, tiles },
      }),
      inverse: {
        ...base,
        type: 'mask.apply-tile-delta',
        layerId,
        maskId: mask.maskId,
        changes: inverseChanges,
      },
    };
  }
  throw new ImageEditCommandValidationErrorV3(`不支持的图片编辑命令：${command.type}`);
}

export function applyImageEditCommandV3(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  options: { allowLegacyResourceMetadata?: boolean; deferSmartConsistency?: boolean } = {},
): ImageEditCommandApplyResultV3 {
  if (!command.commandId || command.commandId.length > 256) {
    throw new ImageEditCommandValidationErrorV3('图片编辑命令 ID 无效');
  }
  if (command.expectedRevision !== document.revision) {
    throw new ImageEditRevisionConflictErrorV3(
      `图片文档 revision 冲突：期望 ${command.expectedRevision}，实际 ${document.revision}`
    );
  }
  if (!Number.isSafeInteger(command.expectedRevision) || document.revision >= Number.MAX_SAFE_INTEGER) {
    throw new ImageEditCommandValidationErrorV3('图片文档 revision 无效或已耗尽');
  }
  const nextRevision = document.revision + 1;
  if (command.type === 'document.atomic') {
    if (!command.commands.length || command.commands.some(child => (child as ImageEditCommandV3).type === 'document.atomic')
      || new Set(command.commands.map(child => child.commandId)).size !== command.commands.length) throw new ImageEditCommandValidationErrorV3('原子命令必须包含不重复的非嵌套操作');
    let candidate = document;
    const inverses: import('./commandTypes').ImageEditLeafCommandV3[] = [];
    for (const child of command.commands) {
      const result = applyImageEditCommandV3(candidate, { ...child, expectedRevision: candidate.revision }, { ...options, deferSmartConsistency: true });
      candidate = result.document;
      if (result.inverse.type === 'document.atomic') throw new ImageEditCommandValidationErrorV3('不支持嵌套原子操作');
      // 原子内的临时 revision 只用于执行；持久历史与原始子命令基线对应。
      inverses.unshift({ ...result.inverse, expectedRevision: child.expectedRevision + 1 });
    }
    const inverse: ImageEditCommandV3 = { ...inverseBase(command, nextRevision), type: 'document.atomic', commands: inverses };
    const history = calculateImageEditCommandHistoryResourcesV3(command, inverse);
    const historyMetadataBytes = new TextEncoder().encode(JSON.stringify([command, inverse])).byteLength;
    assertImageEditSmartGraphV3(candidate);
    assertImageEditSmartInstancesConsistentV3(candidate);
    return { document: { ...candidate, revision: nextRevision }, inverse, historyMetadataBytes,
      historyResources: history.resources, historyBytes: historyMetadataBytes + history.bytes };
  }
  const documentResult = command.type === 'document.update-output-geometry'
    ? applyImageEditOutputGeometryCommandV3(document, command, nextRevision)
    : null;
  const regionsResult = command.type === 'document.set-named-regions'
    ? imageEditNamedRegionsSchemaV3.parse(command.regions) : null;
  const layerResult = documentResult || regionsResult ? null : applyLayerCommand(
    document,
    command,
    nextRevision,
    options.allowLegacyResourceMetadata === true,
  );
  const inverse = regionsResult ? { ...inverseBase(command, nextRevision), type: 'document.set-named-regions' as const,
    regions: structuredClone(document.namedRegions) } : documentResult?.inverse ?? layerResult?.inverse;
  try {
    assertImageEditLayerSemanticsV3(layerResult?.layers ?? document.layers);
    const candidate = { ...document, layers: layerResult?.layers ?? document.layers };
    assertImageEditSmartGraphV3(candidate);
    if (!options.deferSmartConsistency) assertImageEditSmartInstancesConsistentV3(candidate);
  } catch (error) {
    throw new ImageEditCommandValidationErrorV3(error instanceof Error ? error.message : '图层语义无效');
  }
  if (!inverse) throw new ImageEditCommandValidationErrorV3('图片编辑命令没有生成逆向补丁');
  const historyMetadataBytes = new TextEncoder().encode(JSON.stringify([command, inverse])).byteLength;
  const history = calculateImageEditCommandHistoryResourcesV3(command, inverse);
  const historyBytes = historyMetadataBytes + history.bytes;
  if (!Number.isSafeInteger(historyBytes)) {
    throw new ImageEditCommandValidationErrorV3('图片编辑历史字节数溢出');
  }
  return {
    document: {
      ...document,
      revision: nextRevision,
      ...(regionsResult ? { namedRegions: regionsResult } : {}),
      ...(documentResult ? { geometry: documentResult.geometry } : { layers: layerResult?.layers ?? document.layers }),
    },
    inverse,
    historyMetadataBytes,
    historyResources: history.resources,
    historyBytes,
  };
}
