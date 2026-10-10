import { motionDraftSchema, sameCandidateInput, type CandidateIdentity, type MotionDraft, type MotionSample } from './contracts'
import { compileMotionTake, type CompiledMotion, type MotionCompileContext } from './motionCompiler'
import { motionIntentSchema, type MotionIntent } from './recipe'
import { checkCancelled, CreativeIntentError, prepareMotionTakes, type ComputationControl } from './sampling'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'
import { inverseAffine, mapAffine } from '../imaging/transforms'

export const MOTION_ALGORITHM_VERSION = 'p1-schneider-native/1'
export interface MotionCandidate { id: string; label: string; identity: CandidateIdentity; motions: CompiledMotion[] }
export interface MotionCandidateResult { candidates: MotionCandidate[]; unavailable: { family: string; code: string; refs: readonly string[]; message: string }[] }
export interface OptimizeMotionInput { draft: MotionDraft; samples: readonly MotionSample[]; mappings: Record<string, MotionCompileContext>; selectedTakeIds?: readonly string[]; intent?: MotionIntent }

export function motionCandidateIdentity(draft: MotionDraft, request?: Pick<OptimizeMotionInput, 'mappings' | 'intent' | 'selectedTakeIds'>): CandidateIdentity {
  const requestKey = JSON.stringify({ fidelity: draft.fidelity, takes: request?.selectedTakeIds ? [...request.selectedTakeIds].sort() : null, intent: request?.intent ?? null, mappings: request?.mappings ? Object.entries(request.mappings).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : null })
  return { ownerRef: draft.ownerRef, sourceDraftDigest: draft.sourceDigest, algorithmVersion: MOTION_ALGORITHM_VERSION, requestKey, targetBases: draft.targets.map(t => ({ targetRef: t.ref, baseDigest: t.baseDigest, geometryDigest: t.geometryDigest })) }
}
export function assertCandidateCurrent(candidate: MotionCandidate, current: CandidateIdentity): void {
  if (!sameCandidateInput(candidate.identity, current)) throw new CreativeIntentError('stale-candidate', [candidate.id], '画面或草稿已变化，请重新预览')
}

function visiblyDifferent(a: MotionCandidate, b: MotionCandidate, input: OptimizeMotionInput, control: ComputationControl): boolean {
  if (a.motions.length !== b.motions.length) return true
  for (let i = 0; i < a.motions.length; i++) {
    const left = a.motions[i]; const right = b.motions[i]
    if (left.takeId !== right.takeId || JSON.stringify(left.range) !== JSON.stringify(right.range)) return true
    const mapping = input.mappings[left.takeId]; const inverse = inverseAffine(mapping.positionToNative)
    for (let frame = left.range[0]; frame <= left.range[1]; frame += .25) {
      if (Number.isInteger(frame) && frame % 256 === 0) checkCancelled(control)
      const value = (c: CompiledMotion, key: 'x' | 'y' | 'scale' | 'rotation' | 'anchorX' | 'anchorY'): number => evaluateVideoEditKeyframes(c.curves[key], frame, key === 'scale' ? 1 : 0)
      const p = mapAffine(inverse, [value(left, 'x') - value(right, 'x'), value(left, 'y') - value(right, 'y')])
      // Remove inverse translation: differences are vectors. This is a comparison, not another evaluator.
      if (Math.hypot(p[0] - inverse[4], p[1] - inverse[5]) > .0005 || Math.abs(value(left, 'rotation') - value(right, 'rotation')) > .1 || Math.abs(Math.log(value(left, 'scale') / value(right, 'scale'))) > .001 || Math.abs(value(left, 'anchorX') - value(right, 'anchorX')) > .0005 || Math.abs(value(left, 'anchorY') - value(right, 'anchorY')) > .0005) return true
    }
  }
  return false
}

/** Pure Worker-ready operation. It neither mutates raw pages nor commits any document change. */
export function optimizeMotionDraft(input: OptimizeMotionInput, control: ComputationControl = {}): MotionCandidateResult {
  const draft = motionDraftSchema.parse(input.draft)
  if (draft.mode !== 'animated') throw new CreativeIntentError('mode', [draft.id], '图片请使用静态布局操作')
  if (draft.constraints.length) throw new CreativeIntentError('unsupported-constraint', draft.constraints.map(c => c.id), '动画不能套用静态布局约束')
  const intent = input.intent && motionIntentSchema.parse(input.intent)
  const takes = prepareMotionTakes(draft, input.samples, input.selectedTakeIds, control)
  if (!takes.length) return { candidates: [], unavailable: [{ family: 'draft', code: 'no-demonstration', refs: [], message: '只有找位置或缺示范，请先摆姿态' }] }
  const families: { id: string; label: string; cleanup: boolean; intent?: MotionIntent }[] = [{ id: 'faithful', label: '保留原姿态与节奏', cleanup: false }, { id: 'clean', label: '保留停顿和转向，整理抖动', cleanup: !intent || intent.kind === 'follow_path' && !intent.preserveJitter }]
  if (intent && intent.kind !== 'follow_path') families.push({ id: 'intent', label: intent.kind === 'scale_focus' ? '保持焦点推近' : intent.kind === 'overshoot' ? '轻微过冲回落' : intent.kind === 'spring_settle' ? '有弹性地回落' : intent.kind === 'dwell' ? '保持指定停顿' : '沿指定直线移动', cleanup: false, intent })
  if (intent?.kind === 'overshoot' && draft.fidelity < 1) families.push({ id: 'expressive', label: '加强过冲后回落', cleanup: false, intent: { ...intent, amountRatio: intent.amountRatio * (1 + .5 * (1 - draft.fidelity)) } })
  if (intent?.kind === 'scale_focus' && draft.fidelity < 1) families.push({ id: 'steady-focus', label: '保持焦点，平稳推近', cleanup: false, intent: { ...intent, timingBlend: 1 - draft.fidelity } })
  const candidates: MotionCandidate[] = []; const unavailable: MotionCandidateResult['unavailable'] = []
  for (const family of families) {
    checkCancelled(control)
    try {
      const motions = takes.map(t => {
        const mapping = input.mappings[t.takeId]; if (!mapping) throw new CreativeIntentError('host-mapping', [t.takeId], '缺宿主坐标转换')
        return compileMotionTake(t, mapping, { fidelity: draft.fidelity, cleanup: family.cleanup, intent: family.intent }, control)
      })
      const candidate = { id: family.id, label: family.label, identity: motionCandidateIdentity(draft, input), motions }
      if (!candidates.some(c => !visiblyDifferent(c, candidate, input, control))) candidates.push(candidate)
      else unavailable.push({ family: family.id, code: 'no-distinct-result', refs: takes.map(t => t.takeId), message: '当前保真值和约束下与已有候选相同，保留原稿对照' })
      if (candidates.length === 3) break
    } catch (e) {
      if (!(e instanceof CreativeIntentError) || e.code === 'cancelled') throw e
      unavailable.push({ family: family.id, code: e.code, refs: e.refs, message: e.message })
    }
  }
  return { candidates, unavailable }
}

/** Stream independently sealed takes to a Worker sink. Results are partial until caller completes global pin/overlap checks. */
export async function* optimizeMotionBatches(source: AsyncIterable<OptimizeMotionInput>, control: ComputationControl = {}): AsyncGenerator<{ batch: number; partial: true; result: MotionCandidateResult }> {
  let batch = 0
  for await (const input of source) {
    checkCancelled(control); await control.checkpoint?.(); checkCancelled(control)
    yield { batch: batch++, partial: true, result: optimizeMotionDraft(input, control) }
  }
}
