import { normalizeApplicationRefLabel, type ApplicationRef } from '../identifiers'
import type { ApplicationEffectReceipt, ApplicationPlannedStep } from '../transactions'
import type { ApplicationCascadeEffectDeclaration, ApplicationCompletedStepResult, ApplicationExecutionContext } from './types'

export interface ApplicationPersistenceReceipt {
  effects: ApplicationEffectReceipt[]
  resultingRevisions: Record<string, number>
}

/** Effect 的 refs 来自领域执行器或持久化回执，label 在进入事务结果前统一收敛到契约长度。 */
export function normalizeEffectRefLabels(effect: ApplicationEffectReceipt): ApplicationEffectReceipt {
  return { ...effect, refs: effect.refs.map(normalizeApplicationRefLabel) }
}

interface ApplicationPersistenceRecovery {
  capabilityId: string
  target: ApplicationRef
  replayMutation: false
  ownerId?: string
}

export interface ApplicationPersistenceFacts {
  memoryState: 'modified' | 'preserved'
  persistenceState: 'unconfirmed'
  stage: 'document' | 'projection'
  recovery: ApplicationPersistenceRecovery
}

/** 存储确认失败不是业务命令失败，调用者不得重放或自动撤销已应用命令。 */
export class ApplicationPersistenceFailure extends Error {
  constructor(message: string, readonly facts: ApplicationPersistenceFacts, readonly cause?: unknown,
    readonly receipt?: ApplicationPersistenceReceipt) {
    super(message)
    this.name = 'ApplicationPersistenceFailure'
  }
}

export interface ApplicationPersistenceBatch {
  confirm(): Promise<ApplicationPersistenceReceipt | void>
  release(): void
}

export interface ApplicationPersistenceParticipant {
  readonly key: string
  readonly persistenceEffects?: readonly ApplicationCascadeEffectDeclaration[]
  begin(): ApplicationPersistenceBatch
}

export type ApplicationPersistenceResolver = (
  steps: readonly ApplicationPlannedStep[],
  context: ApplicationExecutionContext,
) => readonly ApplicationPersistenceParticipant[]

export class ApplicationPersistenceBoundaryFailure extends Error {
  constructor(
    readonly failure: ApplicationPersistenceFailure,
    readonly completed: ApplicationCompletedStepResult[],
    readonly executionFailure?: ApplicationExecutionProgressFailure,
    readonly receipts: ApplicationPersistenceReceipt[] = [],
    readonly completedStepIndexes: number[] = executionFailure?.completedStepIndexes ?? completed.map((_, index) => index),
  ) {
    super(failure.message)
    this.name = 'ApplicationPersistenceBoundaryFailure'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 取消有两个来源：引擎的 CANCELLED 标记，以及 AbortSignal 抛出的 AbortError（撤销授权同名）。 */
export function isApplicationCancellation(error: unknown): boolean {
  return errorMessage(error) === 'CANCELLED'
    || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError')
}

/** 领域自己的并发冲突（文案已是用户能懂的话）继承它，引擎按类型认出冲突，不靠内部标记文本。 */
export class ApplicationConflictError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ApplicationConflictError'
  }
}

function hasConflictMarker(error: unknown): boolean {
  return errorMessage(error).includes('REVISION_CONFLICT')
}

export function isApplicationConflict(error: unknown): boolean {
  return error instanceof ApplicationConflictError || hasConflictMarker(error)
}

/**
 * 执行器内部的校验失败（zod 的 message 是整段 JSON）一路被拼进错误文案：调用方要从带缩进的 JSON 里
 * 找字段路径，也容易被整段灌满上下文。出口统一改写成「字段路径: 原因」。
 */
