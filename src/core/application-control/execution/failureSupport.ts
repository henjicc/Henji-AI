import { applicationTransactionResultSchema, type ApplicationTransactionResult, type ApplicationChangePlan, type ApplicationPlannedStep } from '../transactions'
import type { ApplicationExecutionContext } from './types'
import { ApplicationExecutionSupport } from './executionSupport'
import { ApplicationPersistenceBoundaryFailure, ApplicationExecutionProgressFailure, type ApplicationPersistenceReceipt } from './persistence'

function failure(
  code: Extract<ApplicationTransactionResult, { status: 'failed' }>['code'],
  message: string,
  recoverable: boolean,
  extra: Partial<Omit<Extract<ApplicationTransactionResult, { status: 'failed' }>, 'status' | 'code' | 'message' | 'recoverable'>> = {}
): ApplicationTransactionResult {
  return applicationTransactionResultSchema.parse({ status: 'failed', code, message, recoverable, ...extra })
}

function mergeRevisions(target: Record<string, number>, source: Record<string, number>): void {
  for (const [scope, revision] of Object.entries(source)) target[scope] = revision
}

function planRevisions(plan: ApplicationChangePlan): Record<string, number> {
  const revisions: Record<string, number> = {}
  for (const step of plan.steps) {
    for (const [scope, revision] of Object.entries(step.expectedRevisions)) {
      const current = revisions[scope]
      if (current !== undefined && current !== revision) throw new Error(`PLAN_REVISION_CONFLICT:${scope}`)
      revisions[scope] = revision
    }
  }
  return revisions
}

export class ApplicationExecutionFailureSupport extends ApplicationExecutionSupport {
  protected async handleExecutionFailure(
    error: unknown,
    plan: ApplicationChangePlan,
    transactionRef: string,
    _context: ApplicationExecutionContext,
    receipts: ApplicationPersistenceReceipt[] = [],
  ): Promise<ApplicationTransactionResult> {
    if (error instanceof ApplicationPersistenceBoundaryFailure) return this.describePersistenceFailure(error, plan.steps, _context, transactionRef)
    if (error instanceof ApplicationExecutionProgressFailure) return this.describeProgressFailure(error, plan.steps, _context, transactionRef, receipts)
    return this.toFailure(error, transactionRef, planRevisions(plan))
  }

  /** commit 与 undo 共用实际已执行事实；撤销的索引始终指向原计划步骤。 */
  protected async describePersistenceFailure(error: ApplicationPersistenceBoundaryFailure,
    steps: ApplicationPlannedStep[], context: ApplicationExecutionContext, transactionRef?: string,
    direction: 'commit' | 'undo' = 'commit'): Promise<ApplicationTransactionResult> {
    const result = this.toFailure(error, transactionRef)
    return this.describeRemainingFacts(error.completed, error.completedStepIndexes,
      error.executionFailure?.compensatedStepIndexes ?? [], steps, context, result, direction)
  }

  protected async describeProgressFailure(error: ApplicationExecutionProgressFailure, steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext, transactionRef?: string, receipts: ApplicationPersistenceReceipt[] = [],
    direction: 'commit' | 'undo' = 'commit'): Promise<ApplicationTransactionResult> {
    const result = this.toFailure(error, transactionRef)
    if (result.status !== 'failed') return result
    return this.describeRemainingFacts(error.completed, error.completedStepIndexes, error.compensatedStepIndexes, steps, context,
      { ...result, effects: receipts.flatMap((receipt) => receipt.effects), currentRevisions: Object.assign({}, ...receipts.map((receipt) => receipt.resultingRevisions)) }, direction)
  }

  private async describeRemainingFacts(completed: import('./types').ApplicationCompletedStepResult[], indexes: number[], compensated: number[],
    steps: ApplicationPlannedStep[], context: ApplicationExecutionContext, result: ApplicationTransactionResult,
    direction: 'commit' | 'undo'): Promise<ApplicationTransactionResult> {
    if (result.status !== 'failed') return result
    const remaining = completed.map((item, offset) => ({ item, index: indexes[offset] }))
      .filter(({ index }) => !compensated.includes(index))
    const effects = this.collectEffects(remaining.map(({ index }) => steps[index]), remaining.map(({ item }) => item), direction)
    const current = await this.readCurrentRevisions(steps, context).catch(() => ({}))
    const completedRevisions = Object.assign({}, ...completed.map((item) => item.resultingRevisions)) as Record<string, number>
    return { ...result, currentRevisions: { ...completedRevisions, ...result.currentRevisions, ...current },
      resultRefs: remaining.flatMap(({ item }) => item.directRefs),
      effects: [...effects, ...(result.effects ?? [])] }
  }

