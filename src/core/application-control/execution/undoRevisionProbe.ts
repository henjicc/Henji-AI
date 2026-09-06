import type { ApplicationPlannedStep } from '../transactions'
import type { ApplicationCompletedStepResult } from './types'

function refKey(ref: { kind: string; id: string }): string {
  return `${ref.kind}\u0000${ref.id}`
}

/**
 * 找出撤销前按提交终态本就应当不存在的 mutation target。
 *
 * 只信任同一 UndoRecord 中已完成 collection.remove 的 directRefs；算法级联、推测删除或
 * 任意 NOT_FOUND 都不进入这个集合。删除之后若又有步骤直接影响同一 ref，也保守地恢复普通读取。
 */
export function resolveUndoExpectedAbsentMutations(
  steps: readonly ApplicationPlannedStep[],
  results: readonly ApplicationCompletedStepResult[],
): Map<number, number> {
  const lastDirectTouch = new Map<string, number>()
  results.forEach((result, index) => {
    result.directRefs.forEach((ref) => lastDirectTouch.set(refKey(ref), index))
  })
  const removalByTarget = new Map<string, number>()
  steps.forEach((step, index) => {
    if (step.kind !== 'collection' || step.operation.kind !== 'remove') return
    const completedRefs = new Set(results[index]?.directRefs.map(refKey) ?? [])
    step.operation.targets.forEach((target) => {
      const key = refKey(target)
      if (completedRefs.has(key) && lastDirectTouch.get(key) === index) {
        removalByTarget.set(key, index)
      }
    })
  })
  const expectedAbsent = new Map<number, number>()
  steps.forEach((step, index) => {
    if (step.kind !== 'mutation') return
    const removalIndex = removalByTarget.get(refKey(step.target))
    if (removalIndex !== undefined && removalIndex > index) expectedAbsent.set(index, removalIndex)
  })
  return expectedAbsent
}
