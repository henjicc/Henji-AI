import type { CodeSceneIssue } from './sceneDeclaration'
import { videoEditSceneFootprints } from './sceneFootprint'
import type { ResolvedVideoEditScene, ResolvedVideoEditSceneRecord, ResolvedVideoEditSceneShot } from './sceneResolve'

export type VideoEditSceneReviewKind = 'scene_box_stale' | 'scene_cursor_jump' | 'scene_issue'
export interface VideoEditSceneReviewOptions {
  checks?: readonly VideoEditSceneReviewKind[]
  /** 应用层传 0，按放置后的序列播放秒数复核；纯函数默认按等速时钟检查。 */
  minSeconds?: number
  to: number
  range?: { from: number; to: number }
  work?: () => void
}
export interface VideoEditSceneReviewFact {
  kind: VideoEditSceneReviewKind
  recordId?: string
  from: number
  to: number
  record?: ResolvedVideoEditSceneRecord
  shot?: ResolvedVideoEditSceneShot
  previous?: ResolvedVideoEditSceneShot
  issue?: CodeSceneIssue
  /** 查询上下文截在连续错位中间，不能把这个边界冒充真实换画面时刻。 */
  openStart?: boolean
  /** 这一段连续错位确实抵达记录的生效结束，而非查询上下文的右边界。 */
  tail?: boolean
  /** 右侧检查范围先于生效结束，无法据此判断错位是否只是中段。 */
  openEnd?: boolean
}

const EDGE = 1e-7
export const VIDEO_EDIT_SCENE_CURSOR_SHORT_FADE = 0.2

interface ShotIndex {
  shots: readonly ResolvedVideoEditSceneShot[]
  maxEnd: readonly number[]
  previous: ReadonlyMap<ResolvedVideoEditSceneShot, ResolvedVideoEditSceneShot>
}
function shotIndex(container: ResolvedVideoEditSceneRecord): ShotIndex {
  const previous = new Map<ResolvedVideoEditSceneShot, ResolvedVideoEditSceneShot>()
  const shots = container.timetables.flatMap(table => {
    table.shots.forEach((shot, index) => { if (index) previous.set(shot, table.shots[index - 1]) })
    return [...table.shots]
  }).sort((a, b) => a.at - b.at)
  let end = -Infinity
  return { shots, previous, maxEnd: shots.map(shot => end = Math.max(end, shot.end)) }
}
/** 第一个开始时刻大于 t 的内容项。 */
function after(shots: readonly ResolvedVideoEditSceneShot[], t: number, work?: () => void): number {
  let low = 0, high = shots.length
  while (low < high) { work?.(); const middle = (low + high) >>> 1; if (shots[middle].at <= t) low = middle + 1; else high = middle }
  return low
}
function topAt(index: ShotIndex, t: number, work?: () => void): ResolvedVideoEditSceneShot | undefined {
  for (let i = after(index.shots, t, work) - 1; i >= 0 && index.maxEnd[i] > t; i--) { work?.(); if (index.shots[i].end > t) return index.shots[i] }
  return undefined
}

function sourceRange(scene: ResolvedVideoEditScene, record: ResolvedVideoEditSceneRecord): [number, number] | undefined {
  const times: number[] = []
  for (const [name, field] of Object.entries(scene.schema.kinds[record.kind].fields)) {
    const value = record.values[name]
    if (field.type === 'sourceTime' && typeof value === 'number') times.push(value)
    if (field.type === 'list' && field.of.type === 'sourceTime' && Array.isArray(value)) for (const time of value) if (typeof time === 'number') times.push(time)
  }
  return times.length >= 2 ? [Math.min(...times), Math.max(...times)] : undefined
}

