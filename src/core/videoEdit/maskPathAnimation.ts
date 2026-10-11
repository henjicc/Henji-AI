import { z } from 'zod'

const finite = z.number().finite()
/** Closed cubic path: vertex x/y, incoming and outgoing relative handles. */
export const videoEditMaskPointSchema = z.tuple([finite, finite, finite, finite, finite, finite])
export type VideoEditMaskPoint = z.infer<typeof videoEditMaskPointSchema>
const pointsSchema = z.array(videoEditMaskPointSchema).min(3)
export const videoEditMaskPathAnimationSchema = z.object({
  /** Stable point correspondence, in path order. One closed contour; holes are separate shapes. */
  pointIds: z.array(z.string().min(1)).min(3),
  keys: z.array(z.object({ sourceTimeUs: finite.nonnegative().max(Number.MAX_SAFE_INTEGER), points: pointsSchema, interpolation: z.enum(['linear', 'hold']) }).strict()).min(1),
}).strict().superRefine((animation, ctx) => {
  if (new Set(animation.pointIds).size !== animation.pointIds.length) ctx.addIssue({ code: 'custom', message: '路径点对应标识不能重复。' })
  for (let i = 0; i < animation.keys.length; i++) {
    const key = animation.keys[i]; const previous = animation.keys[i - 1]
    if (key.points.length !== animation.pointIds.length) ctx.addIssue({ code: 'custom', path: ['keys', i, 'points'], message: '路径点数与正式对应关系不一致，请重建或分段。' })
    if (previous && key.sourceTimeUs <= previous.sourceTimeUs) ctx.addIssue({ code: 'custom', path: ['keys', i], message: '路径源时刻须严格递增。' })
    if (!Number.isFinite(pathArea(key.points)) || Math.abs(pathArea(key.points)) < 1e-12) ctx.addIssue({ code: 'custom', path: ['keys', i], message: '路径退化，无法确认绕向。' })
    if (previous && previous.points.length === key.points.length && !samePathWinding(previous.points, key.points)) ctx.addIssue({ code: 'custom', path: ['keys', i], message: '路径绕向变化或中间退化，请重建或分段。' })
  }
})
export type VideoEditMaskPathAnimation = z.infer<typeof videoEditMaskPathAnimationSchema>

/** Three-point Gauss integration is exact for the cubic path's degree-five signed area. */
function pathArea(points: readonly VideoEditMaskPoint[]): number {
  let area = 0
  const roots = [(.5 - Math.sqrt(3 / 5) / 2), .5, (.5 + Math.sqrt(3 / 5) / 2)]
  const weights = [5 / 18, 4 / 9, 5 / 18]
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]
    roots.forEach((t, j) => {
      const u = 1 - t
      const p = (axis: number) => u ** 3 * a[axis] + 3 * u * u * t * (a[axis] + a[axis + 4]) + 3 * u * t * t * (b[axis] + b[axis + 2]) + t ** 3 * b[axis]
      const d = (axis: number) => 3 * u * u * a[axis + 4] + 6 * u * t * (b[axis] + b[axis + 2] - a[axis] - a[axis + 4]) - 3 * t * t * b[axis + 2]
      area += weights[j] * (p(0) * d(1) - p(1) * d(0)) / 2
    })
  })
  return area
}
function mixPath(a: readonly VideoEditMaskPoint[], b: readonly VideoEditMaskPoint[], t: number): VideoEditMaskPoint[] {
  return a.map((p, i) => p.map((v, c) => v + (b[i][c] - v) * t) as VideoEditMaskPoint)
}
export function samePathWinding(a: readonly VideoEditMaskPoint[], b: readonly VideoEditMaskPoint[]): boolean {
  if (a.length !== b.length) return false
  const start = pathArea(a); const end = pathArea(b); const middle = pathArea(mixPath(a, b, .5))
  const qa = 2 * (start + end - 2 * middle); const qb = end - start - qa
  const extremum = qa === 0 ? -1 : -qb / (2 * qa)
  const areas = [start, end, ...(extremum > 0 && extremum < 1 ? [start + qb * extremum + qa * extremum ** 2] : [])]
  return areas.every(v => Number.isFinite(v) && v * Math.sign(start) > 1e-12)
}

/** Shared by preview/export. Source anchored, so trims and retiming never rewrite path keys. */
export function evaluateVideoEditMaskPath<T extends { points: VideoEditMaskPoint[]; pathAnimation?: VideoEditMaskPathAnimation }>(shape: T, sourceTimeUs: number): T {
  const keys = shape.pathAnimation?.keys
  if (!keys) return shape
  if (!Number.isFinite(sourceTimeUs) || sourceTimeUs < 0) throw new Error('路径动画需要有效的源时刻。')
  let points: VideoEditMaskPoint[]
  if (sourceTimeUs <= keys[0].sourceTimeUs) points = keys[0].points
  else if (sourceTimeUs >= keys.at(-1)!.sourceTimeUs) points = keys.at(-1)!.points
  else {
    let lo = 0; let hi = keys.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].sourceTimeUs <= sourceTimeUs) lo = mid; else hi = mid }
    const a = keys[lo]; const b = keys[hi]
    points = a.interpolation === 'hold' ? a.points : mixPath(a.points, b.points, (sourceTimeUs - a.sourceTimeUs) / (b.sourceTimeUs - a.sourceTimeUs))
  }
  // A resolved shape is render data, not a second persistent animation truth.
  const result = { ...shape, points: points.map(p => [...p] as VideoEditMaskPoint) }
  delete result.pathAnimation
  return result
}
