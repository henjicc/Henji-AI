import { z } from 'zod'
import { agentEffectTargetSchema, isMutatingEffect, type AgentObservedEffect } from './observedEffect'
import type { OperationRecord } from './operations'
import type { AgentToolObservation } from './toolContracts'

export const executionIssueSchema = z.object({
  operationId: z.string().min(1), conditionId: z.string().min(1),
  state: z.enum(['failed', 'needs_check', 'not_executed']),
  summary: z.string().min(1).max(2000), targets: z.array(agentEffectTargetSchema),
}).strict()
export const executionFactsSchema = z.object({
  completion: z.enum(['completed', 'partial', 'needs_check', 'not_executed']),
  verificationStatus: z.enum(['passed', 'failed', 'pending', 'not_required']),
  resultRefs: z.array(agentEffectTargetSchema),
  unresolved: z.array(executionIssueSchema),
}).strict()
export type ExecutionFacts = z.infer<typeof executionFactsSchema>
export interface ExecutionFactsProjection {
  facts: ExecutionFacts
  effects: AgentObservedEffect[]
  summary: string
  evidence: string[]
  passed: boolean
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** 从正式操作记录汇总整项任务；工具观察仅补充尚无操作记录的旧执行入口。 */
export function projectExecutionFacts(records: readonly OperationRecord[], observations: readonly AgentToolObservation[] = []): ExecutionFactsProjection {
  const effects: AgentObservedEffect[] = []
  const refs = new Map<string, { kind: string; id: string }>()
  const unresolved: ExecutionFacts['unresolved'] = []
  const evidence = new Set<string>()
  let required = false
  let succeeded = false
  let changed = false
  const remember = (targets: readonly { kind: string; id: string }[]) => {
    for (const { kind, id } of targets) refs.set(`${kind}\0${id}`, { kind, id })
  }
  const issue = (operationId: string, conditionId: string, state: ExecutionFacts['unresolved'][number]['state'],
    summary: string, targets: { kind: string; id: string }[]) => unresolved.push({ operationId, conditionId, state, summary: summary.slice(0, 2000), targets })
  const leaves = records.filter((record) => !record.container && !record.readOnly && record.businessMutation !== false)
  for (const record of leaves) {
    const verified = record.verifications.length > 0 && record.verifications.every((item) => item.status === 'passed')
    const compensated = record.transaction?.partial
    const fullyCompensated = Boolean(compensated?.completedStepIndexes.length && !compensated.uncompensatedStepIndexes.length
      && compensated.completedStepIndexes.every((index) => compensated.compensatedStepIndexes.includes(index)))
    const actualEffects = record.effects.map((effect) => ({ ...effect, verified: verified || effect.verified }))
    effects.push(...actualEffects)
    remember(actualEffects.flatMap((effect) => effect.targetRefs))
    remember(record.persistenceReceipts.flatMap((receipt) => receipt.targets))
    remember(record.transaction?.resultRefs ?? [])
    for (const external of record.externalCalls) {
      remember([external.target])
      if (external.state !== 'completed') issue(record.operationId, `external:${external.source}:${external.key}`, 'needs_check',
        '已提交的外部任务尚未取得最终结果。', [external.target])
    }
    changed ||= actualEffects.some(isMutatingEffect) || record.persistenceReceipts.length > 0 || record.externalCalls.length > 0
    succeeded ||= record.state === 'completed'
    if (record.state === 'prepared' || record.state === 'not_executed') {
      // 确认未执行后重试复用原身份；其他成功调用不能代替原操作的正式终态。
      issue(record.operationId, 'execution', 'not_executed', record.error ?? '操作尚未执行。', record.targets)
      continue
    }
    required = true
    if (record.state === 'unknown' || record.state === 'dispatched') {
      issue(record.operationId, 'execution', 'needs_check', record.error ?? '原操作的执行结果仍待核对。', record.targets)
    } else if (record.state === 'partial' && !fullyCompensated && !verified) {
      issue(record.operationId, 'execution', 'failed', record.error ?? '原操作仅部分完成。', record.targets)
    }
    if (fullyCompensated) {
      evidence.add('已执行步骤具有完整补偿回执。')
      continue
    }
    if (!record.verifications.length) issue(record.operationId, 'formal_result', 'needs_check', '操作缺少正式结果验证。', record.targets)
    for (const verification of record.verifications) {
      verification.evidence.forEach((item) => evidence.add(item))
      if (verification.status !== 'passed') issue(record.operationId, verification.conditionId,
        verification.status === 'failed' ? 'failed' : 'needs_check',
        verification.status === 'failed' ? '对应操作的结果验证未通过。' : '对应操作的结果仍待正式验证。', verification.targets)
    }
  }
  // 运行记录已经持有叶子事实时，不能再把脚本包装层中的相同 Effect 计一遍。
  const recordedCalls = new Set(records.map((record) => record.toolCallId))
  for (const [index, observation] of observations.entries()) {
    if (recordedCalls.has(observation.source.toolCallId)) continue
    const output = object(observation.output)
    const verification = object(output?.verification)
    const isScript = ['run_henji_script', 'resume_henji_script'].includes(observation.source.toolName)
    const verifiedScript = isScript && output?.status === 'completed' && verification?.passed === true
    const observed = (observation.effects ?? []).map((effect) => ({ ...effect, verified: effect.verified || verifiedScript }))
    effects.push(...observed)
    remember(observed.flatMap((effect) => effect.targetRefs))
    changed ||= observed.some(isMutatingEffect)
    if (isScript && verification) {
      required ||= observed.some(isMutatingEffect)
      const items = Array.isArray(verification.evidence) ? verification.evidence : []
      items.filter((item): item is string => typeof item === 'string').forEach((item) => evidence.add(item))
      if (verification.passed !== true || output?.status === 'partial' || output?.status === 'failed') {
        issue(`${observation.source.toolCallId}:${index}`, 'script_result', output?.status === 'waiting_external' ? 'needs_check' : 'failed',
          typeof verification.summary === 'string' ? verification.summary : '脚本未通过完整验证。', observed.flatMap((effect) => effect.targetRefs))
      } else succeeded = true
    } else {
      succeeded = true
      if (observed.some(isMutatingEffect)) {
        required = true
        if (observed.some((effect) => isMutatingEffect(effect) && !effect.verified)) issue(`${observation.source.toolCallId}:${index}`,
          'formal_result', 'needs_check', '写入结果缺少正式验证。', observed.flatMap((effect) => effect.targetRefs))
      }
    }
  }
  // 容器失败可能发生在首个叶子调用之前，不能因没有 Effect 就宣称任务完成。
  for (const record of records.filter((item) => item.container)) {
    const output = object(record.output)
    const verification = object(output?.verification)
    if (record.state === 'prepared' || record.state === 'not_executed') {
      issue(record.operationId, 'script_execution', 'not_executed', '脚本尚未开始执行。', record.targets)
      continue
    }
    if (output?.status === 'completed' && verification?.passed === true) { succeeded = true; continue }
    if (records.some((next) => next.repairsOperationId === record.operationId && next.container
      && next.state === 'completed' && object(next.output)?.status === 'completed'
      && object(object(next.output)?.verification)?.passed === true)) continue
    if (!['partial', 'failed', 'waiting_external'].includes(String(output?.status)) && !['unknown', 'dispatched'].includes(record.state)) continue
    const children = records.filter((child) => child.parentToolCallId === record.toolCallId)
    if (children.length > 0 && children.every((child) => child.readOnly || child.businessMutation === false
      || (child.state === 'completed' && child.verifications.length > 0 && child.verifications.every((item) => item.status === 'passed')))) {
      // 叶子已核对仍不代表剩余脚本已执行；确定性续跑完成才关闭包装层失败。
      const resumed = records.some((next) => next.container && next.operationId !== record.operationId
        && object(next.output)?.scriptRunRef === output?.scriptRunRef && object(next.output)?.status === 'completed'
        && typeof output?.scriptRunRef === 'string')
      if (resumed) continue
    }
    if (!unresolved.some((item) => children.some((child) => child.operationId === item.operationId))) {
      issue(record.operationId, 'script_result', record.state === 'unknown' || record.state === 'dispatched' || output?.status === 'waiting_external' ? 'needs_check' : 'failed',
        '脚本仍有未执行或未确认的步骤。', record.targets)
    }
  }
  const needsCheck = unresolved.some((item) => item.state === 'needs_check')
  const completion = needsCheck ? 'needs_check' : unresolved.length ? (changed || succeeded ? 'partial' : 'not_executed') : 'completed'
  const verificationStatus = needsCheck ? 'pending' : unresolved.length ? 'failed' : required ? 'passed' : 'not_required'
  const facts: ExecutionFacts = { completion, verificationStatus, resultRefs: [...refs.values()], unresolved }
  const summary = completion === 'needs_check' ? '已保留实际结果，仍有操作或验证条件需要核对。'
    : completion === 'partial' ? '任务部分完成，已保留实际结果与未解决事项。'
      : completion === 'not_executed' ? '请求的操作尚未完成执行。'
        : required ? '已汇总全部操作，正式验证均已通过。' : '本轮没有应用写入，无需结构化验证。'
  return { facts, effects, summary, evidence: [...evidence].map((item) => item.slice(0, 500)).slice(0, 24),
    passed: verificationStatus === 'passed' || verificationStatus === 'not_required' }
}
