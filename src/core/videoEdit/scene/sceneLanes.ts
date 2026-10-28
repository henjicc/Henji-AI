import type { CodeSceneLaneStyle } from './sceneDeclaration'
import { resolveVideoEditScene, videoEditSceneCutTime, videoEditSceneWriteBackTime, type ResolvedVideoEditScene, type ResolvedVideoEditSceneRecord, type ResolvedVideoEditSceneShot, type VideoEditSceneResolveIssue } from './sceneResolve'

export interface VideoEditSceneLaneRange { readonly from: number; readonly to: number }
export interface VideoEditSceneLaneCut {
  readonly enabled: boolean
  /** 未剪区间，供恢复剪切与显示被剪长度使用。 */
  readonly from: number
  readonly to: number
  readonly removedDuration: number
  readonly position: number
}
export interface VideoEditSceneLaneItem {
  readonly record: ResolvedVideoEditSceneRecord
  readonly style: CodeSceneLaneStyle
  readonly label: string
  /** 剪后片段素材时间，不包含引用片段在节目时间线上的偏移。 */
  readonly at: number
  readonly end: number
  readonly clippedStart: boolean
  readonly clippedEnd: boolean
  readonly issues: readonly VideoEditSceneResolveIssue[]
  /** 同一来源跨剪切拆开的内容仍是一个条目，保留取帧段供界面读回。 */
  readonly shots: readonly ResolvedVideoEditSceneShot[]
  readonly cut?: VideoEditSceneLaneCut
  /** 窗口内容：同一张时间表里紧接着的下一项（它的开始就是这一项“停多久”的结束）；最后一项没有。 */
  readonly next?: { readonly record: ResolvedVideoEditSceneRecord; readonly at: number }
}
export interface VideoEditSceneLaneRow {
  /** row 的窗口或 key 的父记录；贪心打包的行没有归属记录。 */
  readonly record: ResolvedVideoEditSceneRecord | undefined
  readonly label: string
  readonly at: number
  readonly end: number
  readonly items: readonly VideoEditSceneLaneItem[]
}
export interface VideoEditSceneLaneGroup {
  readonly kind: string
  readonly label: string
  readonly style: CodeSceneLaneStyle
  readonly rows: readonly VideoEditSceneLaneRow[]
}
export interface VideoEditSceneLanes {
  readonly groups: readonly VideoEditSceneLaneGroup[]
  readonly edges: readonly number[]
}

interface LaneCache { readonly range: VideoEditSceneLaneRange; readonly lanes: VideoEditSceneLanes }
const derived = new WeakMap<ResolvedVideoEditScene, readonly LaneCache[]>()
const rowEnds = new WeakMap<VideoEditSceneLaneRow, readonly number[]>()
const fullRange: VideoEditSceneLaneRange = { from: 0, to: Infinity }
const chronological = (a: VideoEditSceneLaneItem, b: VideoEditSceneLaneItem): number => a.at - b.at || a.end - b.end
const clamp = (t: number, range: VideoEditSceneLaneRange): number => Math.max(range.from, Math.min(range.to, t))

function recordLabel(resolved: ResolvedVideoEditScene, record: ResolvedVideoEditSceneRecord): string {
  const kind = resolved.schema.kinds[record.kind]
  const value = kind.lane?.label ? record.values[kind.lane.label] : undefined
  return typeof value === 'string' ? value : kind.title ?? record.kind
}

function makeRow(resolved: ResolvedVideoEditScene, items: VideoEditSceneLaneItem[], record: ResolvedVideoEditSceneRecord | undefined, range: VideoEditSceneLaneRange): VideoEditSceneLaneRow {
  items.sort(chronological)
  const ends: number[] = []
  for (const item of items) ends.push(Math.max(ends[ends.length - 1] ?? -Infinity, item.end))
  const at = clamp(record?.at ?? items[0].at, range)
  const end = Math.max(at, clamp(record?.end ?? ends[ends.length - 1], range))
  const row: VideoEditSceneLaneRow = { record, label: record ? recordLabel(resolved, record) : '', at, end, items }
  rowEnds.set(row, ends)
  return row
}

