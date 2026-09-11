import { z } from 'zod'
import { applicationTransactionResultSchema, type ApplicationTransactionResult } from '../application-control/transactions'
import { agentObservedEffectSchema, type AgentObservedEffect } from './observedEffect'

/** 失败通道只携带已经发生的事务事实；没有属性值、文档、任意 details 或异常栈。 */
export const applicationTransactionFailureFactsSchema = applicationTransactionResultSchema.options[3].pick({
  transactionRef: true, code: true, currentRevisions: true, resultRefs: true,
  effects: true, undoRef: true, partial: true, persistence: true, executionState: true,
}).extend({ replayMutation: z.literal(false) }).strict().refine((facts) => !facts.executionState
  || (!facts.effects?.length && !facts.partial?.completedStepIndexes.length && !facts.persistence),
'尚未开始的操作不能同时声明已发生的修改或待保存事实')
export type ApplicationTransactionFailureFacts = z.infer<typeof applicationTransactionFailureFactsSchema>

export function transactionFailureFacts(result: Extract<ApplicationTransactionResult, { status: 'failed' }>): ApplicationTransactionFailureFacts | undefined {
  if (!result.executionState && !result.persistence && !result.effects?.length && !result.partial?.completedStepIndexes.length) return undefined
  const { transactionRef, code, currentRevisions, resultRefs, effects, undoRef, partial, persistence, executionState } = result
  return applicationTransactionFailureFactsSchema.parse({ transactionRef, code, currentRevisions, resultRefs,
    effects, undoRef, partial, persistence, executionState, replayMutation: false })
}

/** 类型化的传输错误；只允许合法的有界事实跨越既有进程边界。 */
export class ApplicationTransactionFactsError extends Error {
  constructor(message: string, readonly transaction: ApplicationTransactionFailureFacts) {
    super(message)
    this.name = 'ApplicationTransactionFactsError'
  }
}

/** 未通过最终验收的实际变化不能标记 verified；共用同一账本形状。 */
export function failureObservedEffects(facts: ApplicationTransactionFailureFacts): AgentObservedEffect[] {
  const chunks = <T>(items: T[]): T[][] => items.length ? Array.from({ length: Math.ceil(items.length / 128) },
    (_, index) => items.slice(index * 128, (index + 1) * 128)) : [[]]
  return (facts.effects ?? []).flatMap((effect) => chunks(effect.refs).flatMap((refs) =>
    chunks(effect.propertyIds).map((propertyIds) => agentObservedEffectSchema.parse({
      effect: effect.effect, entityTypes: [effect.entityType], propertyIds,
      targetRefs: refs.map(({ kind, id }) => ({ kind, id })), count: Math.max(1, refs.length),
      verified: false, evidence: ['事务已产生修改，但完整结果尚未通过正式验证。'],
    }))))
}
