import { sanitizeMarkItem } from '../markCodec';
import {
  collectImageEditCommandResourceReferencesV3,
  mergeImageEditHistoryResourceReferencesV3,
  type ImageEditCommandV3,
  type ImageEditHistoryResourceReferenceV3,
} from './commandTypes';
import { cloneImageEditJsonObjectV3, decodeImageEditDocumentV3 } from './documentCodec';
import { createImageEditDocumentV3 } from './documentFactory';
import { getImageEditHistoryMaskValidationErrorV3 } from './commandHistoryMaskCodec';
import {
  decodeImageEditMaskResourceDescriptorsForMaskV3,
  decodeImageEditMaskResourceDescriptorsV3,
  ImageEditMaskResourceMetadataErrorV3,
} from './commandMaskResourceMetadata';
import {
  assertImageEditHistoryInversePairV3,
  ImageEditHistoryInversePairErrorV3,
} from './commandHistoryInverseCodec';
import {
  IMAGE_EDIT_BLEND_MODES_V3,
  type ImageEditLayerV3,
  type ImageEditMaskReferenceV3,
} from './layerTypes';
import { isImageEditTransformInvertibleV3 } from './execution/affineTransform';
import { calculateImageEditHistorySnapshotResourceTotalsV3 } from './commandHistoryResources';

export const IMAGE_EDIT_HISTORY_LEGACY_SNAPSHOT_VERSION_V3 = 1 as const;
export const IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3 = 2 as const;
export const IMAGE_EDIT_HISTORY_SNAPSHOT_DEFAULT_MAX_JSON_BYTES_V3 = 32 * 1024 * 1024;

export interface ImageEditHistoryEntrySnapshotV3 {
  forward: ImageEditCommandV3;
  inverse: ImageEditCommandV3;
  metadataBytes: number;
  resources: ImageEditHistoryResourceReferenceV3[];
}

export interface ImageEditCommandHistorySnapshotV3 {
  version:
    | typeof IMAGE_EDIT_HISTORY_LEGACY_SNAPSHOT_VERSION_V3
    | typeof IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3;
  documentId: string;
  headRevision: number;
  undo: ImageEditHistoryEntrySnapshotV3[];
  redo: ImageEditHistoryEntrySnapshotV3[];
}

export interface DecodeImageEditHistorySnapshotOptionsV3 {
  maxJsonBytes?: number;
  maxCommands?: number;
  maxBytes?: number;
}

export interface DecodedImageEditHistorySnapshotV3 {
  snapshot: ImageEditCommandHistorySnapshotV3;
  /** V1 的未知资源大小不会伪装成 0；null 表示只能兼容读取，下一次新写会淘汰它。 */
  retainedBytes: number | null;
  knownRetainedBytes: number;
  unknownResourceCount: number;
}

export class InvalidImageEditHistorySnapshotV3Error extends Error {}
const DEFAULT_MAX_COMMANDS = 200;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COMMON_LAYER_KEYS = ['id', 'name', 'visible', 'locked', 'opacity', 'blendMode', 'transform', 'mask'];

function fail(message: string): never {
  throw new InvalidImageEditHistorySnapshotV3Error(message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(`${label}包含未知字段`);
  if (keys.some((key) => !(key in value))) fail(`${label}缺少字段`);
}

function exactKeysWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(`${label}包含未知字段`);
  if (required.some((key) => !(key in value))) fail(`${label}缺少字段`);
}

