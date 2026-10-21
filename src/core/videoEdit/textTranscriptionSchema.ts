import { z } from 'zod'

/** 口播文本剪辑的持久结构；单独成文件，剪辑文档 schema 引用它时不会经过 textTranscript 的运行时依赖形成循环。 */
const blockSchema = z.object({ id: z.string(), text: z.string().max(20000), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), included: z.boolean(), locked: z.boolean(), granularity: z.enum(['word', 'segment']) }).strict().refine(value => value.endFrame > value.startFrame)
const sourceRangeSchema = z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().refine(value => value.endFrame > value.startFrame)
export const videoEditTextTranscriptionSchema = z.object({
  audioDocumentId: z.string().min(1),
  audioDocumentIds: z.array(z.string().min(1)).optional(),
  fillers: z.array(z.string().min(1).max(30)).optional(),
  sources: z.array(z.object({ itemId: z.string(), mediaIdentity: z.string(), audioMappingIdentity: z.string().optional(), coverage: z.array(sourceRangeSchema).optional(), blocks: z.array(blockSchema), silences: z.array(sourceRangeSchema) }).strict()),
}).strict()
