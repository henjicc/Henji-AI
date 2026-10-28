import type { CodeImageReference } from '../../imaging/parameterTypes'
import { CODE_VIDEO_SPAN_LIMIT } from '../codeMaterial/videoSpans'
import type { CodeSceneIssue, CodeSceneKindDeclaration, CodeSceneMediaKind, CodeSceneSchema, CodeSceneValue } from './sceneDeclaration'
import { videoEditSceneTimetableInputs } from './sceneInputs'
import type { VideoEditScene, VideoEditSceneRecord } from './sceneSchema'

/**
 * 片子数据的解析：把文档里的记录（引用它的代码片段的素材时间，未剪切）换算成作者代码直接使用的全片描述——
 * 剪后时间、按录屏秒锚定出的时刻、窗口内容时间表（车道、默认叠化、每项放到哪一刻）与取帧参数。
 * 时间换算只有这一份实现：渲染、时间线、检查器、助手读回与预渲染分段都从这里取，作者代码不再自己编排。
 * 特殊处理只看声明里的 role（cut 剪切、segment 段落、shot 窗口内容），没写 role 的记录类型只做通用的时刻换算。
 *
 * 规则沿用代码片子一直以来的编排（剪切、锚定、内容时间表），迁移以后画面不变：
 * - 剪切：只有启用的剪切生效。剪切结尾前 lead 秒（0.5 秒，不超过剪切长度的一半）及以后的时刻整体前移剪切长度
 *   （下一段的镜头提前起动算后面的）；剪切里更早的时刻不动，所以跨进剪切的退场照常做完。
 * - 丢弃：整段落在剪切里的记录丢掉（开头容差 0.1 秒、结尾 0.2 秒，同样不超过剪切长度的一半）；时间点记录落在
 *   [from − lead, to − lead) 里丢掉（落在剪切里或刚好在它前面起步去那里的）；父记录丢掉，子记录一起丢掉。
 *   段落被剪掉时只有挂在它下面的记录跟着丢，所以组件、窗口要挂在段落下才会随段落丢弃；时刻落在被剪掉的段落里、
 *   却没挂在它下面又留了下来的记录会在 issues 里报出来。
 * - 窗口内容按波纹删除换算：剪切里的画面不再出现，横跨剪切的一项在剪切后从对应的源时间接着放（停住的不拆）。
 * - 声明里所有 time 字段（含 time 列表）都按同一规则换算，不再手写一份时刻字段清单。
 */

/** 窗口里换一段素材时默认叠化的时长（秒）；同一段素材跳到别处时不叠化，写了 xf 的按 xf。 */
export const VIDEO_EDIT_SCENE_CROSSFADE_SECONDS = 0.45
/**
 * 剪切结尾前这么久起步的记录算剪切后面的。这是给整段剪掉准备的：下一段的镜头往往比段落早一点起动。
 * 很短的剪切（剪掉一口气、一个停顿）里没有段落，取不超过剪切长度的一半，剪切口本身不跟着移动。
 */
export const VIDEO_EDIT_SCENE_CUT_LEAD_SECONDS = 0.5
const CUT_SPAN_BEFORE = 0.1, CUT_SPAN_AFTER = 0.2
/** 锚定的容差：停住的一项源时间相差这么多以内算同一秒；播放区间两端留浮点余量。 */
const HOLD_MATCH = 0.06, EDGE = 1e-6

/** 生效的一刀（未剪时间 [from, to)，已按开头排序、重叠的合并）。 */
export interface VideoEditSceneCut { readonly from: number; readonly to: number; readonly lead: number }

/** 未剪时刻 → 剪后时刻。 */
export function videoEditSceneCutTime(cuts: readonly VideoEditSceneCut[], t: number): number {
  let shift = 0
  for (const cut of cuts) { if (t < cut.to - cut.lead) break; shift += cut.to - cut.from }
  return t - shift
}
/** 未剪时刻在第几刀之后（以剪切结尾前 lead 为界）。 */
function cutSide(cuts: readonly VideoEditSceneCut[], t: number): number {
  let side = 0
  while (side < cuts.length && t >= cuts[side].to - cuts[side].lead) side++
  return side
}
/**
 * 剪后时刻 t 的全部未剪来源，按在第几刀之后（side）从早到晚排。剪切口一带的剪后时刻有两个来源：
 * 剪切前不前移的那一段（剪切结尾前 lead 以前），和剪切后前移过来的。
 */