export function humanizeSchemaIssueJson(message: string): string {
  return message.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, (block) => {
    try {
      const issues = JSON.parse(block) as unknown
      if (!Array.isArray(issues) || !issues.length || !issues.every(issue => issue && typeof issue === 'object' && 'message' in issue && Array.isArray((issue as { path?: unknown }).path))) return block
      const lines = (issues as Array<{ path: unknown[]; message: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean; expected?: unknown }>).slice(0, 6).map(issue => {
        const path = issue.path.map(String).join('.') || '(根)'
        // 只在原文没说清时补边界：zod 的通用原文是 Invalid input
        const vague = !/\d|expected/i.test(issue.message)
        const strict = issue.inclusive === false
        const bound = !vague ? '' : issue.minimum !== undefined ? `（${strict ? '须大于' : '最小'} ${String(issue.minimum)}）` : issue.maximum !== undefined ? `（${strict ? '须小于' : '最大'} ${String(issue.maximum)}）` : issue.expected !== undefined ? `（应为 ${String(issue.expected)}）` : ''
        return `${path}: ${issue.message}${bound}`
      })
      return `${lines.join('；')}${issues.length > lines.length ? `；另有 ${issues.length - lines.length} 处` : ''}`
    } catch { return block }
  })
}

/**
 * 冲突要说出是哪个作用域变了：只说“状态已变化”时，调用方不知道该重读哪个对象，
 * 实测会原样重试同一份过期计划直到放弃。
 */
export function applicationConflictReason(error: unknown): string {
  const detail = /(?:PLAN_)?REVISION_CONFLICT:(.+)$/s.exec(errorMessage(error))?.[1]?.trim()
  const reread = '请重新读取用到它的对象（read_application_entity 或对应查询）后按最新状态重新提交'
  const scoped = detail ? /^([a-z][\w.:-]*?):(\d+)\/(\d+|undefined)$/.exec(detail) : null
  if (scoped) return `应用状态已变化：作用域 ${scoped[1]} 的修订已从 ${scoped[2]} 变为 ${scoped[3]}，${reread}`
  if (detail && /^[a-z][\w.:-]*$/.test(detail)) return `应用状态已变化：作用域 ${detail} 已改变，${reread}`
  if (detail && !/^[A-Z_]+(:|$)/.test(detail)) return `应用状态已变化：${detail.replace(/[。.]$/, '')}`
  return `应用状态已变化${detail ? `（${detail}）` : ''}，请重新读取受影响的对象后按最新状态重新提交`
}

/** 进度失败的文案原因：只取错误原文，不带 `Error: ` 前缀；取消与冲突的内部标记换成用户能懂的话。 */
export function applicationFailureReason(error: unknown): string {
  if (isApplicationCancellation(error)) return '操作已取消'
  if (hasConflictMarker(error)) return applicationConflictReason(error)
  return errorMessage(error)
}

export class ApplicationExecutionProgressFailure extends Error {
  constructor(message: string, readonly completed: ApplicationCompletedStepResult[],
    readonly compensatedStepIndexes: number[], readonly cause?: unknown,
    readonly completedStepIndexes: number[] = completed.map((_, index) => index)) {
    super(message)
    this.name = 'ApplicationExecutionProgressFailure'
  }
}

/** 进度失败层层包着的最初那条错误；错误码按它判断，外层包装不改变失败的性质。 */
export function applicationFailureOrigin(error: unknown): unknown {
  let current = error
  while (current instanceof ApplicationExecutionProgressFailure && current.cause !== undefined) current = current.cause
  return current
}

/**
 * 单步执行器写入失败后自行回滚。回滚也失败时，这一步的写入还留在应用里：带着执行器给出的剩余事实抛出，
 * 引擎据此报告“已执行未补偿”，不会说成没有任何步骤被提交。回滚成功则原样抛出写入错误。
 */
export async function rollbackStepWrites(error: unknown, rollback: () => Promise<unknown>,
  remaining: () => ApplicationCompletedStepResult | Promise<ApplicationCompletedStepResult>): Promise<never> {
  try {
    await rollback()
  } catch (rollbackError) {
    // 读不到剩余事实时仍报告“这一步有写入未撤回”，只是不列出具体引用；不能退回成零步失败。
    const left = await Promise.resolve().then(remaining)
      .catch((): ApplicationCompletedStepResult => ({ status: 'completed', resultingRevisions: {}, directRefs: [], evidence: [] }))
    throw new ApplicationExecutionProgressFailure(
      `${applicationFailureReason(error)}；回滚未完成：${applicationFailureReason(rollbackError)}`, [left], [], error)
  }
  throw error
}

