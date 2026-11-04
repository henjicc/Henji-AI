import type { ApplicationCompletedStepResult, ApplicationRef } from '@/core/application-control'
import { ApplicationExecutionProgressFailure, applicationFailureReason } from '@/core/application-control/execution/persistence'
import { requireCanvasProjectInstance } from './canvasProjectInstances'
import { CanvasPersistenceError, CanvasSourceCompensationError, CanvasTransactionConflictError } from './canvasPersistenceService'

/** 失败后仍留在画布里的一步写入；读不到修订时照样报告这一步有写入。 */
export function canvasRemainingWrite(projectId: string, refs: ApplicationRef[]): ApplicationCompletedStepResult {
  let resultingRevisions: Record<string, number> = {}
  try { resultingRevisions = { canvas: requireCanvasProjectInstance(projectId).snapshot().updatedAt } } catch { /* 画布实例已不在 */ }
  return { status: 'completed', resultingRevisions, directRefs: refs, evidence: [] }
}

/**
 * 通用事务里，画布内核的这三类失败都发生在写入之后：保存未确认时修改留在内存里，并发冲突时连同本次写入
 * 一起保留了当前内容，来源补偿失败时外部来源仍留着。原样抛给引擎会被报成没有任何步骤被提交、可以直接重试，
 * 这里换成带着写入事实的进度失败。`remaining` 按步骤给出留下的写入；新建结果的引用只有保存失败时才知道。
 */
export function canvasStepFailure(error: unknown, remaining: (createdRefs: ApplicationRef[]) => ApplicationCompletedStepResult[]): unknown {
  // 没有事务事实的保存失败来自回滚：内存已恢复原画布，这一步没有留下写入。
  if (error instanceof CanvasPersistenceError && error.transactionFacts) {
    return new ApplicationExecutionProgressFailure(error.message, remaining(error.transactionFacts.resultRefs ?? []), [], error)
  }
  // 冲突时留下的若只是没撤回的来源副本，要报来源补偿的原因，错误码仍按冲突。
  if (error instanceof CanvasTransactionConflictError && error.cause instanceof CanvasSourceCompensationError) {
    return new ApplicationExecutionProgressFailure(compensationMessage(error.cause), remaining([]), [], error)
  }
  if (error instanceof CanvasTransactionConflictError && error.transactionWrote) return new ApplicationExecutionProgressFailure(error.message, remaining([]), [], error)
  if (error instanceof CanvasSourceCompensationError) return new ApplicationExecutionProgressFailure(compensationMessage(error), remaining([]), [], error.errors[0])
  return error
}

function compensationMessage(error: CanvasSourceCompensationError): string {
  const [original, ...failures] = error.errors
  return `${applicationFailureReason(original)}；${error.message}：${failures.map(applicationFailureReason).join('；')}`
}
