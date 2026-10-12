import { z } from 'zod'

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
export const uiPaidApprovalSchema = z.object({
  action: z.enum(['prepare', 'approve', 'start', 'complete', 'reject', 'failed']),
  request: paidApprovalRequestSchema,
  capabilityId: z.enum(Object.keys(UI_PAID_CAPABILITIES) as [keyof typeof UI_PAID_CAPABILITIES, ...(keyof typeof UI_PAID_CAPABILITIES)[]]),
  projectConsent: z.boolean().optional(),
}).strict()
export const paidApprovalDecisionSchema = z.object({
  decision: z.enum(['auto', 'ask', 'deny']), reason: z.string(),
  estimatedCny: z.number().finite().nonnegative().nullable(),
  dailySpentCny: z.number().finite().nonnegative(),
}).strict()
export type PaidApprovalDecision = z.infer<typeof paidApprovalDecisionSchema>
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
}
/** 业务层只提供费用事实；展示层按当前语言组织确认文案。 */
export function paidApprovalMessage(value: PaidApprovalDecision, category: PaidOperationCategory, modelName?: string): PaidApprovalDisplay {
  return { estimatedCny: value.estimatedCny, dailySpentCny: value.dailySpentCny, category, ...(modelName ? { modelName } : {}) }
}
