import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { inverseAffine, translateAffine, type Affine, type Point } from '../imaging/transforms'
import { Constraint, Expression, Operator, Solver, Strength, Variable } from '@lume/kiwi'
import { affineSchema, candidateIdentitySchema, layoutConstraintSchema, pointSchema, refKey, type LayoutConstraint, type CandidateIdentity } from './contracts'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'
import { eliminateLayoutEqualities } from './layoutElimination'

export const layoutItemSchema = z.object({ targetRef: applicationRefSchema, affine: affineSchema, worldCorners: z.array(pointSchema).min(3), translationLocked: z.boolean(), groupRef: applicationRefSchema.optional() }).strict()
export type LayoutItem = z.infer<typeof layoutItemSchema>
export interface LayoutCandidate { id: string; label: string; identity: CandidateIdentity; changes: { targetRef: LayoutItem['targetRef']; affine: Affine; delta: Point }[]; maxConstraintError: number }
type Bounds = { min: Point; max: Point }

/** Corners are measured by the host's real geometry (crop, text, rotation, ancestors included). */
function bounds(item: LayoutItem): Bounds {
  return { min: [Math.min(...item.worldCorners.map(p => p[0])), Math.min(...item.worldCorners.map(p => p[1]))], max: [Math.max(...item.worldCorners.map(p => p[0])), Math.max(...item.worldCorners.map(p => p[1]))] }
}

function checkLayoutConstraints(items: readonly LayoutItem[], deltas: readonly Point[], constraints: readonly LayoutConstraint[]): number {
  const map = new Map(items.map((v, i) => [refKey(v.targetRef), { bounds: bounds(v), delta: deltas[i] }]))
  const edge = (ref: LayoutItem['targetRef'], axis: 0 | 1, side: 'start' | 'end' | 'center'): number => {
    const v = map.get(refKey(ref)); if (!v) throw new CreativeIntentError('layout-ref', [refKey(ref)], '目标缺正式几何')
    return v.delta[axis] + (side === 'start' ? v.bounds.min[axis] : side === 'end' ? v.bounds.max[axis] : (v.bounds.min[axis] + v.bounds.max[axis]) / 2)
  }
  const errors: number[] = []
  for (const c of constraints.filter(c => c.strength === 'hard')) {
    const axis = c.axis === 'x' ? 0 : 1
    if (c.kind === 'align') c.targets.forEach(ref => errors.push(Math.abs(edge(ref, axis, c.edge) - edge(c.reference, axis, c.edge))))
    else {
      const gaps = c.targets.slice(1).map((ref, i) => edge(ref, axis, 'start') - edge(c.targets[i], axis, 'end'))
      gaps.forEach(g => { errors.push(Math.max(0, -g), Math.abs(g - (c.gapRatio ?? gaps[0]))) })
    }
  }
  const max = errors.reduce((v, error) => Math.max(v, error), 0)
  if (max > 1e-8) throw new CreativeIntentError('layout-residual', [], '正式布局读回不满足硬约束')
  return max
}