function uncutSources(cuts: readonly VideoEditSceneCut[], t: number): Array<{ side: number; time: number }> {
  const sources: Array<{ side: number; time: number }> = []
  let shift = 0
  for (let side = 0; side <= cuts.length; side++) {
    const time = t + shift
    if ((side === 0 || time >= cuts[side - 1].to - cuts[side - 1].lead) && (side === cuts.length || time < cuts[side].to - cuts[side].lead)) sources.push({ side, time })
    if (side < cuts.length) shift += cuts[side].to - cuts[side].from
  }
  return sources
}
/** 优先原值所在那一侧（等于按剪后位移平移原值），没有原值或跨过了剪切时取最早的来源（剪切前那一侧）。 */
function preferredSource(sources: Array<{ side: number; time: number }>, original: number | undefined, cuts: readonly VideoEditSceneCut[]): number {
  const side = original === undefined ? undefined : cutSide(cuts, original)
  const index = sources.findIndex(source => source.side === side)
  return index >= 0 ? index : 0
}
/**
 * 拖动写回一个时刻：剪后时刻 t 换回要写进文档的未剪时刻，结果总满足 videoEditSceneCutTime(cuts, 结果) === t。
 * 有两个来源时按原值 original 所在的一侧换回（没有原值取剪切前那一侧），所以段落结尾、退场这类本来就在剪切口一带的值
 * 可以原地微调。point 为真表示这是时间点记录的位置（记录类型只有 at、没有 end / duration）：落到会被丢掉的
 * [from − lead, to − lead) 时改取剪切后面的来源，免得拖过去就消失。有起止的记录用 videoEditSceneWriteBackSpan 整条写回。
 */
export function videoEditSceneWriteBackTime(cuts: readonly VideoEditSceneCut[], t: number, options: { original?: number; point?: boolean } = {}): number {
  const sources = uncutSources(cuts, t)
  if (!sources.length) return t
  let index = preferredSource(sources, options.original, cuts)
  if (options.point) while (index + 1 < sources.length && inCutPoint(cuts, sources[index].time)) index++
  return sources[index].time
}
/**
 * 拖动写回一条有起止的记录（剪后 start ≤ end）：结束按 videoEditSceneWriteBackTime 的规则取来源，整条会被当成
 * 落在剪切里丢掉时改取剪切后面的来源；起点取不晚于结束那一侧的最晚来源，所以写回后 start ≤ end，
 * 停用剪切以后起止也不会倒过来。
 */
export function videoEditSceneWriteBackSpan(cuts: readonly VideoEditSceneCut[], start: number, end: number, original?: { start: number; end: number }): { start: number; end: number } {
  const ends = uncutSources(cuts, end), starts = uncutSources(cuts, start)
  if (!ends.length || !starts.length) return { start, end }
  const pick = (endIndex: number): { start: number; end: number } => {
    const side = ends[endIndex].side
    const startSource = [...starts].reverse().find(source => source.side <= side) ?? starts[0]
    return { start: startSource.time, end: ends[endIndex].time }
  }
  let index = preferredSource(ends, original?.end, cuts), span = pick(index)
  while (index + 1 < ends.length && inCutSpan(cuts, span.start, span.end)) span = pick(++index)
  return span
}
function inCutPoint(cuts: readonly VideoEditSceneCut[], t: number): boolean { return cuts.some(cut => t >= cut.from - cut.lead && t < cut.to - cut.lead) }
function inCutSpan(cuts: readonly VideoEditSceneCut[], start: number, end: number): boolean {
  return cuts.some(cut => { const half = (cut.to - cut.from) / 2; return start >= cut.from - Math.min(CUT_SPAN_BEFORE, half) && end <= cut.to + Math.min(CUT_SPAN_AFTER, half) })
}

