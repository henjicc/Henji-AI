import { truncateCodePoints } from '../identifiers'
import {
  APPLICATION_RECEIPT_LIMITS as LIMITS,
  applicationTransactionResultSchema,
  type ApplicationEffectReceipt,
  type ApplicationEvidence,
  type ApplicationTransactionResult,
  type ApplicationVerificationResult,
} from '../transactions'

const TRUNCATION_NOTE = '回执过长，部分条目未列出，实际状态不受影响。需要完整结果时读取目标实体，不要重复执行。'

type Omitted = Record<string, number>

function count(omitted: Omitted, key: string, amount = 1): void {
  omitted[key] = (omitted[key] ?? 0) + amount
}

function take<T>(items: readonly T[], limit: number, key: string, omitted: Omitted): T[] {
  if (items.length <= limit) return [...items]
  count(omitted, key, items.length - limit)
  return items.slice(0, limit)
}

function text(value: string, limit: number, omitted: Omitted): string {
  if (value.length <= limit) return value
  count(omitted, 'truncatedTexts')
  return `${truncateCodePoints(value, limit - 1)}…`
}

function evidenceList(items: readonly ApplicationEvidence[], key: string, omitted: Omitted): ApplicationEvidence[] {
  return take(items, LIMITS.evidence, key, omitted).map((item) => ({ ...item, fact: text(item.fact, LIMITS.text, omitted) }))
}

function verificationResult(verification: ApplicationVerificationResult, omitted: Omitted): ApplicationVerificationResult {
  return {
    ...verification,
    evidence: evidenceList(verification.evidence, 'verificationEvidence', omitted),
    unmetConditions: take(verification.unmetConditions, LIMITS.unmetConditions, 'unmetConditions', omitted)
      .map((condition) => text(condition, LIMITS.text, omitted)),
    ...(verification.adjustedValues ? { adjustedValues: take(verification.adjustedValues, LIMITS.unmetConditions, 'adjustedValues', omitted)
      .map((item) => text(item, LIMITS.text, omitted)) } : {}),
  }
}

/** 一条 Effect 的引用超出单条上限时拆成多条，事实不丢；拆完仍超总数才算省略。 */
function effectList(effects: readonly ApplicationEffectReceipt[], omitted: Omitted): ApplicationEffectReceipt[] {
  const chunks = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.max(1, Math.ceil(items.length / size)) }, (_, index) => items.slice(index * size, (index + 1) * size))
  // 一条 Effect 说的是“这些引用的这些属性变了”：拆开后每段都要成对，不能只切一边。
  const split = effects.flatMap((effect) => chunks(effect.propertyIds, LIMITS.effectPropertyIds).flatMap((propertyIds) => chunks(effect.refs, LIMITS.effectRefs).map((refs) => ({ ...effect, refs, propertyIds }))))
  return take(split, LIMITS.effects, 'effects', omitted)
}

/**
 * 事务回执的唯一出口。
 *
 * 走到这里时业务往往已经生效；若回执超出协议长度就抛错，调用方会把已生效的修改当成失败，
 * 进而重放。所以超长一律在这里收口并记入 receiptTruncation，只有结构本身不合法才会抛。
 * 对已收口的结果再次调用是安全的，之前的省略计数会保留。
 */
export function boundedTransactionResult(result: ApplicationTransactionResult): ApplicationTransactionResult {
  if (result.status === 'submitted') return applicationTransactionResultSchema.parse(result)
  const omitted: Omitted = result.status === 'waiting_user' ? {} : { ...result.receiptTruncation?.omitted }
  if (result.status === 'waiting_user') {
    return applicationTransactionResultSchema.parse({ ...result, reason: text(result.reason, LIMITS.text, omitted) })
  }
  const bounded = result.status === 'completed'
    ? {
        ...result,
        resultRefs: take(result.resultRefs, LIMITS.resultRefs, 'resultRefs', omitted),
        effects: effectList(result.effects, omitted),
        evidence: evidenceList(result.evidence, 'evidence', omitted),
        verification: verificationResult(result.verification, omitted),
      }
    : {
        ...result,
        message: text(result.message, LIMITS.message, omitted),
        ...(result.resultRefs ? { resultRefs: take(result.resultRefs, LIMITS.resultRefs, 'resultRefs', omitted) } : {}),
        ...(result.effects ? { effects: effectList(result.effects, omitted) } : {}),
        ...(result.verification ? { verification: verificationResult(result.verification, omitted) } : {}),
        ...(result.recoveryVerification ? { recoveryVerification: {
          conditions: result.recoveryVerification.conditions,
          evidence: evidenceList(prioritizeRecoveryEvidence(result.recoveryVerification), 'recoveryEvidence', omitted),
        } } : {}),
      }
  return applicationTransactionResultSchema.parse({
    ...bounded,
    ...(Object.keys(omitted).length > 0 ? { receiptTruncation: { omitted, note: TRUNCATION_NOTE } } : {}),
  })
}

/** 恢复时 evidence_fact 条件要在这份证据里找原文，所以它们排在前面，不被截断挤掉。 */
function prioritizeRecoveryEvidence(proof: NonNullable<Extract<ApplicationTransactionResult, { status: 'failed' }>['recoveryVerification']>): ApplicationEvidence[] {
  const required = new Set(proof.conditions.flatMap((condition) => condition.kind === 'evidence_fact' ? [condition.fact] : []))
  return [...proof.evidence.filter((item) => required.has(item.fact)), ...proof.evidence.filter((item) => !required.has(item.fact))]
}

/** 恢复核对不进事务回执，同样不能因为条件文字过长而丢掉结论。 */
export function boundedVerificationResult(verification: ApplicationVerificationResult): ApplicationVerificationResult {
  return verificationResult(verification, {})
}