function nonEmptyString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) fail(`${label}无效`);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label}无效`);
  return Number(value);
}

function parseSafeJson(value: unknown, maxBytes: number): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) fail('历史 JSON 上限无效');
  let json: string;
  if (typeof value === 'string') {
    json = value;
  } else {
    try {
      json = JSON.stringify(value);
    } catch {
      fail('历史快照不是 JSON');
    }
  }
  if (new TextEncoder().encode(json).byteLength > maxBytes) fail('历史快照超过 JSON 上限');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    fail('历史快照 JSON 无效');
  }
  let visited = 0;
  const visit = (entry: unknown, depth: number): void => {
    visited += 1;
    if (visited > 1_000_000 || depth > 80) fail('历史快照结构超限');
    if (typeof entry === 'string' && entry.length > 1_000_000) fail('历史快照字符串超限');
    if (Array.isArray(entry)) {
      if (entry.length > 100_000) fail('历史快照数组超限');
      entry.forEach((child) => visit(child, depth + 1));
    } else if (isRecord(entry)) {
      for (const [key, child] of Object.entries(entry)) {
        if (FORBIDDEN_KEYS.has(key)) fail('历史快照包含危险字段');
        visit(child, depth + 1);
      }
    }
  };
  visit(parsed, 0);
  return parsed;
}

function validateLayerKeys(value: unknown): void {
  if (!isRecord(value) || typeof value.type !== 'string') fail('历史图层无效');
  const specific = value.type === 'raster' ? ['type', 'source', 'tiles']
    : value.type === 'annotation' ? ['type', 'annotations']
      : value.type === 'effect' ? ['type', 'effectId', 'params', 'renderable', ...(value.legacyOperation === undefined ? [] : ['legacyOperation'])]
        : value.type === 'adjustment' ? ['type', 'adjustmentId', 'params', 'renderable']
          : value.type === 'group' ? ['type', 'children', 'isolated']
            : fail('历史图层类型未知');
  exactKeys(value, [...COMMON_LAYER_KEYS, ...specific], '历史图层');
  if (value.mask !== null) {
    validateMask(value.mask, '历史图层蒙版');
  }
  if (value.type === 'raster') {
    if (!isRecord(value.source)) fail('历史栅格来源无效');
    exactKeys(value.source, value.source.kind === 'empty' ? ['kind'] : ['kind', 'resourceId'], '历史栅格来源');
    if (!isRecord(value.tiles)) fail('历史栅格瓦片无效');
    Object.entries(value.tiles).forEach(([tileKey, resourceId]) => {
      nonEmptyString(tileKey, '历史瓦片键', 128);
      nonEmptyString(resourceId, '历史瓦片资源 ID');
    });
  } else if (value.type === 'annotation') {
    if (!Array.isArray(value.annotations)) fail('历史标注图层无效');
    value.annotations.forEach(validateAnnotation);
  } else if (value.type === 'effect' && value.legacyOperation !== undefined) {
    if (!isRecord(value.legacyOperation)) fail('历史兼容效果无效');
    exactKeys(value.legacyOperation, ['sourceVersion', 'operation'], '历史兼容效果');
  }
  if (value.type === 'group') {
    if (!Array.isArray(value.children)) fail('历史图层组无效');
    value.children.forEach(validateLayerKeys);
  }
}

function validateMask(value: unknown, label: string): void {
  const error = getImageEditHistoryMaskValidationErrorV3(value, label);
  if (error) fail(error);
}

function validateLayer(value: unknown, expectedType?: ImageEditLayerV3['type']): void {
  validateLayerKeys(value);
  const base = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'history-layer-validator' });
  const decoded = decodeImageEditDocumentV3({ ...base, layers: [value] });
  const layer = decoded.document?.layers[0];
  if (!layer || (expectedType && layer.type !== expectedType)) fail('历史图层内容无效');
}

function validateAnnotation(value: unknown): void {
  if (!isRecord(value) || typeof value.type !== 'string') fail('历史标注无效');
  const common = ['id', 'type'];
  const shape = value.type === 'rect' || value.type === 'ellipse'
    ? ['x', 'y', 'width', 'height', 'stroke', 'lineWidth', 'label', 'labelFontSize', 'labelDx', 'labelDy', 'labelBackgroundColor']
    : value.type === 'arrow'
      ? ['points', 'curveControl', 'stroke', 'lineWidth', 'label', 'labelFontSize', 'labelDx', 'labelDy', 'labelBackgroundColor']
      : value.type === 'pen' ? ['points', 'stroke', 'lineWidth']
        : value.type === 'text' ? ['x', 'y', 'text', 'color', 'fontSize', 'backgroundColor']
          : value.type === 'number' ? ['x', 'y', 'color', 'fontSize']
            : value.type === 'mosaic' ? ['x', 'y', 'width', 'height', 'strengthPercent', 'mode']
              : fail('历史标注类型未知');
  exactKeysWithOptional(value, common, shape, '历史标注');
  if (!sanitizeMarkItem(value)) fail('历史标注内容无效');
}

function validateBase(command: Record<string, unknown>, keys: readonly string[]): void {
  exactKeys(command, ['type', 'commandId', 'expectedRevision', ...keys], '历史命令');
  nonEmptyString(command.commandId, '历史命令 ID', 256);
  safeInteger(command.expectedRevision, '历史命令 revision');
}

function validateCommandResourceDescriptors(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > 100_000) fail(`${label}无效`);
  value.forEach((resource, index) => {
    if (!isRecord(resource)) fail(`${label}无效`);
    exactKeys(resource, ['resourceId', 'byteSize'], label);
    nonEmptyString(resource.resourceId, `${label}资源 ID`);
    const byteSize = safeInteger(resource.byteSize, `${label}字节数`);
    if (byteSize <= 0) fail(`${label}字节数必须为正数`);
    if (index > 0) {
      const previous = value[index - 1];
      if (!isRecord(previous) || String(previous.resourceId) >= String(resource.resourceId)) {
        fail(`${label}必须按资源 ID 唯一排序`);
      }
    }
  });
}

function validateNullableId(value: unknown, label: string): void {
  if (value !== null) nonEmptyString(value, label);
}
function validateIndex(value: unknown, label: string): void {
  safeInteger(value, label);
}

function validateOutputGeometryCommand(command: Record<string, unknown>): void {
  validateBase(command, ['orientation', 'crop']);
  if (!isRecord(command.orientation)) fail('图片输出方向无效');
  exactKeys(command.orientation, ['rotate', 'mirrored'], '图片输出方向');
  if (![0, 90, 180, 270].includes(Number(command.orientation.rotate))
    || typeof command.orientation.mirrored !== 'boolean') fail('图片输出方向无效');
  if (command.crop === null) return;
  if (!isRecord(command.crop)) fail('图片裁剪范围无效');
  exactKeys(command.crop, ['x', 'y', 'width', 'height'], '图片裁剪范围');
  const values = [command.crop.x, command.crop.y, command.crop.width, command.crop.height];
  if (!values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    || Number(command.crop.x) < 0 || Number(command.crop.y) < 0
    || Number(command.crop.width) <= 0 || Number(command.crop.height) <= 0) {
    fail('图片裁剪范围无效');
  }
}

function validateCommand(value: unknown, strictResources: boolean): ImageEditCommandV3 {
  if (!isRecord(value) || typeof value.type !== 'string') fail('历史命令无效');
  const command = value;
  switch (command.type) {
    case 'document.update-output-geometry':
      validateOutputGeometryCommand(command); break;
    case 'layer.add':
      validateBase(command, ['parentId', 'index', 'layer', ...(command.resources === undefined ? [] : ['resources'])]);
      validateNullableId(command.parentId, '父图层 ID'); validateIndex(command.index, '图层位置'); validateLayer(command.layer);
      if (strictResources && command.resources === undefined) fail('新增图层命令缺少资源元数据');
      if (command.resources !== undefined) validateCommandResourceDescriptors(command.resources, '图层命令资源元数据'); break;
    case 'layer.delete':
      validateBase(command, ['layerId', ...(command.resources === undefined ? [] : ['resources'])]); nonEmptyString(command.layerId, '图层 ID');
      if (strictResources && command.resources === undefined) fail('删除图层命令缺少资源元数据');
      if (command.resources !== undefined) validateCommandResourceDescriptors(command.resources, '图层命令资源元数据'); break;
    case 'layer.move':
      validateBase(command, ['layerId', 'parentId', 'index']); nonEmptyString(command.layerId, '图层 ID');
      validateNullableId(command.parentId, '父图层 ID'); validateIndex(command.index, '图层位置'); break;
    case 'layer.duplicate': {
      validateBase(command, ['layerId', 'parentId', 'index', 'idMap', ...(command.resources === undefined ? [] : ['resources'])]); nonEmptyString(command.layerId, '图层 ID');
      validateNullableId(command.parentId, '父图层 ID'); validateIndex(command.index, '图层位置');
      if (!isRecord(command.idMap) || Object.keys(command.idMap).length > 10_000) fail('图层副本 ID 映射无效');
      Object.entries(command.idMap).forEach(([key, entry]) => {
        nonEmptyString(key, '原图层 ID'); nonEmptyString(entry, '副本图层 ID');
      });
      if (new Set(Object.values(command.idMap)).size !== Object.keys(command.idMap).length) fail('副本图层 ID 重复');
      if (strictResources && command.resources === undefined) fail('复制图层命令缺少资源元数据');
      if (command.resources !== undefined) validateCommandResourceDescriptors(command.resources, '图层命令资源元数据');
      break;
    }
    case 'layer.group':
      validateBase(command, ['layerIds', 'group', ...(command.resources === undefined ? [] : ['resources'])]);
      if (!Array.isArray(command.layerIds) || command.layerIds.length === 0 || command.layerIds.length > 10_000) fail('待分组图层无效');
      command.layerIds.forEach((id) => nonEmptyString(id, '待分组图层 ID'));
      if (new Set(command.layerIds).size !== command.layerIds.length) fail('待分组图层 ID 重复');
      validateLayer(command.group, 'group');
      if (isRecord(command.group) && (command.group.locked === true
        || !Array.isArray(command.group.children) || command.group.children.length > 0)) fail('待创建图层组无效');
      if (strictResources && command.resources === undefined) fail('图层分组命令缺少资源元数据');
      if (command.resources !== undefined) validateCommandResourceDescriptors(command.resources, '图层命令资源元数据');
      break;
    case 'layer.ungroup':
      validateBase(command, ['groupId', ...(command.resources === undefined ? [] : ['resources'])]); nonEmptyString(command.groupId, '图层组 ID');
      if (strictResources && command.resources === undefined) fail('图层解组命令缺少资源元数据');
      if (command.resources !== undefined) validateCommandResourceDescriptors(command.resources, '图层命令资源元数据'); break;
    case 'layer.update-common': {
      validateBase(command, ['layerId', 'patch']); nonEmptyString(command.layerId, '图层 ID');
      if (!isRecord(command.patch) || Object.keys(command.patch).length === 0) fail('公共属性补丁无效');
      exactKeysWithOptional(command.patch, [], ['name', 'visible', 'locked', 'opacity', 'blendMode', 'transform'], '公共属性补丁');
      if (command.patch.name !== undefined && typeof command.patch.name !== 'string') fail('图层名称无效');
      if (command.patch.visible !== undefined && typeof command.patch.visible !== 'boolean') fail('图层显隐值无效');
      if (command.patch.locked !== undefined && typeof command.patch.locked !== 'boolean') fail('图层锁定值无效');
      if (command.patch.opacity !== undefined && (typeof command.patch.opacity !== 'number'
        || !Number.isFinite(command.patch.opacity) || command.patch.opacity < 0 || command.patch.opacity > 1)) fail('图层不透明度无效');
      if (command.patch.blendMode !== undefined && !IMAGE_EDIT_BLEND_MODES_V3.includes(command.patch.blendMode as never)) fail('图层混合模式无效');
      if (command.patch.transform !== undefined
        && !isImageEditTransformInvertibleV3(command.patch.transform)) fail('图层变换无效');
      break;
    }
    case 'layer.update-params':
      validateBase(command, ['layerId', 'params']); nonEmptyString(command.layerId, '图层 ID');
      if (!cloneImageEditJsonObjectV3(command.params)) fail('效果参数无效'); break;
    case 'group.update-isolation':
      validateBase(command, ['layerId', 'isolated']); nonEmptyString(command.layerId, '图层 ID');
      if (typeof command.isolated !== 'boolean') fail('图层组隔离值无效'); break;
    case 'layer.set-mask': {
      const hasMaskResources = 'maskResources' in command || 'previousMaskResources' in command;
      validateBase(
        command,
        hasMaskResources
          ? ['layerId', 'mask', 'maskResources', 'previousMaskResources']
          : ['layerId', 'mask'],
      );
      nonEmptyString(command.layerId, '图层 ID');
      if (command.mask !== null) validateMask(command.mask, '蒙版引用');
      if (strictResources && !hasMaskResources) fail('新历史的蒙版命令缺少资源元数据');
      if (hasMaskResources) {
        try {
          decodeImageEditMaskResourceDescriptorsForMaskV3(
            command.maskResources,
            command.mask as ImageEditMaskReferenceV3 | null,
            '新蒙版资源元数据',
          );
          decodeImageEditMaskResourceDescriptorsV3(
            command.previousMaskResources,
            '原蒙版资源元数据',
          );
        } catch (error) {
          if (error instanceof ImageEditMaskResourceMetadataErrorV3) fail(error.message);
          throw error;
        }
      }
      break;
    }
    case 'annotation.add':
      validateBase(command, ['layerId', 'index', 'annotation']); nonEmptyString(command.layerId, '图层 ID');
      validateIndex(command.index, '标注位置'); validateAnnotation(command.annotation); break;
    case 'annotation.update':
      validateBase(command, ['layerId', 'annotationId', 'annotation']); nonEmptyString(command.layerId, '图层 ID');
      nonEmptyString(command.annotationId, '标注 ID'); validateAnnotation(command.annotation);
      if (!isRecord(command.annotation) || command.annotation.id !== command.annotationId) fail('更新标注 ID 不匹配');
      break;
    case 'annotation.delete':
      validateBase(command, ['layerId', 'annotationId']); nonEmptyString(command.layerId, '图层 ID');
      nonEmptyString(command.annotationId, '标注 ID'); break;
    case 'raster.apply-tile-delta':
    case 'mask.apply-tile-delta': {
      validateBase(
        command,
        command.type === 'mask.apply-tile-delta'
          ? ['layerId', 'maskId', 'changes']
          : ['layerId', 'changes'],
      );
      nonEmptyString(command.layerId, '图层 ID');
      if (command.type === 'mask.apply-tile-delta') nonEmptyString(command.maskId, '蒙版 ID');
      if (!Array.isArray(command.changes) || command.changes.length === 0 || command.changes.length > 100_000) fail('瓦片增量无效');
      const tileKeys = new Set<string>();
      command.changes.forEach((change) => {
        if (!isRecord(change)) fail('瓦片增量无效');
        exactKeys(change, ['tileKey', 'previousResourceId', 'previousByteSize', 'resourceId', 'byteSize'], '瓦片增量');
        const tileKey = nonEmptyString(change.tileKey, '瓦片键', 128);
        if (tileKeys.has(tileKey)) fail('瓦片键重复');
        tileKeys.add(tileKey);
        validateNullableId(change.previousResourceId, '旧瓦片资源 ID');
        validateNullableId(change.resourceId, '新瓦片资源 ID');
        const previousBytes = safeInteger(change.previousByteSize, '旧瓦片字节数');
        const bytes = safeInteger(change.byteSize, '新瓦片字节数');
        if ((change.previousResourceId === null) !== (previousBytes === 0)
          || (change.resourceId === null) !== (bytes === 0)) fail('瓦片资源与字节数不一致');
        if ((change.previousResourceId !== null && previousBytes <= 0)
          || (change.resourceId !== null && bytes <= 0)) fail('瓦片资源字节数必须为正数');
        if (change.resourceId === change.previousResourceId) fail('瓦片增量不能是空操作');
      }); break;
    }
    default:
      fail('历史命令类型未知');
  }
  return command as unknown as ImageEditCommandV3;
}

function metadataBytes(forward: ImageEditCommandV3, inverse: ImageEditCommandV3): number {
  return new TextEncoder().encode(JSON.stringify([forward, inverse])).byteLength;
}
function resourcesFor(forward: ImageEditCommandV3, inverse: ImageEditCommandV3): ImageEditHistoryResourceReferenceV3[] {
  try {
    return mergeImageEditHistoryResourceReferencesV3([
      ...collectImageEditCommandResourceReferencesV3(forward),
      ...collectImageEditCommandResourceReferencesV3(inverse),
    ]);
  } catch {
    return fail('历史资源引用无效');
  }
}

function parseEntry(value: unknown, strictResources: boolean): ImageEditHistoryEntrySnapshotV3 {
  if (!isRecord(value)) fail('历史条目无效');
  exactKeys(value, ['forward', 'inverse', 'metadataBytes', 'resources'], '历史条目');
  const forward = validateCommand(value.forward, strictResources);
  const inverse = validateCommand(value.inverse, strictResources);
  try {
    assertImageEditHistoryInversePairV3(forward, inverse);
  } catch (error) {
    if (error instanceof ImageEditHistoryInversePairErrorV3) fail(error.message);
    throw error;
  }
  const expectedMetadataBytes = metadataBytes(forward, inverse);
  if (safeInteger(value.metadataBytes, '历史元数据字节数') !== expectedMetadataBytes) fail('历史元数据字节数不匹配');
  if (!Array.isArray(value.resources)) fail('历史资源列表无效');
  const declared = value.resources.map((resource) => {
    if (!isRecord(resource)) return fail('历史资源引用无效');
    exactKeys(resource, ['resourceId', 'byteSize'], '历史资源引用');
    const resourceId = nonEmptyString(resource.resourceId, '历史资源 ID');
    if (strictResources && resource.byteSize === null) fail('新历史不能包含未知资源字节数');
    const byteSize = resource.byteSize === null ? null : safeInteger(resource.byteSize, '历史资源字节数');
    if (byteSize !== null && byteSize <= 0) fail('历史资源字节数必须为正数');
    return { resourceId, byteSize };
  });
  let normalizedDeclared: ImageEditHistoryResourceReferenceV3[];
  try {
    normalizedDeclared = mergeImageEditHistoryResourceReferencesV3(declared);
  } catch {
    return fail('历史资源引用冲突');
  }
  if (JSON.stringify(normalizedDeclared) !== JSON.stringify(declared)
    || JSON.stringify(normalizedDeclared) !== JSON.stringify(resourcesFor(forward, inverse))) {
    fail('历史资源列表与命令不匹配');
  }
  return { forward, inverse, metadataBytes: expectedMetadataBytes, resources: normalizedDeclared };
}
export function decodeImageEditCommandHistorySnapshotV3(
  value: unknown,
  options: DecodeImageEditHistorySnapshotOptionsV3 = {},
): DecodedImageEditHistorySnapshotV3 {
  const maxJsonBytes = options.maxJsonBytes ?? IMAGE_EDIT_HISTORY_SNAPSHOT_DEFAULT_MAX_JSON_BYTES_V3;
  const maxCommands = options.maxCommands ?? DEFAULT_MAX_COMMANDS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxCommands) || maxCommands < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    fail('历史恢复上限无效');
  }
  const parsed = parseSafeJson(value, maxJsonBytes);
  if (!isRecord(parsed)) fail('历史快照无效');
  exactKeys(parsed, ['version', 'documentId', 'headRevision', 'undo', 'redo'], '历史快照');
  if (parsed.version !== IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3
    && parsed.version !== IMAGE_EDIT_HISTORY_LEGACY_SNAPSHOT_VERSION_V3) fail('历史快照版本未知');
  const version = parsed.version;
  const strictResources = version === IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3;
  const documentId = nonEmptyString(parsed.documentId, '历史文档 ID', 256);
  const headRevision = safeInteger(parsed.headRevision, '历史头 revision');
  if (!Array.isArray(parsed.undo) || !Array.isArray(parsed.redo)) fail('历史栈无效');
  if (parsed.undo.length + parsed.redo.length > maxCommands) fail('历史命令数量超过上限');
  const undo = parsed.undo.map((entry) => parseEntry(entry, strictResources));
  const redo = parsed.redo.map((entry) => parseEntry(entry, strictResources));
  const forwardIds = new Set<string>();
  for (const entry of [...undo, ...redo]) {
    if (forwardIds.has(entry.forward.commandId)) fail('历史命令 ID 重复');
    forwardIds.add(entry.forward.commandId);
    if (entry.forward.expectedRevision >= headRevision) fail('历史命令 revision 超过历史头');
  }
  for (let index = 1; index < undo.length; index += 1) {
    if (undo[index - 1].forward.expectedRevision >= undo[index].forward.expectedRevision) fail('撤销栈顺序无效');
  }
  for (let index = 1; index < redo.length; index += 1) {
    if (redo[index - 1].forward.expectedRevision <= redo[index].forward.expectedRevision) fail('重做栈顺序无效');
  }
  if (undo.length > 0 && redo.length > 0
    && undo[undo.length - 1].forward.expectedRevision >= redo[redo.length - 1].forward.expectedRevision) {
    fail('撤销与重做栈边界无效');
  }
  let retained: ReturnType<typeof calculateImageEditHistorySnapshotResourceTotalsV3>;
  try {
    retained = calculateImageEditHistorySnapshotResourceTotalsV3([...undo, ...redo]);
  } catch {
    return fail('历史保留字节数溢出');
  }
  if (retained.knownBytes > maxBytes) fail('历史字节数超过上限');
  return {
    snapshot: { version, documentId, headRevision, undo, redo },
    retainedBytes: retained.unknownResourceCount > 0 ? null : retained.knownBytes,
    knownRetainedBytes: retained.knownBytes,
    unknownResourceCount: retained.unknownResourceCount,
  };
}

export function stringifyImageEditCommandHistorySnapshotV3(
  snapshot: ImageEditCommandHistorySnapshotV3,
  options: DecodeImageEditHistorySnapshotOptionsV3 = {},
): string {
  const decoded = decodeImageEditCommandHistorySnapshotV3(snapshot, options);
  return JSON.stringify(decoded.snapshot);
}