/** 解析好的一条记录。所有时刻都是剪后片子时间（秒）。 */
export interface ResolvedVideoEditSceneRecord {
  readonly id: string
  readonly kind: string
  /** 文档里的原记录（手调字段等从这里读；对象身份随文档保持）。 */
  readonly source: VideoEditSceneRecord
  readonly parent: ResolvedVideoEditSceneRecord | undefined
  /** 子记录，按 at 排序（没有位置的在前，保持文档顺序）。 */
  readonly children: readonly ResolvedVideoEditSceneRecord[]
  /** 声明的全部字段：省略的填上声明默认值，time 字段换成剪后秒数（{src} 已按录屏秒求出）；ref 字段仍是记录 ID，用 byId 取。 */
  readonly values: Readonly<Record<string, CodeSceneValue>>
  /**
   * 在时间轴上的位置与结束；没有位置的记录都是 undefined，时间点记录没有 end，放到最后不封口的是 Infinity。
   * 窗口内容记录取时间表里它那几项的起止（开头落在剪切里时从剪切口算起，可能晚于 values 里换算的 at）。
   */
  readonly at: number | undefined
  readonly end: number | undefined
  /** 所属素材（footage 沿 ref 一路找到的素材 ID）。 */
  readonly footage: string | undefined
  /** 挂在这条记录下的窗口内容时间表（它是窗口时），每类 role 为 shot 的记录一张。 */
  readonly timetables: readonly ResolvedVideoEditSceneTimetable[]
}
/** 窗口内容时间表里的一项：从 at 到 end 放素材 media 的 src 秒起、rate 倍速；横跨剪切的一条记录会拆成几项。 */
export interface ResolvedVideoEditSceneShot {
  readonly record: ResolvedVideoEditSceneRecord
  readonly media: string
  /** 截图：不取帧，固定画面。 */
  readonly image: boolean
  readonly at: number
  readonly end: number
  readonly src: number
  readonly rate: number
  /** 叠化进来的时长：叠化期间上一项照常画在下面。 */
  readonly xf: number
  /** 取帧车道：同一段素材叠化到自己的另一处时两边同时取帧，分在两条车道。 */
  readonly lane: number
  readonly cursor: boolean
  /** 作者代码 inputs.images 里这一项画面的键（取帧参数按同一个键派生）。 */
  readonly input: string
}
export interface ResolvedVideoEditSceneTimetable {
  /** 容纳它的窗口记录；窗口内容没有父记录时 undefined。 */
  readonly container: ResolvedVideoEditSceneRecord | undefined
  /** 窗口内容的记录类型。 */
  readonly kind: string
  /** 按 at 排序。 */
  readonly shots: readonly ResolvedVideoEditSceneShot[]
  /** 最后一项放到哪一刻：窗口的结束，没有时为解析选项 duration，再没有就是 Infinity。 */
  readonly end: number
  /** 这张时间表的取帧参数，键是各项的 input（见 sceneInputs.ts）。 */
  readonly inputs: Readonly<Record<string, CodeImageReference>>
}
export interface ResolvedVideoEditScene {
  readonly scene: VideoEditScene
  readonly schema: CodeSceneSchema
  /** 解析后留下的记录，文档顺序。 */
  readonly records: readonly ResolvedVideoEditSceneRecord[]
  readonly byId: ReadonlyMap<string, ResolvedVideoEditSceneRecord>
  /** 每类声明的记录（含空类型），按 at 排序。 */
  readonly byKind: Readonly<Record<string, readonly ResolvedVideoEditSceneRecord[]>>
  /** 没有父记录的记录，按 at 排序。 */
  readonly roots: readonly ResolvedVideoEditSceneRecord[]
  readonly timetables: readonly ResolvedVideoEditSceneTimetable[]
  /** 生效的剪切，给 videoEditSceneCutTime / videoEditSceneWriteBackTime 用。 */
  readonly cuts: readonly VideoEditSceneCut[]
  /** 解析时丢掉、没法换算或需要整理的记录及原因（片子数据写入时按声明校验过，这里兜住声明与数据不一致和结构上的隐患）。 */
  readonly issues: readonly VideoEditSceneResolveIssue[]
}
/**
 * 解析时发现的问题。severity 为 'user' 的会让画面缺内容、用户又很难自己察觉（例如取帧车道超限后窗口后半段变空白），
 * G3 渲染接入与 G4 领域服务接入时必须呈现给用户（时间线标记或提示）；没有 severity 的写日志、供助手读回即可。
 */
export interface VideoEditSceneResolveIssue extends CodeSceneIssue { readonly severity?: 'user' }
export interface ResolveVideoEditSceneOptions {
  /** 剪辑里的素材 ID → 种类：窗口内容引用图片素材时按截图处理。按对象身份参与缓存，调用方按文档的素材列表复用同一个 Map。 */
  readonly media?: ReadonlyMap<string, CodeSceneMediaKind>
  /** 没有窗口结束时刻的内容时间表放到哪一刻（剪后时间，通常是片段素材时长）。 */
  readonly duration?: number
}

interface CacheEntry { readonly schema: CodeSceneSchema; readonly media?: ReadonlyMap<string, CodeSceneMediaKind>; readonly duration?: number; readonly resolved: ResolvedVideoEditScene }
const resolvedScenes = new WeakMap<VideoEditScene, readonly CacheEntry[]>()
/** 同一份片子数据可能被几个片段按不同选项引用，每份留几个结果。 */
const CACHE_PER_SCENE = 4

/**
 * 解析片子数据。同一 scene、schema 与选项再次调用直接返回同一个结果对象；结果里的记录、时间表对象身份稳定，
 * 作者代码可以按对象身份（WeakMap）缓存派生数据，不需要每帧重算或深拷贝。
 * 缓存只认对象身份：调用方（渲染 Worker）要把文档里的片子数据对象、parseCodeSceneSchema 得到的 schema
 * 与 media 表原样传进来，跨帧、跨编辑保持不变；每次重新构造（反序列化、展开复制）就会每次全量重算。
 */
export function resolveVideoEditScene(scene: VideoEditScene, schema: CodeSceneSchema, options: ResolveVideoEditSceneOptions = {}): ResolvedVideoEditScene {
  const entries = resolvedScenes.get(scene) ?? []
  const hit = entries.find(entry => entry.schema === schema && entry.media === options.media && entry.duration === options.duration)
  if (hit) return hit.resolved
  const resolved = resolveScene(scene, schema, options)
  resolvedScenes.set(scene, [{ schema, media: options.media, duration: options.duration, resolved }, ...entries].slice(0, CACHE_PER_SCENE))
  return resolved
}

