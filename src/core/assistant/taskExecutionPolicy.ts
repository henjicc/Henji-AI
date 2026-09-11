import { z } from 'zod'

export const taskPolicyEffectSchema = z.enum(['observe', 'create', 'update', 'delete', 'navigate', 'execute'])
export type TaskPolicyEffect = z.infer<typeof taskPolicyEffectSchema>

export const taskPolicySourceSchema = z.object({
  messageId: z.string().min(1).max(200),
  quote: z.string().min(1).max(2_000),
}).strict()

/** 模型只能解释真实用户消息；版本与接管状态由宿主维护。 */
export const taskPolicyInterpretationSchema = z.object({
  intent: z.enum(['read_only', 'modify', 'navigate', 'ambiguous']),
  forbiddenEffects: z.array(taskPolicyEffectSchema).max(6),
  sources: z.array(taskPolicySourceSchema).min(1).max(32),
  navigationRequested: z.boolean(),
  clarification: z.string().max(500),
}).strict()
export type TaskPolicyInterpretation = z.infer<typeof taskPolicyInterpretationSchema>

export const taskExecutionPolicySchema = taskPolicyInterpretationSchema.extend({
  sources: z.array(taskPolicySourceSchema).max(32),
  schemaVersion: z.literal('task-execution-policy/v1'),
  version: z.number().int().positive(),
  navigationTakenOver: z.boolean(),
  resultPresented: z.boolean(),
  navigationBaseline: z.object({
    rendererSessionId: z.string().min(1),
    userRevision: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict()
export type TaskExecutionPolicy = z.infer<typeof taskExecutionPolicySchema>

export function taskPolicyForbiddenEffects(policy: TaskExecutionPolicy): Set<TaskPolicyEffect> {
  const forbidden = new Set(policy.forbiddenEffects)
  if (policy.navigationTakenOver) forbidden.add('navigate')
  if (policy.intent !== 'modify') {
    for (const effect of ['create', 'update', 'delete', 'execute'] as const) forbidden.add(effect)
  }
  return forbidden
}
