import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { z } from 'zod'

// 文档元数据，只保存续接已有生成所需的信息；没有凭据，也不重放付费提交。
const id = z.string().min(1).max(100)
const action = z.enum(['generate_shot', 'replace_shot', 'extend_shot', 'generate_audio'])
const role = z.enum(['previous_tail', 'next_head', 'replaced_head', 'extended_tail'])
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
export const videoEditInPlaceIntentSchema = z.object({
  action, frame: frame.optional(), duration: frame.min(1).optional(), trackIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  clipId: id.optional(), mode: z.enum(['insert', 'overwrite']).optional(),
}).strict()
export const videoEditInPlacePlanSchema = z.object({
  action, mediaType: z.enum(['video', 'audio']), sequenceId: id, frame, duration: frame.min(1), fill: z.boolean(),
  trackIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), placement: z.enum(['add', 'replace', 'insert', 'overwrite']), clipId: id.optional(),
  // A shot intent references at most its two adjacent endpoints; this is planner role cardinality, not record count.
  references: z.array(z.object({ role, clipId: id, itemId: id, clipName: z.string().max(200), sourceTimeUs: z.number().int().nonnegative() }).strict()).max(2),
  width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
}).strict()
export const videoEditInPlaceRecordSchema = z.object({
  id, taskId: id, modelId: id, plan: videoEditInPlacePlanSchema,
  request: z.object({ sequenceId: id, intent: videoEditInPlaceIntentSchema, prompt: z.string().max(100_000), modelId: id.optional(),
    // Four named endpoint roles in the planner vocabulary; records themselves are unbounded.
    params: z.record(z.string(), z.json()).optional(), referenceRoles: z.array(role).max(4).optional(), referenceFrame: frame.optional(),
  }).strict(),
  status: z.enum(['preparing', 'generating', 'placing', 'failed']), error: z.string().max(10_000).optional(),
  /** 已落位但保存失败时仅重试保存，不再导入、生成或放置。 */
  clipId: id.optional(),
}).strict()
export const videoEditInPlaceRecordsSchema = z.array(videoEditInPlaceRecordSchema)
export type VideoEditInPlaceRecord = z.infer<typeof videoEditInPlaceRecordSchema>
