import type { ImageEditRasterTileDeltaCommandV3 } from '../commandTypes';
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushStrokeResultV3,
  PersistedImageEditBrushTileV3,
} from './contracts';

const RESOURCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface ImageEditBrushTileHistoryTransitionV3 {
  tileKey: string;
  oldResource: ImageEditBrushResourceReferenceV3 | null;
  newResource: ImageEditBrushResourceReferenceV3;
}

export interface ImageEditBrushHistoryRetentionV3 {
  transitions: readonly ImageEditBrushTileHistoryTransitionV3[];
  oldResources: readonly ImageEditBrushResourceReferenceV3[];
  newResources: readonly ImageEditBrushResourceReferenceV3[];
  retainedResources: readonly ImageEditBrushResourceReferenceV3[];
  oldResourceBytes: number;
  newResourceBytes: number;
  retainedResourceBytes: number;
}

export interface MaterializedImageEditBrushDeltaV3 {
  command: ImageEditRasterTileDeltaCommandV3;
  history: ImageEditBrushHistoryRetentionV3;
}

export interface MaterializeImageEditBrushDeltaOptionsV3 {
  commandId: string;
  expectedRevision: number;
  layerId: string;
  persistedTiles: readonly PersistedImageEditBrushTileV3[];
}

function assertResource(resource: ImageEditBrushResourceReferenceV3, label: string): void {
  if (!RESOURCE_ID_PATTERN.test(resource.resourceId)
    || !Number.isSafeInteger(resource.byteSize)
    || resource.byteSize < 0) {
    throw new Error(`${label}资源引用无效`);
  }
}

function uniqueResources(
  resources: readonly ImageEditBrushResourceReferenceV3[],
): ImageEditBrushResourceReferenceV3[] {
  const byId = new Map<string, ImageEditBrushResourceReferenceV3>();
  for (const resource of resources) {
    assertResource(resource, '画笔历史');
    const existing = byId.get(resource.resourceId);
    if (existing && existing.byteSize !== resource.byteSize) {
      throw new Error('同一画笔历史资源出现了不同字节数');
    }
    byId.set(resource.resourceId, { ...resource });
  }
  return [...byId.values()];
}

function sumBytes(resources: readonly ImageEditBrushResourceReferenceV3[]): number {
  let total = 0;
  for (const resource of resources) {
    total += resource.byteSize;
    if (!Number.isSafeInteger(total)) throw new Error('画笔历史资源字节数溢出');
  }
  return total;
}

/**
 * 上层持久化每个 Float32 瓦片后调用。结果同时给命令历史和资源租约系统使用，
 * 旧、新哈希都必须保留到对应 undo/redo 条目被裁剪为止。
 */
export function materializeImageEditBrushTileDeltaV3(
  stroke: ImageEditBrushStrokeResultV3,
  options: MaterializeImageEditBrushDeltaOptionsV3,
): MaterializedImageEditBrushDeltaV3 {
  if (!options.commandId || !options.layerId) throw new Error('画笔命令 ID 与图层 ID 不能为空');
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new Error('画笔命令 revision 无效');
  }
  if (stroke.changes.length === 0) throw new Error('画笔笔画没有可持久化瓦片');

  const persistedByKey = new Map<string, ImageEditBrushResourceReferenceV3>();
  for (const persisted of options.persistedTiles) {
    if (!persisted.tileKey || persistedByKey.has(persisted.tileKey)) {
      throw new Error('画笔持久化瓦片键重复或为空');
    }
    const resource = { resourceId: persisted.resourceId, byteSize: persisted.byteSize };
    assertResource(resource, '画笔新瓦片');
    persistedByKey.set(persisted.tileKey, resource);
  }
  if (persistedByKey.size !== stroke.changes.length) {
    throw new Error('画笔持久化瓦片数量与笔画增量不一致');
  }

  const transitions: ImageEditBrushTileHistoryTransitionV3[] = [];
  const commandChanges: ImageEditRasterTileDeltaCommandV3['changes'] = [];
  for (const change of stroke.changes) {
    const newResource = persistedByKey.get(change.tileKey);
    if (!newResource) throw new Error(`缺少画笔持久化瓦片：${change.tileKey}`);
    persistedByKey.delete(change.tileKey);
    transitions.push({
      tileKey: change.tileKey,
      oldResource: change.oldResource ? { ...change.oldResource } : null,
      newResource: { ...newResource },
    });
    commandChanges.push({
      tileKey: change.tileKey,
      resourceId: newResource.resourceId,
      byteSize: newResource.byteSize,
    });
  }
  if (persistedByKey.size > 0) throw new Error('存在不属于当前笔画的持久化瓦片');

  const oldResources = uniqueResources(
    transitions.flatMap((transition) => transition.oldResource ? [transition.oldResource] : []),
  );
  const newResources = uniqueResources(transitions.map((transition) => transition.newResource));
  const retainedResources = uniqueResources([...oldResources, ...newResources]);
  return {
    command: {
      type: 'raster.apply-tile-delta',
      commandId: options.commandId,
      expectedRevision: options.expectedRevision,
      layerId: options.layerId,
      changes: commandChanges,
    },
    history: {
      transitions,
      oldResources,
      newResources,
      retainedResources,
      oldResourceBytes: sumBytes(oldResources),
      newResourceBytes: sumBytes(newResources),
      retainedResourceBytes: sumBytes(retainedResources),
    },
  };
}