/** 同一解析对象、同一可见源区间返回同一结果；片段入出点已经是剪后素材时间。 */
export function videoEditSceneLanes(resolved: ResolvedVideoEditScene, range: VideoEditSceneLaneRange = fullRange): VideoEditSceneLanes {
  if (!Number.isFinite(range.from) || Number.isNaN(range.to) || range.to < range.from) throw new RangeError('片段可见源时间范围无效。')
  const cache = derived.get(resolved) ?? []
  const hit = cache.find(entry => entry.range.from === range.from && entry.range.to === range.to)
  if (hit) return hit.lanes

  const issues = new Map<string, VideoEditSceneResolveIssue[]>()
  for (const issue of resolved.issues) if (issue.recordId !== undefined) {
    const list = issues.get(issue.recordId) ?? []
    list.push(issue); issues.set(issue.recordId, list)
  }
  const shots = new Map<ResolvedVideoEditSceneRecord, ResolvedVideoEditSceneShot[]>()
  const nextShot = new Map<ResolvedVideoEditSceneRecord, { record: ResolvedVideoEditSceneRecord; at: number }>()
  for (const table of resolved.timetables) table.shots.forEach((shot, index) => {
    const list = shots.get(shot.record) ?? []
    list.push(shot); shots.set(shot.record, list)
    // 跨剪切拆开的几段属于同一条记录：取最后一段之后第一项别的记录
    const following = table.shots[index + 1]
    if (following && following.record !== shot.record) nextShot.set(shot.record, { record: following.record, at: following.at })
  })
  const items = new Map<ResolvedVideoEditSceneRecord, VideoEditSceneLaneItem>()
  for (const record of resolved.records) {
    const kind = resolved.schema.kinds[record.kind]
    if (!kind.lane || record.at === undefined) continue
    let at = record.at, end = record.end ?? at
    let cut: VideoEditSceneLaneCut | undefined
    if (kind.role === 'cut') {
      const from = record.source.values[kind.at!]
      const to = kind.end ? record.source.values[kind.end] : typeof from === 'number' ? from + Number(record.values[kind.duration!]) : undefined
      if (typeof from === 'number' && typeof to === 'number') {
        const enabled = record.values.enabled !== false && to > from
        // 重叠剪切由解析器合并为一刀，各记录必须落在同一个实际剪切口。
        const effective = enabled ? resolved.cuts.find(value => from >= value.from && from < value.to) : undefined
        const position = effective ? videoEditSceneCutTime(resolved.cuts, effective.from) : at
        cut = { enabled, from, to, removedDuration: enabled ? to - from : 0, position }
        if (enabled) at = end = position
      }
    }
    items.set(record, {
      record, style: kind.lane.style, label: recordLabel(resolved, record),
      at: clamp(at, range), end: clamp(Math.max(at, end), range),
      clippedStart: at < range.from, clippedEnd: end > range.to,
      issues: issues.get(record.id) ?? [], shots: shots.get(record) ?? [], ...(cut ? { cut } : {}), ...(nextShot.has(record) ? { next: nextShot.get(record)! } : {}),
    })
  }

  const embedded = new Map<ResolvedVideoEditSceneRecord, VideoEditSceneLaneItem[]>()
  const nested = new Set<ResolvedVideoEditSceneRecord>()
  for (const [record, item] of items) {
    if (resolved.schema.kinds[record.kind].role !== 'shot' || !record.parent || items.get(record.parent)?.style !== 'row') continue
    const list = embedded.get(record.parent) ?? []
    list.push(item); embedded.set(record.parent, list); nested.add(record)
  }
  const groups: VideoEditSceneLaneGroup[] = []
  for (const [name, kind] of Object.entries(resolved.schema.kinds)) {
    if (!kind.lane) continue
    const list = (resolved.byKind[name] ?? []).flatMap(record => {
      const item = items.get(record)
      return item && !nested.has(record) ? [item] : []
    }).sort(chronological)
    if (!list.length) continue
    const rows: VideoEditSceneLaneRow[] = []
    if (kind.lane.style === 'row') {
      for (const item of list) rows.push(makeRow(resolved, [item, ...(embedded.get(item.record) ?? [])], item.record, range))
    } else if (kind.lane.style === 'key') {
      const byParent = new Map<ResolvedVideoEditSceneRecord | undefined, VideoEditSceneLaneItem[]>()
      for (const item of list) {
        const siblings = byParent.get(item.record.parent) ?? []
        siblings.push(item); byParent.set(item.record.parent, siblings)
      }
      for (const [parent, siblings] of byParent) rows.push(makeRow(resolved, siblings, parent, range))
    } else {
      const packed: VideoEditSceneLaneItem[][] = [], ends: number[] = []
      for (const item of list) {
        let index = ends.findIndex(end => end <= item.at)
        if (index < 0) { index = packed.length; packed.push([]) }
        packed[index].push(item); ends[index] = item.end
      }
      for (const row of packed) rows.push(makeRow(resolved, row, undefined, range))
    }
    groups.push({ kind: name, label: kind.title ?? name, style: kind.lane.style, rows })
  }
  const edges = [...new Set([...items.values()].flatMap(item => [item.at, item.end]).filter(Number.isFinite))].sort((a, b) => a - b)
  const lanes: VideoEditSceneLanes = { groups, edges }
  // 同一份数据可供数个不同入出点的片段使用，限制派生缓存以免拖动入出点时无限积累。
  derived.set(resolved, [{ range: { ...range }, lanes }, ...cache].slice(0, 4))
  return lanes
}

