import { z } from 'zod'
import { ApplicationPreflightFailure } from './execution/transactionFailure'

export const PAID_APPROVAL_SETTING_KEY = 'ai.paid_approval'
export const paidOperationCategorySchema = z.enum(['generation', 'recognition', 'translation', 'title', 'explanation'])
export type PaidOperationCategory = z.infer<typeof paidOperationCategorySchema>
/** 仅用于主进程操作账本的确认元数据；界面类别文案由 i18n 格式化。 */
export const PAID_OPERATION_LABELS: Record<PaidOperationCategory, string> = {
  generation: '生成', recognition: '识别', translation: '翻译', title: '标题', explanation: '讲解外发',
}
export const paidProjectSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()
export const paidApprovalSettingsSchema = z.object({
  mode: z.enum(['ask', 'auto', 'bypass']).default('auto'),
  singleLimitCny: z.number().finite().nonnegative().default(2),
  dailyLimitCny: z.number().finite().nonnegative().default(20),
  projects: z.array(paidProjectSchema.extend({ category: paidOperationCategorySchema })).default([]),
}).strict()
export type PaidApprovalSettings = z.infer<typeof paidApprovalSettingsSchema>
export const DEFAULT_PAID_APPROVAL_SETTINGS: PaidApprovalSettings = paidApprovalSettingsSchema.parse({})
export const paidApprovalRequestSchema = z.object({
  category: paidOperationCategorySchema,
  project: paidProjectSchema.optional(),
  estimatedCny: z.number().finite().nonnegative().nullable(),
}).strict()
export type PaidApprovalRequest = z.infer<typeof paidApprovalRequestSchema>
/** Trusted UI operations; this map is internal and is not part of the public tool catalog. */
export const UI_PAID_CAPABILITIES = {
  interpret_video_edit_intent: 'explanation', interpret_image_edit_intent: 'explanation',
  create_visible_generation_task: 'generation', transcribe_audio_edit: 'recognition',
  ui_translate_subtitles: 'translation', ui_generate_title: 'title', ui_generate_text: 'generation',
  ui_verify_model: 'generation', ui_assistant_chat: 'generation',
} as const satisfies Record<string, PaidOperationCategory>
/** Trusted application UI, never an Agent tool input. */
export const paidFailureFactsSchema = z.object({ billing: z.enum(['not_charged', 'submitted', 'completed', 'unknown']) }).strict()
export type PaidFailureFacts = z.infer<typeof paidFailureFactsSchema>

/** 只消费执行层的明确计费事实；HTTP 状态、错误文案与取消本身都不能证明未计费。 */
export function readPaidFailureFacts(error: unknown): PaidFailureFacts {
  const seen = new Set<object>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const record = error as Record<string, unknown>
    for (const field of ['paidFailureFacts', 'execution', 'transcriptionFacts', 'details']) {
      const value = record[field]
      const facts = paidFailureFactsSchema.safeParse(value && typeof value === 'object' && 'billing' in value ? { billing: value.billing } : undefined)
      if (facts.success) return facts.data
    }
    if (error instanceof ApplicationPreflightFailure) return { billing: 'not_charged' }
    error = record.cause
  }
  return { billing: 'unknown' }
}

export function isPaidConfirmationExpired(error: unknown): boolean {
  return error instanceof Error && error.message.includes('付费确认已结束，请重新发起。')
}

export const uiPaidApprovalSchema = z.object({
  action: z.enum(['prepare', 'approve', 'start', 'complete', 'reject', 'failed']),
  request: paidApprovalRequestSchema,
  capabilityId: z.enum(Object.keys(UI_PAID_CAPABILITIES) as [keyof typeof UI_PAID_CAPABILITIES, ...(keyof typeof UI_PAID_CAPABILITIES)[]]),
  projectConsent: z.boolean().optional(),
  failureFacts: paidFailureFactsSchema.optional(),
}).strict()
export const paidApprovalDecisionSchema = z.object({
  decision: z.enum(['auto', 'ask', 'deny']), reason: z.string(),
  estimatedCny: z.number().finite().nonnegative().nullable(),
  dailySpentCny: z.number().finite().nonnegative(),
}).strict()
export type PaidApprovalDecision = z.infer<typeof paidApprovalDecisionSchema>
/** 仅可信 UI prepare 的返回值；不改变助手 paid_approval 的公开决策结构。 */
export const uiPaidApprovalDecisionSchema = paidApprovalDecisionSchema.extend({ expiresAt: z.number().finite().nullable() })
export const paidApprovalReceiptSchema = z.object({ decision: z.enum(['auto', 'user']), reason: z.string() }).strict()
export type PaidApprovalReceipt = z.infer<typeof paidApprovalReceiptSchema>
export const paidReservationSchema = paidApprovalRequestSchema.extend({
  reservedAt: z.number(), approval: paidApprovalReceiptSchema,
}).strict()
export interface PaidApprovalDisplay {
  estimatedCny: number | null
  dailySpentCny: number
  category: PaidOperationCategory
  modelName?: string
  expiresAt?: number
}
/** 业务层只提供费用事实；展示层按当前语言组织确认文案。 */
export function paidApprovalMessage(value: PaidApprovalDecision & { expiresAt?: number | null }, category: PaidOperationCategory, modelName?: string): PaidApprovalDisplay {
  return { estimatedCny: value.estimatedCny, dailySpentCny: value.dailySpentCny, category, ...(modelName ? { modelName } : {}),
    ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}) }
}
