import { decodeImageEditCommandHistorySnapshotV3, type ImageEditCommandHistorySnapshotV3, type ImageEditHistoryEntrySnapshotV3 } from '../commandHistoryCodec';
import { mergeImageEditHistoryResourceReferencesV3 } from '../commandTypes';
import { imageEditHistoryCheckpointSchemaV3, IMAGE_EDIT_HISTORY_PAGE_ENTRIES_V3, IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3, type ImageEditHistoryCheckpointV3 } from './schema';
export * from './schema';

export function decodeImageEditHistoryCheckpointV3(value: unknown): ImageEditHistoryCheckpointV3 {
  const checkpoint = imageEditHistoryCheckpointSchemaV3.parse(value);
  let next = 0;
  const refs = new Set<string>();
  for (const page of checkpoint.pages) {
    if (page.start !== next || page.byteSize > IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3 || refs.has(page.resourceId)) throw new Error('历史分页索引不连续或资源重复');
    next += page.count;
    if (!Number.isSafeInteger(next)) throw new Error('历史分页索引超出安全整数范围');
    refs.add(page.resourceId);
  }
  if (next !== checkpoint.total || checkpoint.position > next) throw new Error('历史检查点位置与分页不匹配');
  const normalized = mergeImageEditHistoryResourceReferencesV3(checkpoint.resources);
  if (JSON.stringify(normalized) !== JSON.stringify(checkpoint.resources)) throw new Error('历史检查点资源必须唯一排序');
  return checkpoint;
}

/** 每页沿现有严格逆命令 codec；checkpoint 仅索引，不生成第二套文档快照。 */
export function* splitImageEditHistoryPagesV3(snapshot: ImageEditCommandHistorySnapshotV3): Generator<ImageEditCommandHistorySnapshotV3> {
  const header = decodeImageEditCommandHistorySnapshotV3({ ...snapshot, undo: [], redo: [] }).snapshot;
  if (!Array.isArray(snapshot.undo) || !Array.isArray(snapshot.redo)) throw new Error('历史栈无效');
  const total = snapshot.undo.length + snapshot.redo.length;
  let entries: ImageEditHistoryEntrySnapshotV3[] = [];
  let bytes = 512;
  const ids = new Set<string>();
  let previousRevision = -1;
  const page = (): ImageEditCommandHistorySnapshotV3 => {
    const decoded = decodeImageEditCommandHistorySnapshotV3({ version: header.version, documentId: 'image-history-page', headRevision: entries.at(-1)!.forward.expectedRevision + 1, undo: entries, redo: [] }).snapshot;
    if (decoded.headRevision > header.headRevision) throw new Error('历史命令 revision 超过历史头');
    for (const entry of decoded.undo) {
      if (ids.has(entry.forward.commandId) || entry.forward.expectedRevision <= previousRevision) throw new Error('历史命令 ID 重复或分页顺序无效');
      ids.add(entry.forward.commandId); previousRevision = entry.forward.expectedRevision;
    }
    return decoded;
  };
  for (let index = 0; index < total; index++) {
    const entry = index < snapshot.undo.length ? snapshot.undo[index] : snapshot.redo[total - index - 1];
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
    if (entries.length && (entries.length >= IMAGE_EDIT_HISTORY_PAGE_ENTRIES_V3 || bytes + size > IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3)) {
      yield page(); entries = []; bytes = 512;
    }
    entries.push(entry); bytes += size;
  }
  if (entries.length) yield page();
}
