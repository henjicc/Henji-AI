import { VIDEO_EDIT_SCENE_CUT_LEAD_SECONDS, type ResolvedVideoEditScene, type ResolvedVideoEditSceneRecord } from './sceneResolve'

/**
 * 每条记录影响到的片子时段（剪后时间，闭区间），给预渲染分段指纹用：一段只计入与它相交的记录，
 * 说不清时段的记录计入每一段。按声明的 influence 与 margin 算：
 * - span：at 到结束；untilNext：at 到组里下一条开始（最后一条到父记录结束）；窗口内容还算上下一项叠化进来的那一会儿。
 * - neighbors（像关键帧）：上一条的 at 到下一条的结束；组里第一条往前、最后一条往后延伸到最近的有时段祖先（通常是段落）
 *   的起止（第一个落点之前、最后一个之后通常停在那一处），没有这样的祖先才不封口。
 * - 再在前后加上 margin。
 * - 剪切影响它之后的全部：剪切口前 lead 秒起到片尾（启用、停用都算，切换开关会改变后面所有画面）。
 * - 没有位置或没声明 influence 的记录说不清时段，按全局计入。
 * 时段用的是解析后的时刻，所以锚定、剪切移动了记录时，它会落到新的分段里；分段指纹也应按解析后的取值计算。
 * 按解析结果对象身份缓存。
 */
export interface VideoEditSceneFootprint { readonly record: ResolvedVideoEditSceneRecord; readonly from: number; readonly to: number }
export interface VideoEditSceneFootprints {
  /** 说不清时段、每一段都要计入的记录。 */
  readonly global: readonly ResolvedVideoEditSceneRecord[]
  /** 有时段的记录，按 from 排序。 */
  readonly timed: readonly VideoEditSceneFootprint[]
}
const derived = new WeakMap<ResolvedVideoEditScene, VideoEditSceneFootprints>()

export function videoEditSceneFootprints(resolved: ResolvedVideoEditScene): VideoEditSceneFootprints {
  const cached = derived.get(resolved)
  if (cached) return cached
  const shots = new Map<ResolvedVideoEditSceneRecord, { from: number; to: number }>()
  for (const { shots: list } of resolved.timetables) list.forEach((shot, index) => {
    const next = list[index + 1], to = shot.end + (next && next.input !== shot.input ? next.xf : 0)
    const extent = shots.get(shot.record)
    shots.set(shot.record, extent ? { from: Math.min(extent.from, shot.at), to: Math.max(extent.to, to) } : { from: shot.at, to })
  })
  // neighbors 记录按（父记录，类型）分组；子记录与 roots 已按时刻排好，组内顺序就是时间顺序。
  const neighbors = new Map<ResolvedVideoEditSceneRecord, { previous?: ResolvedVideoEditSceneRecord; next?: ResolvedVideoEditSceneRecord }>()
  for (const siblings of [resolved.roots, ...resolved.records.map(record => record.children)]) {
    const last = new Map<string, ResolvedVideoEditSceneRecord>()
    for (const record of siblings) {
      if (record.at === undefined || resolved.schema.kinds[record.kind].influence !== 'neighbors') continue
      const previous = last.get(record.kind)
      neighbors.set(record, { previous })
      if (previous) neighbors.get(previous)!.next = record
      last.set(record.kind, record)
    }
  }
  const global: ResolvedVideoEditSceneRecord[] = [], timed: VideoEditSceneFootprint[] = []
  for (const record of resolved.records) {
    const kind = resolved.schema.kinds[record.kind]
    const before = kind.margin?.before ?? 0, after = kind.margin?.after ?? 0
    const add = (from: number, to: number): void => { timed.push({ record, from: from - before, to: to + after }) }
    const shot = shots.get(record), around = neighbors.get(record)
    if (record.at === undefined) global.push(record)
    else if (kind.role === 'cut') add(record.at - VIDEO_EDIT_SCENE_CUT_LEAD_SECONDS, Infinity)
    else if (shot) add(shot.from, shot.to)
    else if (kind.influence === 'span' || kind.influence === 'untilNext') add(record.at, record.end ?? Infinity)
    else if (around) {
      let scope = record.parent
      while (scope && scope.at === undefined) scope = scope.parent
      add(around.previous ? around.previous.at! : scope?.at ?? -Infinity, around.next ? around.next.end ?? around.next.at! : scope?.end ?? Infinity)
    } else global.push(record)
  }
  timed.sort((a, b) => a.from - b.from)
  const footprints = { global, timed }
  derived.set(resolved, footprints)
  return footprints
}

/** 与片子时段 [from, to) 相交的记录：全局记录在前，其余按时段开始排序。 */
export function videoEditSceneRecordsInRange(footprints: VideoEditSceneFootprints, from: number, to: number): ResolvedVideoEditSceneRecord[] {
  const records = [...footprints.global]
  for (const footprint of footprints.timed) {
    if (footprint.from >= to) break
    if (footprint.to >= from) records.push(footprint.record)
  }
  return records
}
