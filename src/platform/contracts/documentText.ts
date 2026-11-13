import { z } from 'zod'

export const DOCUMENT_TEXT_CHANNELS = { inspect: 'document-text:inspect', recognize: 'document-text:recognize', cancel: 'document-text:cancel' } as const

export const documentTextRequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  path: z.string().min(1).max(32767),
  engine: z.enum(['auto', 'local', 'deepseek']),
  layout: z.enum(['text', 'rich_layout']),
}).strict()
export type DocumentTextRequest = z.infer<typeof documentTextRequestSchema>

export const documentTextInspectRequestSchema = documentTextRequestSchema.pick({ path: true, engine: true })
export type DocumentTextInspectRequest = z.infer<typeof documentTextInspectRequestSchema>

export interface DocumentTextInspection {
  engine: 'local' | 'deepseek'
  sizeBytes: number
  /** 识别前统计的页数；图片为 1，统计不出（旧版 doc/ppt、加密或损坏）为 null。 */
  pages: number | null
}

export interface DocumentTextResult {
  engine: 'local' | 'deepseek'
  /** 是否经过 DeepSeek 付费识别。 */
  charged: boolean
  pageCount: number
  /** complete 为 false 表示该页输出达到上限、文字不完整。 */
  pages: Array<{ index: number; text: string; complete: boolean }>
}

export interface DocumentTextPlatform {
  inspect(request: DocumentTextInspectRequest): Promise<DocumentTextInspection>
  recognize(request: DocumentTextRequest): Promise<DocumentTextResult>
  cancel(requestId: string): Promise<void>
}
