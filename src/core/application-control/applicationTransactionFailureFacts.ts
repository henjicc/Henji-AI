import { z } from 'zod'
import { applicationTransactionResultSchema, type ApplicationTransactionResult } from './transactions'
import { applicationObservedEffectSchema, type ApplicationObservedEffect } from './observedEffect'
import { boundedTransactionResult } from './execution/receiptBounds'

/** 失败通道只携带已经发生的事务事实；没有属性值、文档、任意 details 或异常栈。 */
export const applicationTransactionFailureFactsSchema = applicationTransactionResultSchema.options[3].pick({
  transactionRef: true, code: true, currentRevisions: true, resultRefs: true,
  effects: true, undoRef: true, partial: true, persistence: true, verification: true, recoveryVerification: true, receiptTruncation: true,
}).extend({ replayMutation: z.literal(false) }).strict()
export type ApplicationTransactionFailureFacts = z.infer<typeof applicationTransactionFailureFactsSchema>

export function transactionFailureFacts(result: Extract<ApplicationTransactionResult, { status: 'failed' }>): ApplicationTransactionFailureFacts | undefined {
  if (!result.persistence && !result.effects?.length && !result.partial && !result.verification) return undefined
  // 领域也会直接抛出事务事实（批量保存失败），这里要与引擎结果走同一个出口。
  const bounded = boundedTransactionResult(result) as typeof result
  const { transactionRef, code, currentRevisions, resultRefs, effects, undoRef, partial, persistence, verification, recoveryVerification, receiptTruncation } = bounded
  return applicationTransactionFailureFactsSchema.parse({ transactionRef, code, currentRevisions, resultRefs,
    effects, undoRef, partial, persistence, verification, recoveryVerification, receiptTruncation, replayMutation: false })
}

/** 未通过最终验收的实际变化不能标记 verified；共用同一账本形状。 */
export function failureObservedEffects(facts: ApplicationTransactionFailureFacts): ApplicationObservedEffect[] {
  const chunks = <T>(items: T[]): T[][] => items.length ? Array.from({ length: Math.ceil(items.length / 128) },
    (_, index) => items.slice(index * 128, (index + 1) * 128)) : [[]]
  return (facts.effects ?? []).flatMap((effect) => chunks(effect.refs).flatMap((refs) =>
    chunks(effect.propertyIds).map((propertyIds) => applicationObservedEffectSchema.parse({
      effect: effect.effect, entityTypes: [effect.entityType], propertyIds,
      targetRefs: refs.map(({ kind, id }) => ({ kind, id })), count: Math.max(1, refs.length),
      verified: false, evidence: ['事务已产生修改，但完整结果尚未通过正式验证。'],
    }))))
}