export function solveStaticLayout(itemsInput: readonly LayoutItem[], constraintsInput: readonly LayoutConstraint[], identity: CandidateIdentity, control: ComputationControl = {}, engine: 'auto' | 'cassowary' = 'auto'): LayoutCandidate {
  const items = itemsInput.map(i => layoutItemSchema.parse(i)); const solver = new Solver()
  const constraints = constraintsInput.map(c => layoutConstraintSchema.parse(c)); candidateIdentitySchema.parse(identity)
  if (new Set(items.map(i => refKey(i.targetRef))).size !== items.length) throw new CreativeIntentError('layout-ref', [], '布局目标重复')
  for (const item of items) {
    try { inverseAffine(item.affine) } catch { throw new CreativeIntentError('layout-geometry', [refKey(item.targetRef)], '几何无解：目标变换不可逆') }
  }
  const eliminated = engine === 'auto' ? eliminateLayoutEqualities(items, constraints, control) : null
  if (eliminated) return { id: 'layout', label: '按真实边缘整理', identity, changes: items.map((item, i) => ({ targetRef: item.targetRef, affine: item.translationLocked ? item.affine : translateAffine(item.affine, eliminated[i]), delta: eliminated[i] })), maxConstraintError: checkLayoutConstraints(items, eliminated, constraints) }
  const itemMap = new Map(items.map(i => [refKey(i.targetRef), i])); const variables = new Map<string, [Variable, Variable]>()
  const geometry = new Map(items.map(i => [refKey(i.targetRef), bounds(i)])); const requiredErrors: (() => number)[] = []
  const add = (expression: Expression | Variable, rhs: number | Expression | Variable, strength = Strength.required): void => { solver.addConstraint(new Constraint(expression, Operator.Eq, rhs, strength)) }
  const find = (ref: LayoutItem['targetRef']): [Variable, Variable] => {
    const v = variables.get(refKey(ref)); if (!v) throw new CreativeIntentError('layout-ref', [refKey(ref)], '约束引用未声明目标'); return v
  }
  try {
    const groups = new Map<string, [Variable, Variable]>()
    for (let i = 0; i < items.length; i++) {
      if (i % 64 === 0) checkCancelled(control)
      const item = items[i]; inverseAffine(item.affine)
      const v: [Variable, Variable] = [new Variable(`${i}:x`), new Variable(`${i}:y`)]; variables.set(refKey(item.targetRef), v)
      for (const axis of [0, 1] as const) {
        if (item.translationLocked) { add(v[axis], 0); requiredErrors.push(() => Math.abs(v[axis].value())) }
        else { solver.addEditVariable(v[axis], Strength.weak); solver.suggestValue(v[axis], 0) }
      }
      if (item.groupRef) {
        const key = refKey(item.groupRef); const old = groups.get(key)
        if (old) for (const axis of [0, 1] as const) { add(v[axis], old[axis]); requiredErrors.push(() => Math.abs(v[axis].value() - old[axis].value())) }
        else groups.set(key, v)
      }
    }
    for (const c of constraints) {
      checkCancelled(control)
      if (new Set(c.targets.map(refKey)).size !== c.targets.length) throw new CreativeIntentError('layout-order', [c.id], '约束顺序包含重复目标')
      const axis = c.axis === 'x' ? 0 : 1; const strength = c.strength === 'hard' ? Strength.required : Strength.medium
      if (c.kind === 'align') {
        const edge = (ref: LayoutItem['targetRef']): Expression => {
          const g = geometry.get(refKey(ref)); if (!g) throw new CreativeIntentError('layout-ref', [c.id, refKey(ref)], '对齐参照不在目标集合')
          const p = c.edge === 'start' ? g.min[axis] : c.edge === 'end' ? g.max[axis] : (g.min[axis] + g.max[axis]) / 2
          return new Expression(find(ref)[axis], p)
        }
        const reference = edge(c.reference)
        for (const ref of c.targets) {
          const value = edge(ref); add(value, reference, strength)
          if (c.strength === 'hard') requiredErrors.push(() => valueValue(ref, c.edge, axis) - valueValue(c.reference, c.edge, axis))
        }
      } else {
        const gap = new Variable(`${c.id}:gap`)
        if (c.gapRatio !== undefined) add(gap, c.gapRatio, strength)
        solver.addConstraint(new Constraint(gap, Operator.Ge, 0, Strength.required))
        for (let i = 1; i < c.targets.length; i++) {
          const before = c.targets[i - 1]; const after = c.targets[i]; const a = geometry.get(refKey(before)); const b = geometry.get(refKey(after))
          if (!a || !b) throw new CreativeIntentError('layout-ref', [c.id], '等距目标缺真实边缘几何')
          const distance = new Expression(find(after)[axis], b.min[axis], [-1, find(before)[axis]], -a.max[axis])
          add(distance, gap, strength)
          if (c.strength === 'hard') requiredErrors.push(() => valueValue(after, 'start', axis) - valueValue(before, 'end', axis) - gap.value())
        }
        if (c.strength === 'hard' && c.gapRatio !== undefined) requiredErrors.push(() => gap.value() - c.gapRatio!)
      }
    }
    solver.updateVariables()
  } catch (e) {
    if (e instanceof CreativeIntentError) throw e
    throw new CreativeIntentError('layout-conflict', [...constraints.filter(c => c.strength === 'hard').map(c => c.id), ...items.filter(i => i.translationLocked).map(i => refKey(i.targetRef))], '硬对齐/等距/锁定或几何无解，请调整约束或解钉')
  }
  function valueValue(ref: LayoutItem['targetRef'], edge: 'start' | 'center' | 'end', axis: 0 | 1): number {
    const g = geometry.get(refKey(ref))!; return (edge === 'start' ? g.min[axis] : edge === 'end' ? g.max[axis] : (g.min[axis] + g.max[axis]) / 2) + find(ref)[axis].value()
  }
  const maxConstraintError = requiredErrors.reduce((value, f) => Math.max(value, Math.abs(f())), 0)
  if (maxConstraintError > 1e-8) throw new CreativeIntentError('layout-residual', [], '正式布局复核不满足硬约束')
  return { id: 'layout', label: '按真实边缘整理', identity, maxConstraintError, changes: items.map(item => {
    const v = find(item.targetRef); const delta: Point = item.translationLocked ? [0, 0] : [v[0].value(), v[1].value()]
    return { targetRef: itemMap.get(refKey(item.targetRef))!.targetRef, affine: item.translationLocked ? item.affine : translateAffine(item.affine, delta), delta }
  }) }
}

/** Hard constraints apply to every family. Soft equal spacing distinguishes a second suggestion. */
export function createLayoutCandidates(items: readonly LayoutItem[], constraints: readonly LayoutConstraint[], identity: CandidateIdentity, control: ComputationControl = {}): LayoutCandidate[] {
  const first = solveStaticLayout(items, constraints.filter(c => c.strength === 'hard' || c.kind === 'align'), identity, control)
  first.id = 'align'; first.label = '对齐边缘，贴近摆放'
  const second = solveStaticLayout(items, constraints, identity, control); second.id = 'distribute'; second.label = '对齐并按边缘等距'
  const signature = (v: LayoutCandidate): string => JSON.stringify(v.changes.map(c => c.affine.map(n => Math.round(n * 1e10) / 1e10)))
  return signature(first) === signature(second) ? [first] : [first, second]
}
