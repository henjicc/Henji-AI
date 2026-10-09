import { z } from 'zod';
import { decodeImageEditCommandHistorySnapshotV3, type ImageEditCommandHistorySnapshotV3, type ImageEditHistoryEntrySnapshotV3 } from '../commandHistoryCodec';
import { mergeImageEditHistoryResourceReferencesV3 } from '../commandTypes';

export const IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3 = 1;
export const IMAGE_EDIT_HISTORY_PAGE_ENTRIES_V3 = 64;
/** 单页 JSON 解码预算；大命令可独占一页，不是历史／作品数量限制。 */
export const IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3 = 32 * 1024 * 1024;
const count = z.number().int().nonnegative();
const resource = z.object({ resourceId: z.string().regex(/^sha256:[a-f0-9]{64}$/), byteSize: z.number().int().positive().nullable() }).strict();
export const imageEditHistoryCheckpointSchemaV3 = z.object({
  format: z.literal('henji-image-history'), version: z.literal(IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3),
  documentId: z.string().min(1), headRevision: count, snapshotVersion: z.union([z.literal(1), z.literal(2)]),
  position: count, total: count,
  pages: z.array(z.object({ resourceId: resource.shape.resourceId, byteSize: z.number().int().positive(), start: count, count: z.number().int().positive() }).strict()),
  resources: z.array(resource),
}).strict();
export type ImageEditHistoryCheckpointV3 = z.infer<typeof imageEditHistoryCheckpointSchemaV3>;

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
  const validated = decodeImageEditCommandHistorySnapshotV3(snapshot).snapshot;
  const total = validated.undo.length + validated.redo.length;
  let entries: ImageEditHistoryEntrySnapshotV3[] = [];
  let bytes = 512;
  const page = (): ImageEditCommandHistorySnapshotV3 => ({ version: validated.version, documentId: 'image-history-page', headRevision: entries.at(-1)!.forward.expectedRevision + 1, undo: entries, redo: [] });
  for (let index = 0; index < total; index++) {
    const entry = index < validated.undo.length ? validated.undo[index] : validated.redo[total - index - 1];
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
    if (entries.length && (entries.length >= IMAGE_EDIT_HISTORY_PAGE_ENTRIES_V3 || bytes + size > IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3)) {
      yield page(); entries = []; bytes = 512;
    }
    entries.push(entry); bytes += size;
  }
  if (entries.length) yield page();
}
