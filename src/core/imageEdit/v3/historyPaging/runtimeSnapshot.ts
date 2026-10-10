import { decodeImageEditCommandHistorySnapshotV3, type ImageEditCommandHistorySnapshotV3 } from '../commandHistoryCodec';
import { decodeImageEditHistoryCheckpointV3 } from './checkpoint';
import { mergeImageEditHistoryResourceReferencesV3, type ImageEditHistoryResourceReferenceV3 } from '../commandTypes';

/** 分页源不是落盘格式：严格尾部 codec + 不可变检查点 + 截取范围。 */
export function decodeImageEditRuntimeHistoryV3(value: unknown): ImageEditCommandHistorySnapshotV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('cold' in value)) {
    return decodeImageEditCommandHistorySnapshotV3(value).snapshot;
  }
  const { cold, ...tail } = value;
  const snapshot = decodeImageEditCommandHistorySnapshotV3(tail).snapshot;
  if (!cold || typeof cold !== 'object' || Array.isArray(cold)
    || Object.keys(cold).sort().join(',') !== 'checkpoint,commandIds,position,prefixLength,resourceRoles'
    || !('checkpoint' in cold) || !('prefixLength' in cold) || !('position' in cold) || !('commandIds' in cold) || !('resourceRoles' in cold)) throw new Error('分页历史源无效');
  const checkpoint = decodeImageEditHistoryCheckpointV3(cold.checkpoint);
  const prefixLength = cold.prefixLength, position = cold.position;
  const commandIds = cold.commandIds;
  const roles = cold.resourceRoles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles) || Object.keys(roles).sort().join(',') !== 'images,sparse'
    || !('images' in roles) || !Array.isArray(roles.images) || roles.images.some(id => typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id))
    || !('sparse' in roles) || !Array.isArray(roles.sparse) || roles.sparse.some(pair => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(pair[0]) || !['rgba-float32', 'mask-float32'].includes(pair[1]))) throw new Error('分页历史资源用途无效');
  if (checkpoint.documentId !== snapshot.documentId || checkpoint.snapshotVersion !== snapshot.version || checkpoint.headRevision > snapshot.headRevision
    || typeof prefixLength !== 'number' || !Number.isSafeInteger(prefixLength) || prefixLength < 0 || prefixLength > checkpoint.total
    || typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0
    || position > prefixLength + snapshot.undo.length + snapshot.redo.length
    || snapshot.undo.length !== Math.max(0, position - prefixLength)
    || !Array.isArray(commandIds) || commandIds.length !== checkpoint.total
    || commandIds.some(id => typeof id !== 'string' || !id.length) || new Set(commandIds).size !== commandIds.length) throw new Error('分页历史游标与尾部不一致');
  const resources = new Set(checkpoint.resources.map(ref => ref.resourceId));
  const { images, sparse } = roles as NonNullable<ImageEditCommandHistorySnapshotV3['cold']>['resourceRoles'];
  const seen = new Set(commandIds.slice(0, prefixLength));
  for (const entry of [...snapshot.undo, ...snapshot.redo]) {
    if (seen.has(entry.forward.commandId)) throw new Error('分页历史命令 ID 重复');
    seen.add(entry.forward.commandId);
  }
  if (images.some(id => !resources.has(id)) || sparse.some(([id]) => !resources.has(id))
    || new Set(images).size !== images.length || new Set(sparse.map(([id]) => id)).size !== sparse.length
    || sparse.some(([id]) => images.includes(id))) throw new Error('分页历史资源用途与检查点不一致');
  return { ...snapshot, cold: { checkpoint, prefixLength, position, commandIds,
    resourceRoles: roles as NonNullable<ImageEditCommandHistorySnapshotV3['cold']>['resourceRoles'] } };
}

export function runtimeHistoryResourcesV3(snapshot: ImageEditCommandHistorySnapshotV3): ImageEditHistoryResourceReferenceV3[] {
  return mergeImageEditHistoryResourceReferencesV3([
    ...(snapshot.cold?.checkpoint.resources ?? []),
    ...(snapshot.cold?.checkpoint.pages.map(page => ({ resourceId: page.resourceId, byteSize: page.byteSize })) ?? []),
    ...snapshot.undo.flatMap(entry => entry.resources), ...snapshot.redo.flatMap(entry => entry.resources),
  ]);
}
