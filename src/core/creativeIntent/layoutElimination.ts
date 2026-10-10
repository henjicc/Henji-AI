import type { Point } from '../imaging/transforms'
import { refKey, type LayoutConstraint } from './contracts'
import type { LayoutItem } from './layout'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'

/** Exact elimination of independent fixed-size alignment/gap equalities; coupled groups use Kiwi. */
export function eliminateLayoutEqualities(items: readonly LayoutItem[], constraints: readonly LayoutConstraint[], control: ComputationControl): Point[] | null {
  if (items.some(i => i.groupRef)) return null
  const index = new Map(items.map((item, i) => [refKey(item.targetRef), i])); const touched = new Set<string>()
  for (const c of constraints) for (const ref of c.kind === 'align' ? [...new Map([...c.targets, c.reference].map(ref => [refKey(ref), ref])).values()] : c.targets) {
    const key = JSON.stringify([refKey(ref), c.axis]); if (touched.has(key)) return null; touched.add(key)
  }
  const shifts: [number, number][] = items.map(() => [0, 0])
  const geometry = items.map(item => ({ min: [Math.min(...item.worldCorners.map(p => p[0])), Math.min(...item.worldCorners.map(p => p[1]))], max: [Math.max(...item.worldCorners.map(p => p[0])), Math.max(...item.worldCorners.map(p => p[1]))] }))
  const find = (ref: LayoutItem['targetRef']): number => { const i = index.get(refKey(ref)); if (i === undefined) throw new CreativeIntentError('layout-ref', [refKey(ref)], '约束目标缺真实边缘几何'); return i }
  for (const c of constraints) {
    checkCancelled(control)
    const axis = c.axis === 'x' ? 0 : 1; const ids = c.targets.map(find)
    if (new Set(ids).size !== ids.length) throw new CreativeIntentError('layout-order', [c.id], '布局顺序包含重复目标')
    if (c.kind === 'align') {
      const value = (i: number): number => c.edge === 'start' ? geometry[i].min[axis] : c.edge === 'end' ? geometry[i].max[axis] : (geometry[i].min[axis] + geometry[i].max[axis]) / 2
      const ref = find(c.reference); const locked = [...new Set([ref, ...ids])].filter(i => items[i].translationLocked)
      const anchor = locked[0] ?? ref; const edge = value(anchor)
      if (locked.some(i => Math.abs(value(i) - edge) > 1e-10)) {
        if (c.strength === 'hard') throw new CreativeIntentError('layout-conflict', [c.id, ...locked.map(i => refKey(items[i].targetRef))], '硬对齐与锁定对象冲突，请调整约束或解钉')
        continue
      }
      // The reference is also part of the relation, even when omitted from targets.
      for (const i of [...new Set([...ids, ref])]) shifts[i][axis] = items[i].translationLocked ? 0 : edge - value(i)
    } else {
      const width = ids.map(i => geometry[i].max[axis] - geometry[i].min[axis]); const prefix = [0]
      width.forEach(w => prefix.push(prefix[prefix.length - 1] + w))
      const locked = ids.map((i, j) => ({ i, j })).filter(({ i }) => items[i].translationLocked)
      let gap = c.gapRatio ?? Math.max(0, (geometry[ids[ids.length - 1]].max[axis] - geometry[ids[0]].min[axis] - prefix[prefix.length - 1]) / (ids.length - 1))
      if (locked.length >= 2) {
        const a = locked[0]; const b = locked[locked.length - 1]
        const feasibleGap = (geometry[b.i].min[axis] - geometry[a.i].min[axis] - prefix[b.j] + prefix[a.j]) / (b.j - a.j)
        if (c.strength === 'hard' && c.gapRatio !== undefined && Math.abs(feasibleGap - c.gapRatio) > 1e-10) throw new CreativeIntentError('layout-conflict', [c.id, ...locked.map(({ i }) => refKey(items[i].targetRef))], '硬等距与钉住位置冲突，请改间距或解钉')
        gap = feasibleGap
      }
      if (gap < 0) {
        if (c.strength === 'hard') throw new CreativeIntentError('layout-conflict', [c.id], '钉住范围不足以保持非负边缘间距')
        continue
      }
      const anchor = locked[0] ?? { i: ids[0], j: 0 }
      const origin = geometry[anchor.i].min[axis] - prefix[anchor.j] - anchor.j * gap
      if (locked.some(({ i, j }) => Math.abs(origin + prefix[j] + j * gap - geometry[i].min[axis]) > 1e-10)) return null
      ids.forEach((i, j) => { shifts[i][axis] = items[i].translationLocked ? 0 : origin + prefix[j] + j * gap - geometry[i].min[axis] })
    }
  }
  return shifts
}
