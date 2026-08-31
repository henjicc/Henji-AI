import type { ImageEditMaskTileDeltaCommandV3 } from '../commandTypes';
import type {
  ImageEditSelectionMaskResourceReferenceV3,
  MaterializeImageEditSelectionMaskDeltaOptionsV3,
  MaterializedImageEditSelectionMaskDeltaV3,
} from './contracts';

const RESOURCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

function assertResource(
  resource: ImageEditSelectionMaskResourceReferenceV3 | null,
  label: string,
): void {
  if (!resource) return;
  if (!RESOURCE_ID_PATTERN.test(resource.resourceId)
    || !Number.isSafeInteger(resource.byteSize) || resource.byteSize < 0) {
    throw new Error(`${label}资源引用无效`);
  }
}

/** 把上层已持久化的 old/new 瓦片引用直接变成现有原子 mask.apply-tile-delta 命令。 */
export function materializeImageEditSelectionMaskDeltaV3(
  options: MaterializeImageEditSelectionMaskDeltaOptionsV3,
): MaterializedImageEditSelectionMaskDeltaV3 {
  if (!options.commandId || !options.layerId || !options.maskId) {
    throw new Error('选区蒙版命令、图层与蒙版 ID 不能为空');
  }
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new Error('选区蒙版命令 revision 无效');
  }
  if (options.changes.length === 0) throw new Error('选区蒙版没有可提交的瓦片变化');

  const keys = new Set<string>();
  const changes: ImageEditMaskTileDeltaCommandV3['changes'] = options.changes.map((change) => {
    if (!change.tileKey || keys.has(change.tileKey)) throw new Error('选区蒙版瓦片键重复或为空');
    keys.add(change.tileKey);
    assertResource(change.oldResource, '选区蒙版旧瓦片');
    assertResource(change.newResource, '选区蒙版新瓦片');
    if (change.oldResource?.resourceId === change.newResource?.resourceId) {
      throw new Error('选区蒙版瓦片内容没有变化');
    }
    return {
      tileKey: change.tileKey,
      previousResourceId: change.oldResource?.resourceId ?? null,
      previousByteSize: change.oldResource?.byteSize ?? 0,
      resourceId: change.newResource?.resourceId ?? null,
      byteSize: change.newResource?.byteSize ?? 0,
    };
  });

  return {
    type: 'mask.apply-tile-delta',
    commandId: options.commandId,
    expectedRevision: options.expectedRevision,
    layerId: options.layerId,
    maskId: options.maskId,
    changes,
  };
}
