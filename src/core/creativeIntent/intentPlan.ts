import type { ApplicationRef } from '../application-control/identifiers'
import { refKey, type MotionProperty, type Pose } from './contracts'
import type { DeixisResolution } from './deixis'
import type { ExplanationEvent } from './schema'

export interface ReviewedIntentGoal { targetRef: ApplicationRef; property: MotionProperty; value: Pose[MotionProperty]; confirmed: boolean }
export interface IntentCurrentState { targetRef: ApplicationRef; pose: Pose; stateDigest: string }
export interface IntentDifferencePlan {
  changes: { targetRef: ApplicationRef; property: MotionProperty; before: Pose[MotionProperty]; after: Pose[MotionProperty]; expectedDigest: string }[]
  protectedRefs: ApplicationRef[]; issues: string[]; status: 'blocked' | 'review' | 'satisfied'
  /** Provenance only. These operations MUST NOT be sent to an executor. */
  recordedOperationRefs: ApplicationRef[]
}

/** Candidate bridges accept reviewed differences only; recorded commands remain provenance. */
export function reviewedMovementChanges(plans: readonly IntentDifferencePlan[]): IntentDifferencePlan['changes'] {
  if (plans.some(plan => plan.status === 'blocked' || plan.issues.length)) throw new Error('请先确认讲解中的对象和目标位置')
  const protectedKeys = new Set(plans.flatMap(plan => plan.protectedRefs.map(refKey)))
  const changes = plans.flatMap(plan => plan.changes), seen = new Set<string>()
  if (!changes.length) throw new Error('当前没有需要移动的对象')
  for (const change of changes) {
    const key = refKey(change.targetRef)
    if (protectedKeys.has(key)) throw new Error('移动包含保护对象，请重新确认')
    if (seen.has(key)) throw new Error('同一对象有多个移动目标，请分别生成候选')
    seen.add(key)
    if (change.property !== 'position' || !Array.isArray(change.after) || change.after.length !== 2 || !change.after.every(Number.isFinite)) throw new Error('请确认要移动到的位置')
  }
  return changes
}
export function buildIntentDifferencePlan(resolutions: readonly DeixisResolution[], goals: readonly ReviewedIntentGoal[], current: readonly IntentCurrentState[], events: readonly ExplanationEvent[]): IntentDifferencePlan {
  const issues = resolutions.flatMap(resolution => [...resolution.issues, ...resolution.mentions.flatMap(mention => mention.selected ? [] : mention.issues.length ? mention.issues : ['指代尚未确认'])])
  if (resolutions.some(resolution => !resolution.negated && (resolution.dwellSeconds !== undefined || resolution.exitDirection || resolution.mentions.some(mention => mention.slot === 'dwell' || mention.slot === 'exit')))) issues.push('包含停留或离开要求，需要确认完整时间变化后再生成计划')
  const protectedRefs = [...new Map(resolutions.filter(resolution => resolution.negated).flatMap(resolution => resolution.mentions.flatMap(mention => mention.selected?.targetRefs ?? [])).map(ref => [refKey(ref), ref])).values()]
  const changes: IntentDifferencePlan['changes'] = []
  const keys = new Set<string>()
  for (const goal of goals) {
    const key = `${refKey(goal.targetRef)}:${goal.property}`
    if (keys.has(key)) { issues.push('同一对象的属性目标冲突，需确认'); continue }
    keys.add(key)
    if (!goal.confirmed) { issues.push('差异目标尚未确认'); continue }
    if (protectedRefs.some(ref => refKey(ref) === refKey(goal.targetRef))) { issues.push('“别动它”保护的对象不能生成修改'); continue }
    if (!resolutions.some(resolution => !resolution.negated && resolution.mentions.some(mention => mention.selected?.targetRefs.some(ref => refKey(ref) === refKey(goal.targetRef))))) { issues.push('目标没有肯定且已确认的指代'); continue }
    const state = current.find(value => refKey(value.targetRef) === refKey(goal.targetRef))
    if (!state) { issues.push('当前对象已不存在，请重新审阅'); continue }
    if (!/^sha256:[a-f0-9]{64}$/.test(state.stateDigest)) { issues.push('当前状态缺少有效基线'); continue }
    const valid = typeof goal.value === 'number' ? Number.isFinite(goal.value) && goal.property === 'rotationTurns' : goal.value.length === 2 && goal.value.every(Number.isFinite) && goal.property !== 'rotationTurns' && (goal.property !== 'scaleXY' || goal.value.every(value => value > 0))
    if (!valid) { issues.push('目标属性值不合法'); continue }
    if (JSON.stringify(state.pose[goal.property]) !== JSON.stringify(goal.value)) changes.push({ targetRef: goal.targetRef, property: goal.property, before: state.pose[goal.property], after: goal.value, expectedDigest: state.stateDigest })
  }
  const recorded = new Map<string, ApplicationRef>()
  for (const event of events) if (event.kind === 'command' && ['committed', 'undo', 'redo'].includes(event.phase)) recorded.set(refKey(event.operationRef), event.operationRef)
  const recordedOperationRefs = [...recorded.values()]
  return { changes: issues.length ? [] : changes, protectedRefs, issues: [...new Set(issues)], status: issues.length ? 'blocked' : changes.length ? 'review' : 'satisfied', recordedOperationRefs }
}
