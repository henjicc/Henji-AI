import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { z } from 'zod'

import { documentIdSchema } from '../documents/envelope'

/*
 * 剪辑片段的来源（4.1 统一，取代原来的五种格式）：
 * - document：来自一份文档——画布节点的输出（part = 节点 ID）、图片文档（放进剪辑后保持链接）、口播（导出的剪后声音）。
 *   docRef 是跨文档引用 { docId, path }：先按位置找（拷贝出来的项目引用自己的副本），找不到再按 ID 查索引；
 *   revision 是放入时来源的版本（图片文档为渲染所用的工作副本版本），用来判断来源后来有没有改。
 * - generation：生成记录里的第几个结果。
 * “回到来源继续编辑”按来源打开对应文档并定位到部位，或打开生成记录。
 */

const id = z.string().min(1).max(500)
const pathSchema = z.string().min(1).max(32_768).refine((value) => !value.includes('\0'), '位置无效。')

export const videoEditDocumentRefSchema = z.object({ docId: documentIdSchema, path: pathSchema }).strict()
const documentSource = z.object({
  type: z.literal('document'),
  docRef: videoEditDocumentRefSchema,
  /** 文档里的部位，如画布节点 ID。 */
  part: id.optional(),
  revision: z.number().int().nonnegative().optional(),
}).strict()
const generationSource = z.object({
  type: z.literal('generation'),
  recordId: id,
  outputIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()

/** 剪辑文件里片段记录的来源。 */
export const videoEditCreativeSourceSchema = z.discriminatedUnion('type', [documentSource, generationSource])
export type VideoEditCreativeSource = z.infer<typeof videoEditCreativeSourceSchema>
export type VideoEditDocumentSource = z.infer<typeof documentSource>

/** 放入请求：来源 + 只影响这次产出的选项（口播是否带上声音处理）。 */
export const videoEditCreativeSourceRequestSchema = z.discriminatedUnion('type', [
  documentSource.extend({ includeProcessing: z.boolean().optional() }).strict(),
  generationSource,
  z.object({ type: z.literal('asset'), assetId: id }).strict(),
])
export type VideoEditCreativeSourceRequest = z.infer<typeof videoEditCreativeSourceRequestSchema>

/** 请求里只影响产出的选项不进片段记录。 */
export function videoEditCreativeOrigin(request: VideoEditCreativeSourceRequest): VideoEditCreativeSource | undefined {
  // 资产来源已由 media.assetId/contentIdentity 记录，不伪装成生成记录或文档。
  if (request.type === 'asset') return undefined
  if (request.type === 'generation') return { type: 'generation', recordId: request.recordId, outputIndex: request.outputIndex }
  return {
    type: 'document',
    docRef: { docId: request.docRef.docId, path: request.docRef.path },
    ...(request.part !== undefined ? { part: request.part } : {}),
    ...(request.revision !== undefined ? { revision: request.revision } : {}),
  }
}

/** 两个来源是否指向同一处（同一文档的同一部位，或同一生成结果）；不比较位置与版本。 */
export function sameVideoEditCreativeSource(left: VideoEditCreativeSource, right: VideoEditCreativeSource): boolean {
  if (left.type === 'generation' || right.type === 'generation') {
    return left.type === right.type && left.type === 'generation' && right.type === 'generation'
      && left.recordId === right.recordId && left.outputIndex === right.outputIndex
  }
  return left.docRef.docId === right.docRef.docId && (left.part ?? null) === (right.part ?? null)
}

/** `add` 落到 `trackId`，或在没有空余轨道时 `newTrack`：最上面的视频轨之上／最下面的音频轨之下新建一条（与 PR 拖到轨道外一样）。 */
export const videoEditResultPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), trackId: id.optional(), newTrack: z.enum(['video', 'audio']).optional(), duration: z.number().int().positive().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional() }).strict(),
  z.object({ mode: z.literal('library') }).strict(),
  z.object({ mode: z.enum(['insert', 'overwrite']), frame: z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), trackId: id, duration: z.number().int().positive().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional() }).strict(),
  z.object({ mode: z.literal('replace'), clipId: id }).strict(),
]).superRefine((value, context) => { if (value.mode === 'add' && (value.trackId === undefined) === (value.newTrack === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: '请指定目标轨道或新建轨道之一。' }) })
export type VideoEditResultPlacement = z.infer<typeof videoEditResultPlacementSchema>
