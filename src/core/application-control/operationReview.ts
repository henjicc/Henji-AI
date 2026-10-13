import { z } from 'zod'

export const operationOriginSchema = z.object({ at: z.number(), actor: z.enum(['external', 'embedded', 'user']) }).strict()
export const operationReviewCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('open'), operationId: z.string().uuid(), callerId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('resolve'), operationId: z.string().uuid(), callerId: z.string().uuid(), decision: z.enum(['completed', 'not_executed', 'later']) }).strict(),
])
export type OperationReviewCommand = z.infer<typeof operationReviewCommandSchema>
export interface OperationReviewItem {
  operationId: string
  callerId: string
  title: string
  message: string
  targets: Array<{ kind: string; id: string }>
  preferred?: 'completed' | 'not_executed'
  /** 原回执已确认执行，只允许核对解除保护或稍后处理。 */
  executed?: boolean
}
export interface OperationReviewSnapshot { items: OperationReviewItem[]; open?: { operationId: string; callerId: string } }
