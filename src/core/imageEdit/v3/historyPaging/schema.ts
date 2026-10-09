import { z } from 'zod';

export const IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3 = 2;
export const IMAGE_EDIT_HISTORY_PAGE_ENTRIES_V3 = 64;
/** 单页解码技术预算，不限制用户操作数量。 */
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