type Values = Record<string, CodeSceneValue>
interface MutableRecord extends Omit<ResolvedVideoEditSceneRecord, 'children' | 'end' | 'timetables'> { children: MutableRecord[]; end: number | undefined; timetables: ResolvedVideoEditSceneTimetable[] }
interface MutableShot extends Omit<ResolvedVideoEditSceneShot, 'record'> { record: ResolvedVideoEditSceneRecord | undefined }
interface ShotDraft { readonly source: VideoEditSceneRecord; readonly media: string; readonly image: boolean; readonly at: number; readonly src: number; readonly rate: number; readonly xf: number | undefined; readonly cursor: boolean; readonly continued: boolean }
interface ShotTable { readonly containerId: string | undefined; readonly kind: string; readonly shots: MutableShot[]; readonly end: number }

const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const isAnchor = (value: unknown): value is { src: number } => typeof value === 'object' && value !== null && !Array.isArray(value) && finite((value as { src?: unknown }).src) !== undefined
const byTime = (a: { at: number | undefined }, b: { at: number | undefined }): number => { const ta = a.at ?? -Infinity, tb = b.at ?? -Infinity; return ta < tb ? -1 : ta > tb ? 1 : 0 }
const groupKey = (parent: string | undefined, kind: string): string => JSON.stringify([parent ?? null, kind])
function fieldValue(record: VideoEditSceneRecord, kind: CodeSceneKindDeclaration, name: string): CodeSceneValue | undefined {
  return Object.hasOwn(record.values, name) ? record.values[name] as CodeSceneValue : kind.fields[name]?.default
}
/** 父记录在前的顺序（父链用显式循环走，很深的嵌套也不爆栈）。 */
function parentFirst(records: readonly VideoEditSceneRecord[], byId: ReadonlyMap<string, VideoEditSceneRecord>): VideoEditSceneRecord[] {
  const placed = new Set<string>(), order: VideoEditSceneRecord[] = []
  for (const record of records) {
    const path: VideoEditSceneRecord[] = [], seen = new Set<string>()
    for (let current: VideoEditSceneRecord | undefined = record; current && !placed.has(current.id) && !seen.has(current.id); current = current.parent === undefined ? undefined : byId.get(current.parent)) { seen.add(current.id); path.push(current) }
    for (let index = path.length - 1; index >= 0; index--) { placed.add(path[index].id); order.push(path[index]) }
  }
  return order
}
/** 一条记录未剪的起止（只认数值；锚定的不算）。 */
function rawExtent(record: VideoEditSceneRecord, kind: CodeSceneKindDeclaration): { at?: number; end?: number } {
  const at = kind.at ? finite(record.values[kind.at]) : undefined
  if (at === undefined) return {}
  if (kind.end) return { at, end: finite(record.values[kind.end]) }
  if (kind.duration) { const duration = finite(record.values[kind.duration]); return { at, end: duration === undefined ? undefined : at + duration } }
  return { at }
}
function sceneCuts(records: readonly VideoEditSceneRecord[], kinds: CodeSceneSchema['kinds']): VideoEditSceneCut[] {
  const ranges: Array<{ from: number; to: number }> = []
  for (const record of records) {
    const kind = Object.hasOwn(kinds, record.kind) ? kinds[record.kind] : undefined
    if (kind?.role !== 'cut' || Object.hasOwn(kind.fields, 'enabled') && fieldValue(record, kind, 'enabled') === false) continue
    const { at, end } = rawExtent(record, kind)
    if (at !== undefined && end !== undefined && end > at) ranges.push({ from: at, to: end })
  }
  ranges.sort((a, b) => a.from - b.from)
  const merged: Array<{ from: number; to: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else merged.push({ ...range })
  }
  return merged.map(range => ({ from: range.from, to: range.to, lead: Math.min(VIDEO_EDIT_SCENE_CUT_LEAD_SECONDS, (range.to - range.from) / 2) }))
}
function timeValues(record: VideoEditSceneRecord, kind: CodeSceneKindDeclaration): CodeSceneValue[] {
  return Object.entries(kind.fields).flatMap(([name, field]) => {
    const value = fieldValue(record, kind, name)
    if (value === undefined) return []
    return field.type === 'time' ? [value] : field.type === 'list' && field.of.type === 'time' && Array.isArray(value) ? value : []
  })
}
/** 第一个 at ≥ t 的下标。 */
function lowerBound(shots: readonly MutableShot[], t: number): number {
  let low = 0, high = shots.length
  while (low < high) { const middle = (low + high) >>> 1; if (shots[middle].at < t) low = middle + 1; else high = middle }
  return low
}

