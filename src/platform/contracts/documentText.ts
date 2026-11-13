import { z } from 'zod'

export const DOCUMENT_TEXT_CHANNELS = { recognize: 'document-text:recognize', cancel: 'document-text:cancel' } as const

export const documentTextRequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  path: z.string().min(1).max(32767),
  engine: z.enum(['auto', 'local', 'deepseek']),
  layout: z.enum(['text', 'rich_layout']),
}).strict()
export type DocumentTextRequest = z.infer<typeof documentTextRequestSchema>

export interface DocumentTextResult {
  engine: 'local' | 'deepseek'
  /** 是否经过 DeepSeek 付费识别。 */
  charged: boolean
  pageCount: number
  /** complete 为 false 表示该页输出达到上限、文字不完整。 */
  pages: Array<{ index: number; text: string; complete: boolean }>
}

export interface DocumentTextPlatform {
  recognize(request: DocumentTextRequest): Promise<DocumentTextResult>
  cancel(requestId: string): Promise<void>
}