  protected toFailure(
    error: unknown,
    transactionRef?: string,
    currentRevisions?: Record<string, number>
  ): ApplicationTransactionResult {
    if (error instanceof ApplicationExecutionProgressFailure) {
      const indexes = error.completedStepIndexes
      const uncompensated = indexes.filter((index) => !error.compensatedStepIndexes.includes(index))
      const state = indexes.length === 0 ? '没有任何步骤被提交，应用状态未改变。'
        : uncompensated.length === 0 ? '已完成步骤均已补偿。' : '仍有已执行的步骤未补偿，请先检查当前内容，不要重复已执行的步骤。'
      // 原因只写业务原文；完成、补偿到哪一步由 partial 字段表达，不拼进文案。
      return failure('EXECUTION_FAILED', `${indexes.length === 0 ? '操作失败' : '操作未完整完成'}：${error.message.replace(/[。.]$/, '')}。${state}`.slice(0, 2000), uncompensated.length === 0, {
        transactionRef, partial: { completedStepIndexes: indexes, compensatedStepIndexes: error.compensatedStepIndexes,
          uncompensatedStepIndexes: uncompensated },
      })
    }
    if (error instanceof ApplicationPersistenceBoundaryFailure) {
      const indexes = error.completedStepIndexes
      const compensated = error.executionFailure?.compensatedStepIndexes ?? []
      const revisions: Record<string, number> = {}
      error.completed.forEach((result) => mergeRevisions(revisions, result.resultingRevisions))
      error.receipts.forEach((receipt) => mergeRevisions(revisions, receipt.resultingRevisions))
      return failure('EXECUTION_FAILED', error.executionFailure
        ? `${error.message} 原业务失败：${error.executionFailure.message}`.slice(0, 2000) : error.message, true, {
        transactionRef,
        currentRevisions: revisions,
        effects: error.receipts.flatMap((receipt) => receipt.effects),
        partial: { completedStepIndexes: indexes, compensatedStepIndexes: compensated,
          uncompensatedStepIndexes: indexes.filter((index) => !compensated.includes(index)) },
        persistence: error.failure.facts,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('REVISION_CONFLICT')) {
      return failure('CONFLICT', '应用状态已变化，请重新观察并规划。', true, { transactionRef, currentRevisions })
    }
    // 属性写不了要报出是哪条、以及这个实体上有哪些能写——原始错误里已经带了这些，
    // 归类时丢掉它们，模型看到的就只剩"权限或可写状态已变化"，无从自纠。
    if (message.includes('PROPERTY_NOT_WRITABLE') || message.includes('PROPERTY_OPERATION_NOT_SUPPORTED')) {
      return failure('PERMISSION_DENIED', `属性写入被拒绝。原因：${message}`, true, { transactionRef })
    }
    if (message.includes('COLLECTION_CREATE_NOT_AVAILABLE') || message.includes('COLLECTION_REMOVE_NOT_AVAILABLE')) {
      return failure('PERMISSION_DENIED', `集合写入被拒绝。原因：${message}`, true, { transactionRef })
    }
    if (message.includes('PERMISSION_DENIED')) {
      return failure('PERMISSION_DENIED', '提交时权限或属性可写状态已变化。', true, { transactionRef })
    }
    if (message.includes('NOT_FOUND')) return failure('NOT_FOUND', `计划引用的对象不存在。原因：${message}`, true, { transactionRef })
    if (message === 'CANCELLED') return failure('CANCELLED', '操作已取消。', false, { transactionRef })
    // 兜底分支同样要带上原始错误：否则任何未归类的失败对调用方都只是"应用事务执行失败"，
    // 既无法自我修正，也无法据以判断该不该重试。
    return failure('EXECUTION_FAILED', `应用事务执行失败。原因：${message}`, false, { transactionRef })
  }


}