/**
 * 逐步执行的外层（引擎、执行器自己的原子组）包装失败时，失败的那一步可能已经带着自己的写入事实抛出。
 * 这些事实全部记在下标 `stepIndex` 上；这一步内部的回滚归执行器，外层不再补偿它：
 * 执行器已撤回全部写入时记为已补偿，否则记为未补偿。
 */
export function failedStepFacts(error: unknown, stepIndex: number): {
  results: ApplicationCompletedStepResult[]; indexes: number[]; compensated: number[]
} {
  if (!(error instanceof ApplicationExecutionProgressFailure) || error.completed.length === 0) {
    return { results: [], indexes: [], compensated: [] }
  }
  const withdrawn = error.completedStepIndexes.every((index) => error.compensatedStepIndexes.includes(index))
  return { results: error.completed, indexes: error.completed.map(() => stepIndex), compensated: withdrawn ? [stepIndex] : [] }
}

/** 唯一整批聚合点；未注册参与者的领域保持原执行语义。 */
export async function withApplicationPersistenceBoundary<T>(input: {
  participants: readonly ApplicationPersistenceParticipant[]
  context: ApplicationExecutionContext
  execute: (context: ApplicationExecutionContext) => Promise<T>
  completed: (result: T) => ApplicationCompletedStepResult[]
  completedIndexes?: (result: T) => number[]
  onReceipt?: (receipt: ApplicationPersistenceReceipt) => void
}): Promise<T> {
  const batches = new Map<string, ApplicationPersistenceBatch>()
  const participants = new Map(input.participants.map((participant) => [participant.key, participant]))
  const receipts: ApplicationPersistenceReceipt[] = []
  const acceptReceipt = (key: string, raw: ApplicationPersistenceReceipt | void): void => {
    if (!raw) return
    const receipt = { ...raw, effects: raw.effects.map(normalizeEffectRefLabels) }
    const declarations = participants.get(key)?.persistenceEffects ?? []
    for (const effect of receipt.effects) {
      const origin = effect.origin
      const declaration = origin.kind === 'cascade'
        ? declarations.find((candidate) => candidate.declarationId === origin.declarationId) : undefined
      if (!declaration || declaration.effect !== effect.effect || declaration.entityType !== effect.entityType
        || effect.refs.some((ref) => ref.kind !== declaration.entityType)
        || effect.propertyIds.some((propertyId) => !declaration.propertyIds.includes(propertyId))) {
        throw new Error('UNDECLARED_PERSISTENCE_EFFECT')
      }
    }
    if (Object.keys(receipt.resultingRevisions).some((scope) => !declarations.some((item) => item.revisionScopes.includes(scope)))) {
      throw new Error('UNDECLARED_PERSISTENCE_REVISION')
    }
    receipts.push(receipt)
    input.onReceipt?.(receipt)
  }
  const confirm = async (key: string, batch: ApplicationPersistenceBatch): Promise<void> => {
    try { acceptReceipt(key, await batch.confirm()) }
    catch (error) {
      if (error instanceof ApplicationPersistenceFailure) acceptReceipt(key, error.receipt)
      throw error
    }
  }
  try {
    for (const participant of input.participants) {
      if (!batches.has(participant.key)) batches.set(participant.key, participant.begin())
    }
    const context = { ...input.context, persistenceScopes: new Set(batches.keys()), persistenceBatches: new Map(batches) }
    let result: T
    try {
      result = await input.execute(context)
    } catch (error) {
      // 业务补偿结束后也确认其最终快照，不能只撤内存就宣称磁盘已恢复。
      for (const [key, batch] of batches) {
        try { await confirm(key, batch) }
        catch (failure) {
          if (failure instanceof ApplicationPersistenceFailure) {
            const progress = error instanceof ApplicationExecutionProgressFailure ? error : undefined
            throw new ApplicationPersistenceBoundaryFailure(failure, progress?.completed ?? [], progress, receipts)
          }
          throw failure
        }
      }
      throw error
    }
    try {
      for (const [key, batch] of batches) await confirm(key, batch)
    } catch (failure) {
      if (failure instanceof ApplicationPersistenceFailure) {
        throw new ApplicationPersistenceBoundaryFailure(failure, input.completed(result), undefined, receipts, input.completedIndexes?.(result))
      }
      throw failure
    }
    return result
  } finally {
    for (const batch of [...batches.values()].reverse()) batch.release()
  }
}