/** 只核对数据对应关系。查询范围由应用层留足阈值上下文，不扫描其余时段。 */
export function reviewVideoEditScene(scene: ResolvedVideoEditScene, options: VideoEditSceneReviewOptions): VideoEditSceneReviewFact[] {
  const enabled = (kind: VideoEditSceneReviewKind): boolean => !options.checks || options.checks.includes(kind)
  const facts: VideoEditSceneReviewFact[] = []
  const query = options.range ?? { from: 0, to: options.to }
  const intersects = (from: number, to: number): boolean => from < query.to && to >= query.from
  const add = (fact: VideoEditSceneReviewFact): void => { options.work?.(); if (intersects(fact.from, fact.to)) facts.push(fact) }
  if (enabled('scene_issue')) for (const issue of scene.issues) {
    options.work?.()
    if (issue.severity !== 'user') continue
    const record = issue.recordId ? scene.byId.get(issue.recordId) : undefined
    add({ kind: 'scene_issue', recordId: issue.recordId, record, from: record?.at ?? 0, to: Math.min(record?.end ?? options.to, options.to), issue })
  }
  if (enabled('scene_cursor_jump')) for (const table of scene.timetables) {
    const end = after(table.shots, query.to)
    for (let i = Math.max(1, after(table.shots, query.from) - 1); i < end; i++) {
      options.work?.()
      const previous = table.shots[i - 1], shot = table.shots[i]
      if (!intersects(shot.at, shot.end) || !previous.cursor || !shot.cursor || shot.image || previous.image || shot.xf >= VIDEO_EDIT_SCENE_CURSOR_SHORT_FADE) continue
      if (shot.media === previous.media && Math.abs(previous.src + (shot.at - previous.at) * previous.rate - shot.src) < EDGE) continue
      add({ kind: 'scene_cursor_jump', recordId: shot.record.id, record: shot.record, from: shot.at, to: Math.min(shot.end, shot.at + VIDEO_EDIT_SCENE_CURSOR_SHORT_FADE), previous, shot })
    }
  }
  if (!enabled('scene_box_stale')) return facts
  const footprints = new Map(videoEditSceneFootprints(scene).timed.map(footprint => [footprint.record, footprint]))
  const indexes = new Map<ResolvedVideoEditSceneRecord, ShotIndex>()
  for (const record of scene.records) {
    options.work?.()
    const kind = scene.schema.kinds[record.kind]
    if (!kind.footage || kind.role === 'shot' || !record.footage || !record.container || record.at === undefined || !kind.influence) continue
    const footprint = footprints.get(record)
    // neighbors 的首尾延伸与相邻影响段直接取统一 footprint；绘制余量不属于数据错位。
    let from = kind.influence === 'neighbors' && footprint ? footprint.from + (kind.margin?.before ?? 0) : record.at
    let to = kind.influence === 'neighbors' && footprint ? footprint.to - (kind.margin?.after ?? 0) : record.end ?? options.to
    for (let parent = record.parent; parent; parent = parent.parent) { from = Math.max(from, parent.at ?? -Infinity); to = Math.min(to, parent.end ?? Infinity) }
    const activeFrom = Math.max(0, from), activeTo = to
    from = Math.max(activeFrom, query.from); to = Math.min(to, options.to, query.to)
    if (to <= from) continue
    let index = indexes.get(record.container)
    if (!index) { index = shotIndex(record.container); indexes.set(record.container, index); for (const _shot of index.shots) options.work?.() }
    const source = sourceRange(scene, record)
    const boundaries = new Set([from, to])
    // 二分跳到查询开头；跨越开头的内容及其叠化前项也参与源时间范围划分。
    const selected = new Set<ResolvedVideoEditSceneShot>()
    const first = after(index.shots, from, options.work)
    for (let i = first - 1; i >= 0 && index.maxEnd[i] > from; i--) selected.add(index.shots[i])
    for (let i = first; i < index.shots.length && index.shots[i].at < to; i++) selected.add(index.shots[i])
    for (const shot of selected) { options.work?.(); const previous = index.previous.get(shot); if (previous && shot.at + shot.xf > from) selected.add(previous) }
    for (const shot of selected) {
      options.work?.()
      for (const t of [shot.at, shot.end, shot.at + shot.xf, ...(source && shot.rate !== 0 ? source.map(src => shot.at + (src - shot.src) / shot.rate) : [])]) if (t > from && t < to) boundaries.add(t)
    }
    const ordered = [...boundaries].sort((a, b) => a - b)
    let pending: VideoEditSceneReviewFact | undefined
    const flush = (): void => {
      if (pending && pending.to - pending.from + EDGE >= (options.minSeconds ?? .2)) add({
        ...pending, tail: Number.isFinite(activeTo) && pending.to >= activeTo - EDGE,
        openEnd: pending.to >= to - EDGE && to < activeTo - EDGE,
      })
      pending = undefined
    }
    const matches = (shot: ResolvedVideoEditSceneShot, t: number): boolean => {
      const src = shot.src + (t - shot.at) * shot.rate
      return shot.media === record.footage && (!source || src >= source[0] - EDGE && src <= source[1] + EDGE)
    }
    for (let i = 1; i < ordered.length; i++) {
      const start = ordered[i - 1], end = ordered[i], t = (start + end) / 2
      const top = topAt(index, t, options.work)
      // 叠化结束前旧画面还在，不能把“新画面开始出现”当成“旧画面已换掉”。
      let visible = top, matched = false
      while (visible) {
        options.work?.()
        if (matches(visible, t)) { matched = true; break }
        if (t >= visible.at + visible.xf) break
        visible = index.previous.get(visible)
      }
      if (matched) { flush(); continue }
      if (pending) pending.to = end
      else pending = { kind: 'scene_box_stale', recordId: record.id, record, from: start, to: end, shot: top, ...(start === query.from && start > activeFrom ? { openStart: true } : {}) }
    }
    flush()
  }
  return facts
}