export function videoEditSceneLaneEdges(resolved: ResolvedVideoEditScene, range?: VideoEditSceneLaneRange): readonly number[] {
  return videoEditSceneLanes(resolved, range).edges
}

/** 闭区间查询，零宽的关键帧和剪切口在窗口边缘也能命中。 */
export function videoEditSceneLaneVisibleItems(row: VideoEditSceneLaneRow, from: number, to: number): readonly VideoEditSceneLaneItem[] {
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return []
  const ends = rowEnds.get(row)
  if (!ends) return row.items.filter(item => item.at <= to && item.end >= from)
  // 父行条与子块可以重叠，不能直接对条目的 end 二分；前缀最大值才单调。
  let low = 0, high = row.items.length
  while (low < high) { const mid = (low + high) >>> 1; if (ends[mid] < from) low = mid + 1; else high = mid }
  const start = low
  high = row.items.length
  while (low < high) { const mid = (low + high) >>> 1; if (row.items[mid].at <= to) low = mid + 1; else high = mid }
  return row.items.slice(start, low).filter(item => item.end >= from)
}

export type VideoEditSceneAnchorResult =
  | { readonly ok: true; readonly anchor: { readonly src: number } }
  | { readonly ok: false; readonly reason: 'invalid-time' | 'not-anchorable' | 'cut' | 'unrepresentable'; readonly message: string }

/**
 * 按剪后实际画面反解。停帧中途、重复播放后的第二次落点等不能用“第一次放到 src”表达的位置明确拒绝，
 * 防止拖动保存后跳到别处。最终用正式解析器校验，窗口选择、段落范围与锚定容差不维护第二份规则。
 * side 为 end 时反解结束字段（end 声明的 time 字段），校验解析后的结束。
 */
export function videoEditSceneAnchorAt(resolved: ResolvedVideoEditScene, record: ResolvedVideoEditSceneRecord, t: number, side: 'start' | 'end' = 'start'): VideoEditSceneAnchorResult {
  if (!Number.isFinite(t) || t < 0) return { ok: false, reason: 'invalid-time', message: '目标时刻必须是非负的有限秒数。' }
  const kind = resolved.schema.kinds[record.kind]
  const key = side === 'start' ? kind?.at : kind?.end
  const field = key ? kind.fields[key] : undefined
  if (resolved.byId.get(record.id) !== record || field?.type !== 'time' || field.anchor !== 'footage' || record.footage === undefined) {
    return { ok: false, reason: 'not-anchorable', message: `这条记录的${side === 'start' ? '开始' : '结束'}时刻不能按录屏秒锚定。` }
  }
  const media = new Map<string, 'video' | 'image'>()
  let duration: number | undefined
  const candidates = new Set<number>()
  for (const table of resolved.timetables) {
    if (table.container?.end === undefined) duration = table.end
    for (const [index, shot] of table.shots.entries()) {
      media.set(shot.media, shot.image ? 'image' : 'video')
      // 接缝属于下一项，尤其剪切口必须取接续后的源秒；片尾仍允许作为结束锚点。
      // 结束锚点落在接缝上时属于前一项（放到这一刻为止），两侧都列为候选，由解析校验取舍。
      const contains = t >= shot.at && (t < shot.end || (side === 'end' || index === table.shots.length - 1) && t === shot.end)
      if (!shot.image && shot.media === record.footage && contains) candidates.add(shot.src + (t - shot.at) * shot.rate)
    }
  }
  for (const src of candidates) {
    if (!Number.isFinite(src) || src < 0) continue
    const source = { ...record.source, values: { ...record.source.values, [key!]: { src } } }
    const probe = resolveVideoEditScene({ ...resolved.scene, records: resolved.scene.records.map(value => value === record.source ? source : value) }, resolved.schema, { media, duration })
    const landed = probe.byId.get(record.id)
    const at = side === 'start' ? landed?.at : landed?.end
    if (at !== undefined && Math.abs(at - t) <= 1e-6) return { ok: true, anchor: { src } }
  }
  const original = record.source.values[key!]
  const raw = videoEditSceneWriteBackTime(resolved.cuts, t, { original: typeof original === 'number' ? original : undefined })
  if (resolved.cuts.some(cut => raw >= cut.from && raw < cut.to)) {
    return { ok: false, reason: 'cut', message: '这个落点没有可锚定的保留画面，不能写回被剪掉的录屏位置。' }
  }
  return { ok: false, reason: 'unrepresentable', message: '这个落点无法按录屏秒唯一锚定，请选择保留内容第一次播放到的时刻。' }
}