function resolveScene(scene: VideoEditScene, schema: CodeSceneSchema, options: ResolveVideoEditSceneOptions): ResolvedVideoEditScene {
  const issues: VideoEditSceneResolveIssue[] = []
  if (scene.schema.id !== schema.id || scene.schema.version !== schema.version) issues.push({ path: 'schema', message: `片子数据按 ${scene.schema.id}@${scene.schema.version} 写成，代码声明的是 ${schema.id}@${schema.version}。` })
  const kinds = schema.kinds
  const kindOf = (record: VideoEditSceneRecord): CodeSceneKindDeclaration | undefined => Object.hasOwn(kinds, record.kind) ? kinds[record.kind] : undefined
  const raw = new Map(scene.records.map(record => [record.id, record]))
  const order = parentFirst(scene.records, raw)
  const cuts = sceneCuts(scene.records, kinds)
  const cutTime = (t: number): number => videoEditSceneCutTime(cuts, t)
  const dropped = new Set<string>()
  const drop = (record: VideoEditSceneRecord, path?: string, message?: string): void => { dropped.add(record.id); if (path && message) issues.push({ recordId: record.id, path, message }) }

  // 窗口内容按父记录与类型分组（只有 role 为 shot 的类型）；其他 untilNext 记录同样分组，未剪的结束是组里下一条的开始。
  const shotGroups = new Map<string, { containerId: string | undefined; kind: string; records: VideoEditSceneRecord[] }>()
  const containers = new Set<string>()
  const nextRawAt = new Map<VideoEditSceneRecord, number>()
  {
    const groups = new Map<string, VideoEditSceneRecord[]>()
    for (const record of scene.records) {
      const kind = kindOf(record)
      if (kind?.role === 'shot') {
        const key = groupKey(record.parent, record.kind), group = shotGroups.get(key) ?? { containerId: record.parent, kind: record.kind, records: [] }
        group.records.push(record); shotGroups.set(key, group)
        if (record.parent !== undefined) containers.add(record.parent)
      } else if (kind?.influence === 'untilNext' && finite(record.values[kind.at!]) !== undefined) {
        const key = groupKey(record.parent, record.kind), list = groups.get(key) ?? []
        list.push(record); groups.set(key, list)
      }
    }
    for (const list of groups.values()) {
      const at = (record: VideoEditSceneRecord): number => finite(record.values[kindOf(record)!.at!])!
      list.sort((a, b) => at(a) - at(b))
      list.forEach((record, index) => { if (index + 1 < list.length) nextRawAt.set(record, at(list[index + 1])) })
    }
  }

  // 第一步：按未剪时间丢掉整段落在剪切里的记录，父记录丢掉的子记录一起丢。
  const droppedSegments: Array<{ record: VideoEditSceneRecord; at: number; end: number }> = []
  for (const record of order) {
    const kind = kindOf(record)
    if (!kind) { drop(record, 'kind', `代码没有声明 ${record.kind} 类记录。`); continue }
    if (record.parent !== undefined && dropped.has(record.parent)) { drop(record); continue }
    if (kind.role === 'cut') continue
    // 窗口内容与窗口本身的起止决定内容时间表，其他记录的锚定又依赖内容时间表，所以它们只能写成片段时刻。
    if (kind.role === 'shot' ? timeValues(record, kind).some(value => finite(value) === undefined) : containers.has(record.id) && [kind.at, kind.end].some(name => name && finite(record.values[name]) === undefined)) {
      drop(record, kind.at ? `values.${kind.at}` : 'values', '窗口内容与窗口的时刻只能写成片段时刻秒数，不能按录屏秒锚定。'); continue
    }
    if (kind.role === 'shot') continue
    const { at, end } = rawExtent(record, kind)
    if (at === undefined) continue
    let gone: boolean
    if (kind.end || kind.duration) gone = end !== undefined && inCutSpan(cuts, at, end)
    else if (kind.influence === 'untilNext') {
      const parent = record.parent === undefined ? undefined : raw.get(record.parent)
      gone = inCutSpan(cuts, at, nextRawAt.get(record) ?? (parent ? rawExtent(parent, kindOf(parent)!).end : undefined) ?? Infinity)
    } else gone = inCutPoint(cuts, at)
    if (!gone) continue
    drop(record)
    if (kind.role === 'segment' && end !== undefined) droppedSegments.push({ record, at, end })
  }
  // 段落被剪掉只带走挂在它下面的记录：时刻落在里面（且没被前移到剪切后）却没挂在它下面的留了下来，报给整理数据的人。
  if (droppedSegments.length) for (const record of scene.records) {
    const kind = kindOf(record)
    if (dropped.has(record.id) || !kind || kind.role === 'cut' || kind.role === 'shot') continue
    const at = kind.at ? finite(record.values[kind.at]) : undefined
    const segment = at !== undefined && inCutPoint(cuts, at) ? droppedSegments.find(item => at >= item.at && at < item.end) : undefined
    if (segment) issues.push({ recordId: record.id, path: 'parent', message: `时刻落在已剪掉的段落 ${segment.record.id} 里，但没有挂在这个段落下，所以留了下来；组件、窗口要挂在段落下才会随段落丢弃。` })
  }

  // 第二步：窗口内容时间表（剪后时间；规则同代码片子的 shotsOf：默认叠化、取帧车道、每项放到下一项开始）。
  const tables: ShotTable[] = []
  const shotsByRecord = new Map<VideoEditSceneRecord, MutableShot[]>()
  for (const { containerId, kind: kindName, records } of shotGroups.values()) {
    const container = containerId === undefined ? undefined : raw.get(containerId)
    if (container && (dropped.has(container.id) || !kindOf(container))) continue
    const containerKind = container ? kindOf(container)! : undefined
    const containerRaw = container ? rawExtent(container, containerKind!) : {}
    const containerEnd = containerRaw.end === undefined ? undefined : containerKind!.end ? cutTime(containerRaw.end) : cutTime(containerRaw.at!) + (containerRaw.end - containerRaw.at!)
    const end = containerEnd ?? options.duration ?? Infinity
    const kind = kinds[kindName], srcField = Object.keys(kind.fields).find(name => kind.fields[name].type === 'sourceTime')!
    const items = records.filter(record => !dropped.has(record.id)).map(record => ({ record, at: finite(record.values[kind.at!])! })).sort((a, b) => a.at - b.at)
    const drafts: ShotDraft[] = []
    items.forEach(({ record, at }, index) => {
      const media = footageOf(record, raw, kinds)
      if (media === undefined) { drop(record, `values.${kind.footage}`, '找不到这项窗口内容的素材。'); return }
      const image = options.media?.get(media) === 'image'
      const rate = image ? 0 : Math.max(0, finite(fieldValue(record, kind, 'rate')) ?? 1)
      const src = image ? 0 : finite(fieldValue(record, kind, srcField)) ?? 0
      const xf = finite(fieldValue(record, kind, 'xf'))
      const cursor = fieldValue(record, kind, 'cursor') !== false
      const until = index + 1 < items.length ? items[index + 1].at : containerRaw.end ?? Infinity
      // 开头落在剪切里（不算结尾前 lead 那一小段）的从剪切结尾接着放，整项都在剪切里的丢掉。
      let start = at, startSrc = src
      for (const cut of cuts) {
        if (at < cut.from || at >= cut.to - cut.lead) continue
        if (until <= cut.to) { drop(record); return }
        start = cut.to; startSrc = src + (cut.to - at) * rate; break
      }
      drafts.push({ source: record, media, image, at: cutTime(start), src: startSrc, rate, xf, cursor, continued: false })
      // 横跨整个剪切的一项在剪切口接着放剪切结尾对应的源时间；停住的画面不变，不拆。
      if (rate > 0) for (const cut of cuts) if (cut.from > start && until > cut.to) drafts.push({ source: record, media, image, at: cutTime(cut.to), src: src + (cut.to - at) * rate, rate, xf: 0, cursor, continued: true })
    })
    drafts.sort((a, b) => a.at - b.at)
    // 截图按截图区分，录屏按素材区分：换了一段才默认叠化，同一段素材叠化到自己的另一处时换车道。
    const shots: MutableShot[] = [], recs: string[] = []
    drafts.forEach((draft, index) => {
      const previous = shots[index - 1], rec = draft.image ? `img:${draft.media}` : draft.media
      const xf = index === 0 || draft.continued ? 0 : draft.xf ?? (recs[index - 1] !== rec ? VIDEO_EDIT_SCENE_CROSSFADE_SECONDS : 0)
      let lane = 0
      if (previous && recs[index - 1] === rec) lane = xf > 0 ? 1 - previous.lane : previous.lane
      else { const last = recs.lastIndexOf(rec); if (last >= 0) lane = shots[last].lane }
      const input = draft.image ? `scene-input:${JSON.stringify([scene.id, draft.media])}` : `scene-input:${JSON.stringify([scene.id, containerId ?? null, kindName, draft.media, lane])}`
      const shot: MutableShot = { record: undefined, media: draft.media, image: draft.image, at: draft.at, end: index + 1 < drafts.length ? drafts[index + 1].at : end, src: draft.src, rate: draft.rate, xf, lane, cursor: draft.cursor, input }
      shots.push(shot); recs.push(rec)
      const list = shotsByRecord.get(draft.source) ?? []; list.push(shot); shotsByRecord.set(draft.source, list)
    })
    if (shots.length) tables.push({ containerId, kind: kindName, shots, end })
  }
  // 锚定用的索引：按（窗口，素材）分组、按开始排序，查找时二分到所在段落的开头。null 表示全部窗口。
  const anchorIndex = new Map<string | null, Map<string, MutableShot[]>>()
  const shotsFor = (containerId: string | null, media: string): readonly MutableShot[] => {
    let byMedia = anchorIndex.get(containerId)
    if (!byMedia) {
      byMedia = new Map()
      for (const table of tables) if (containerId === null || table.containerId === containerId) for (const shot of table.shots) { const list = byMedia.get(shot.media) ?? []; list.push(shot); byMedia.set(shot.media, list) }
      for (const list of byMedia.values()) list.sort((a, b) => a.at - b.at)
      anchorIndex.set(containerId, byMedia)
    }
    return byMedia.get(media) ?? []
  }

  // 第三步：逐条换算字段（父记录在前），{src} 在所在段落的窗口内容里找第一次放到这一秒的时刻。
  const resolved: MutableRecord[] = []
  const byId = new Map<string, MutableRecord>()
  for (const record of order) {
    if (dropped.has(record.id)) continue
    const kind = kindOf(record)!
    const parent = record.parent === undefined ? undefined : byId.get(record.parent)
    if (record.parent !== undefined && !parent) { dropped.add(record.id); continue }
    const shots = kind.role === 'shot' ? shotsByRecord.get(record) : undefined
    if (kind.role === 'shot' && !shots) { dropped.add(record.id); continue }
    let anchor: { media?: string; container: string | null; from: number; to: number } | undefined
    const anchorContext = (): { media?: string; container: string | null; from: number; to: number } => {
      if (anchor) return anchor
      let segment: ResolvedVideoEditSceneRecord | undefined = parent
      while (segment && !(kinds[segment.kind].role === 'segment' && segment.at !== undefined)) segment = segment.parent
      return anchor = { media: footageOf(record, raw, kinds), container: anchorContainer(record, raw, kinds, kind, id => containers.has(id)), from: segment?.at ?? -Infinity, to: segment?.end ?? Infinity }
    }
    const time = (value: CodeSceneValue, anchored: boolean): number | undefined => {
      const seconds = finite(value)
      if (seconds !== undefined) return cutTime(seconds)
      if (!anchored || !isAnchor(value)) return undefined
      const context = anchorContext()
      return context.media === undefined ? undefined : anchorTime(shotsFor(context.container, context.media), value.src, context.from, context.to)
    }
    let values = record.values as Values, copied = false, failed: string | undefined
    for (const [name, field] of Object.entries(kind.fields)) {
      const has = Object.hasOwn(record.values, name), value = has ? record.values[name] as CodeSceneValue : field.default
      if (value === undefined) continue
      let next: CodeSceneValue | undefined = value
      if (field.type === 'time') next = time(value, field.anchor === 'footage')
      else if (field.type === 'list' && field.of.type === 'time' && Array.isArray(value)) {
        const anchored = field.of.anchor === 'footage'
        const list = value.map(item => time(item, anchored))
        next = list.some(item => item === undefined) ? undefined : list.some((item, index) => item !== value[index]) ? list as number[] : value
      }
      if (next === undefined) { failed = name; break }
      if (!has || next !== value) { if (!copied) { values = { ...values }; copied = true } values[name] = next }
    }
    if (failed !== undefined) {
      const value = record.values[failed]
      drop(record, `values.${failed}`, isAnchor(value) ? `按录屏秒 ${value.src} 锚定，但所在段落的窗口内容里没有放到这一秒，也没有之后的内容。` : '时刻不是有效的秒数。')
      continue
    }
    let at = kind.at ? finite(values[kind.at]) : undefined
    let end = at === undefined ? undefined : kind.end ? finite(values[kind.end]) : kind.duration ? at + (finite(values[kind.duration]) ?? 0) : undefined
    if (shots) { at = shots[0].at; end = shots[shots.length - 1].end }
    const item: MutableRecord = { id: record.id, kind: record.kind, source: record, parent, children: [], values, at, end, footage: kind.footage ? footageOf(record, raw, kinds) : undefined, timetables: [] }
    for (const shot of shots ?? []) shot.record = item
    resolved.push(item); byId.set(item.id, item)
    parent?.children.push(item)
  }

  // untilNext 的结束：同一父记录下同类的下一条，最后一条到父记录结束（窗口内容已按时间表算好）。
  const groups = new Map<string, MutableRecord[]>()
  for (const item of resolved) {
    const kind = kinds[item.kind]
    if (kind.role === 'shot' || kind.influence !== 'untilNext' || item.at === undefined) continue
    const key = groupKey(item.parent?.id, item.kind), list = groups.get(key) ?? []
    list.push(item); groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort(byTime)
    list.forEach((item, index) => { item.end = index + 1 < list.length ? list[index + 1].at : item.parent?.end ?? options.duration ?? Infinity })
  }

  // 窗口被剪掉时它下面的内容记录都没留下，整张时间表一起去掉；留下的时间表每项都已连上自己的记录。
  const timetables: ResolvedVideoEditSceneTimetable[] = []
  for (const table of tables) {
    const container = table.containerId === undefined ? undefined : byId.get(table.containerId)
    if (table.containerId !== undefined && !container) continue
    const shots = table.shots as ResolvedVideoEditSceneShot[]
    const { inputs, overflow } = videoEditSceneTimetableInputs(shots, table.end)
    for (const key of overflow) issues.push({ recordId: table.containerId, path: 'timetable', severity: 'user', message: `窗口内容的一条取帧车道超过 ${CODE_VIDEO_SPAN_LIMIT} 段（${key}），之后的内容不再取帧；把这扇窗口的内容拆到几扇窗口里。` })
    const timetable: ResolvedVideoEditSceneTimetable = { container, kind: table.kind, shots, end: table.end, inputs }
    container?.timetables.push(timetable)
    timetables.push(timetable)
  }
  const byKind: Record<string, MutableRecord[]> = Object.fromEntries(Object.keys(kinds).map(kind => [kind, []]))
  for (const item of resolved) byKind[item.kind].push(item)
  for (const list of Object.values(byKind)) list.sort(byTime)
  for (const item of resolved) item.children.sort(byTime)
  return { scene, schema, records: resolved, byId, byKind, roots: resolved.filter(item => !item.parent).sort(byTime), timetables, cuts, issues }
}

