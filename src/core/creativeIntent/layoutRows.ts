import type { LayoutItem } from './layout'
import { refKey, type LayoutConstraint } from './contracts'
import { checkCancelled, type ComputationControl } from './sampling'

/** Compile host-generated spacing into the existing solver contract, retaining other constraints. */
export function layoutRowConstraints(items: readonly LayoutItem[], constraints: readonly LayoutConstraint[], control: ComputationControl): { items: LayoutItem[]; constraints: LayoutConstraint[] } | null {
  const spacing = constraints.find(c => c.kind === 'distribute' && c.gapRatio === undefined)
  if (!spacing || spacing.kind !== 'distribute') return null
  const keys = new Set(spacing.targets.map(refKey))
  const alignment = constraints.find(c => c.kind === 'align' && c.axis !== spacing.axis && c.targets.length === keys.size && c.targets.every(t => keys.has(refKey(t))))
  if (!alignment || alignment.kind !== 'align' || alignment.edge !== 'start') return null
  const axis = spacing.axis === 'x' ? 0 : 1, cross = axis === 0 ? 1 : 0
  const measured = items.filter(item => keys.has(refKey(item.targetRef))).map(item => {
    const min = [Math.min(...item.worldCorners.map(p => p[0])), Math.min(...item.worldCorners.map(p => p[1]))]
    const max = [Math.max(...item.worldCorners.map(p => p[0])), Math.max(...item.worldCorners.map(p => p[1]))]
    return { item, min, max, center: (min[cross] + max[cross]) / 2 }
  })
  if (measured.length !== keys.size) return null // Let the solver report the missing reference.
  const extent = measured.reduce((range, m) => [Math.min(range[0], m.min[axis]), Math.max(range[1], m.max[axis])], [Infinity, -Infinity])
  const span = extent[1] - extent[0]
  if (measured.reduce((total, m) => total + m.max[axis] - m.min[axis], 0) <= span) return null
  const rows: typeof measured[] = []
  const heights = measured.map(m => m.max[cross] - m.min[cross]).sort((a, b) => a - b)
  const rowTolerance = heights[Math.floor(heights.length / 2)] * 1.5
  for (const member of [...measured].sort((a, b) => a.center - b.center)) {
    checkCancelled(control)
    const row = rows.at(-1)
    // Compare with the row's first center, so staggered objects cannot chain every row together.
    if (row && member.center - row[0].center <= rowTolerance) row.push(member)
    else rows.push([member])
  }
  if (rows.length < 2) return null
  const result = constraints.filter(c => c !== spacing && c !== alignment)
  const solveItems = [...items]
  rows.forEach((row, index) => {
    row.sort((a, b) => a.min[axis] - b.min[axis])
    if (row.length < 2) return
    const targets = row.map(m => m.item.targetRef)
    const reference = row.find(m => m.item.translationLocked)?.item.targetRef ?? targets[0]
    result.push({ ...alignment, id: `${alignment.id}-row-${index}`, targets, reference })
    const width = row.reduce((sum, m) => sum + m.max[axis] - m.min[axis], 0)
    const naturalGap = (row.at(-1)!.max[axis] - row[0].min[axis] - width) / (row.length - 1)
    const gap = Math.max(naturalGap, row.reduce((min, m) => Math.min(min, m.max[axis] - m.min[axis]), Infinity) * .2)
    if (row.length >= 3) result.push({ ...spacing, id: `${spacing.id}-row-${index}`, targets, gapRatio: gap })
    else {
      // A two-item row needs an edge anchor because the distribution contract requires three targets.
      const anchor = row.find(m => m.item.translationLocked) ?? row[0]
      const other = row.find(m => m !== anchor)!
      const position = anchor === row[0] ? anchor.max[axis] + gap : anchor.min[axis] - gap - (other.max[axis] - other.min[axis])
      const point: [number, number] = axis === 0 ? [position, other.min[cross]] : [other.min[cross], position]
      const target: LayoutItem = { targetRef: { kind: 'creative_intent.layout_anchor', id: `${spacing.id}-row-${index}` }, affine: [1, 0, 0, 1, ...point], worldCorners: [point, [point[0] + 1, point[1]], [point[0] + 1, point[1] + 1]], translationLocked: true }
      solveItems.push(target)
      result.push({ ...alignment, id: `${spacing.id}-pair-${index}`, axis: spacing.axis, targets: [other.item.targetRef, target.targetRef], reference: target.targetRef })
    }
  })
  return { items: solveItems, constraints: result }
}
