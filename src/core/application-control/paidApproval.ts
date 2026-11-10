import { z } from 'zod'
import { ApplicationPreflightFailure } from './execution/transactionFailure'

export const PAID_APPROVAL_SETTING_KEY = 'ai.paid_approval'
const paidOperationCategorySchema = z.enum(['generation', 'recognition', 'translation', 'title', 'explanation'])
export type PaidOperationCategory = z.infer<typeof paidOperationCategorySchema>
const paidProjectSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()
export const paidApprovalSettingsSchema = z.object({
  version: z.literal(2).default(2),
  singleLimitCny: z.number().finite().nonnegative().default(2),
  dailyLimitCny: z.number().finite().nonnegative().default(20),
  unlimited: z.boolean().default(false),
}).strict()
export type PaidApprovalSettings = z.infer<typeof paidApprovalSettingsSchema>
export const DEFAULT_PAID_APPROVAL_SETTINGS: PaidApprovalSettings = paidApprovalSettingsSchema.parse({})
/** 迁移保留用户的每次询问与完全放开选择。 */
export function readPaidApprovalSettingsValue(value: unknown): PaidApprovalSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return paidApprovalSettingsSchema.parse(value)
  const { mode, projects: _projects, ...settings } = value as Record<string, unknown>
  return paidApprovalSettingsSchema.parse({ ...settings, ...(mode === undefined ? {} : { unlimited: mode === 'bypass' }), ...(mode === 'ask' ? { singleLimitCny: 0 } : {}) })
}
export const paidApprovalRequestSchema = z.object({
  category: paidOperationCategorySchema,
  project: paidProjectSchema.optional(),
  estimatedCny: z.number().finite().nonnegative().nullable(),
  generationTaskIds: z.array(z.string().uuid()).nonempty().optional(),
  generationTaskEstimates: z.array(z.object({ taskId: z.string().uuid(), estimatedCny: z.number().finite().nonnegative().nullable() }).strict()).nonempty().optional(),
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
const paidFailureFactsSchema = z.object({ billing: z.enum(['not_charged', 'submitted', 'completed', 'unknown']) }).strict()
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

export const uiPaidApprovalSchema = z.object({
  action: z.enum(['prepare', 'start', 'complete', 'reject', 'failed']),
  request: paidApprovalRequestSchema,
  capabilityId: z.enum(Object.keys(UI_PAID_CAPABILITIES) as [keyof typeof UI_PAID_CAPABILITIES, ...(keyof typeof UI_PAID_CAPABILITIES)[]]),
  failureFacts: paidFailureFactsSchema.optional(),
}).strict()
export const paidApprovalDecisionSchema = z.object({
  decision: z.enum(['auto', 'ask', 'deny']), reason: z.string(),
  estimatedCny: z.number().finite().nonnegative().nullable(),
  dailySpentCny: z.number().finite().nonnegative(),
}).strict()
export type PaidApprovalDecision = z.infer<typeof paidApprovalDecisionSchema>
export const paidApprovalReceiptSchema = z.object({ decision: z.enum(['auto', 'user']), reason: z.string() }).strict()
export type PaidApprovalReceipt = z.infer<typeof paidApprovalReceiptSchema>
export const paidOperationReceiptSchema = z.object({ operationId: z.string().uuid(), callerId: z.string().uuid() }).strict()
export type PaidOperationReceipt = z.infer<typeof paidOperationReceiptSchema>
// 逐任务估价只用于审批分配；落盘仍使用既有预留结构。
export const paidReservationSchema = paidApprovalRequestSchema.omit({ generationTaskEstimates: true }).extend({
  generationRequest: z.object({ id: z.string().min(1), digest: z.string().min(1) }).strict().optional(),
  generationRequests: z.array(z.object({ id: z.string().min(1), digest: z.string().min(1) }).strict()).optional(),
  reservedAt: z.number(), approval: paidApprovalReceiptSchema,
}).strict()
export type PaidReservation = z.infer<typeof paidReservationSchema>
export function generationReservationKey(reservation: PaidReservation): string | undefined {
  return reservation.category === 'generation' && reservation.generationTaskIds?.length
    ? JSON.stringify([...new Set(reservation.generationTaskIds)].sort()) : undefined
}
export interface PaidApprovalDisplay {
  estimatedCny: number | null
  dailySpentCny: number
  category: PaidOperationCategory
  modelName?: string
}
/** 业务层只提供费用事实；展示层按当前语言组织确认文案。 */
export function paidApprovalMessage(value: PaidApprovalDecision, category: PaidOperationCategory, modelName?: string): PaidApprovalDisplay {
  return { estimatedCny: value.estimatedCny, dailySpentCny: value.dailySpentCny, category, ...(modelName ? { modelName } : {}) }
}