/** 所属素材：footage 是 media 字段时就是它的值，是 ref 时沿被引用的记录一路找下去。 */
function footageOf(record: VideoEditSceneRecord, raw: ReadonlyMap<string, VideoEditSceneRecord>, kinds: CodeSceneSchema['kinds']): string | undefined {
  let current: VideoEditSceneRecord | undefined = record
  // 声明层已保证类型之间的 footage 引用不成环，所以最多走类型数那么多步；数据里的环到这里也会停下。
  for (let step = 0, limit = Object.keys(kinds).length; current && step <= limit; step++) {
    const kind: CodeSceneKindDeclaration | undefined = Object.hasOwn(kinds, current.kind) ? kinds[current.kind] : undefined
    if (!kind?.footage) return undefined
    const value = current.values[kind.footage]
    if (typeof value !== 'string') return undefined
    if (kind.fields[kind.footage].type === 'media') return value
    current = raw.get(value)
  }
  return undefined
}
/**
 * 锚定在哪扇窗口里找：footage 沿 ref 经过的窗口、记录自己的 ref 字段指向的窗口、祖先里的窗口，取第一个；
 * 都没有时在全部窗口内容里找（null）。窗口指挂着窗口内容（role 为 shot 的记录）的记录。
 */
function anchorContainer(record: VideoEditSceneRecord, raw: ReadonlyMap<string, VideoEditSceneRecord>, kinds: CodeSceneSchema['kinds'], kind: CodeSceneKindDeclaration, isContainer: (id: string) => boolean): string | null {
  const candidates: string[] = []
  let current: VideoEditSceneRecord | undefined = record
  for (let step = 0, limit = Object.keys(kinds).length; current && step <= limit; step++) {
    const currentKind: CodeSceneKindDeclaration | undefined = Object.hasOwn(kinds, current.kind) ? kinds[current.kind] : undefined
    const value = currentKind?.footage ? current.values[currentKind.footage] : undefined
    if (typeof value !== 'string' || currentKind!.fields[currentKind!.footage!].type !== 'ref') break
    candidates.push(value); current = raw.get(value)
  }
  for (const [name, field] of Object.entries(kind.fields)) { const value = record.values[name]; if (field.type === 'ref' && typeof value === 'string') candidates.push(value) }
  const seen = new Set<string>()
  for (let parent = record.parent; parent !== undefined && !seen.has(parent); parent = raw.get(parent)?.parent) { seen.add(parent); candidates.push(parent) }
  return candidates.find(isContainer) ?? null
}
/** 第一项放到源时间 src 的时刻；这一秒被跳过时取之后第一项的开头（源时间更晚的那一项）。只看开头落在 [from, to) 里的项。 */
function anchorTime(shots: readonly MutableShot[], src: number, from: number, to: number): number | undefined {
  let after: number | undefined
  for (let index = lowerBound(shots, from - EDGE); index < shots.length && shots[index].at < to - EDGE; index++) {
    const shot = shots[index]
    if (shot.rate === 0) { if (Math.abs(shot.src - src) < HOLD_MATCH) return shot.at }
    else if (src >= shot.src - EDGE && src <= shot.src + (shot.end - shot.at) * shot.rate + EDGE) return shot.at + (src - shot.src) / shot.rate
    if (after === undefined && shot.src > src) after = shot.at
  }
  return after
}
