import { z } from 'zod'

export const PAID_APPROVAL_SETTING_KEY = 'ai.paid_approval'
export const paidOperationCategorySchema = z.enum(['generation', 'recognition', 'translation', 'title', 'explanation'])
export type PaidOperationCategory = z.infer<typeof paidOperationCategorySchema>
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
/** Trusted application UI for AI-assisted explanation sending, never an Agent tool input. */
export const uiPaidApprovalSchema = z.object({
  action: z.enum(['prepare', 'approve', 'start', 'complete', 'reject', 'failed']),
  request: paidApprovalRequestSchema,
  capabilityId: z.enum(['interpret_video_edit_intent', 'interpret_image_edit_intent', 'create_visible_generation_task']),
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
