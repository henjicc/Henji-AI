import type { z } from 'zod'
import type { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import type { ApplicationRef, JsonValue } from '@/core/application-control'
import { videoEditCodeInputs, type VideoEditCodeDeclarationReader } from '@/core/videoEdit/codeInputParameters'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditDuration, type VideoEditComposition } from '@/core/videoEdit/document'
import { recordingCursorPointAt } from '@/core/videoEdit/recordingTracks'
import { assertVideoEditReviewBudget, type VideoEditReviewRecord } from '@/core/videoEdit/review'
import { projectVideoEditSourceMapRanges, projectVideoEditSequenceMapRange, videoEditSourceMapSampleSeconds, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange } from '@/core/videoEdit/sourceMap'
import { reviewVideoEditScene, type VideoEditSceneReviewFact, type VideoEditSceneReviewKind } from '@/core/videoEdit/scene/sceneReview'
import { videoEditSceneWriteBackTime, videoEditSceneWriteBackSpan, videoEditSceneCutTime, type ResolvedVideoEditScene, type ResolvedVideoEditSceneRecord } from '@/core/videoEdit/scene/sceneResolve'
import { validateCodeSceneRecords } from '@/core/videoEdit/scene/sceneDeclaration'
import { readRecordingClipEvents } from './videoEditRecordingClip'
import { videoEditSceneRef, videoEditSceneRecordRef } from './videoEditSceneFields'

export interface VideoEditSceneReviewProposal { ref: ApplicationRef; propertyId: string; value: JsonValue }
export interface VideoEditSceneReviewRecord extends Omit<VideoEditReviewRecord, 'kind' | 'subjectType' | 'motionEvidence'> {
  kind: VideoEditSceneReviewKind
  subjectType: 'video_edit.scene_record' | 'video_edit.scene'
  subjectRef: ApplicationRef
  motionEvidence: Omit<NonNullable<VideoEditReviewRecord['motionEvidence']>, 'basis'> & { basis: 'scene_data'; proposal?: VideoEditSceneReviewProposal[] }
  /** 只由当前页调用，避免给尚未返回的记录预先做建议校验。 */
  readEvidence?: () => VideoEditSceneReviewRecord['motionEvidence']
}
export type VideoEditSceneReviewInput = NonNullable<z.infer<typeof queryVideoEditReviewCapability.inputSchema>['scene']>
/** 二分查找与区间划分的计算预算，与最终返回的候选条数分别计量。 */
export const VIDEO_EDIT_SCENE_REVIEW_WORK_BUDGET = 5_000_000

function seconds(value: number): string {
  const centiseconds = Math.round(value * 100)
  return `${Math.floor(centiseconds / 6000)}:${(centiseconds % 6000 / 100).toFixed(2).padStart(5, '0')}`
}
function tuned(record: ResolvedVideoEditSceneRecord, field: string): boolean {
  return (record.source.tuned ?? []).some(path => path === field || path.startsWith(`${field}.`))
}
function anchored(record: ResolvedVideoEditSceneRecord, scene: ResolvedVideoEditScene): boolean {
  const kind = scene.schema.kinds[record.kind]
  return [kind.at, kind.end].some(field => field && typeof record.source.values[field] === 'object' && record.source.values[field] !== null)
}

interface EndAdvice { proposal?: VideoEditSceneReviewProposal[]; reason?: string }

/** 建议只用不记日志的纯校验；复核不能伪装成一次被拒绝的写入。 */
function endProposal(projectId: string, scene: ResolvedVideoEditScene, record: ResolvedVideoEditSceneRecord, end: number): EndAdvice {
  const kind = scene.schema.kinds[record.kind], field = kind.end ?? kind.duration
  if (kind.influence !== 'span' || !field || !kind.at || record.at === undefined) return { reason: '这类记录没有可独立收短的明确起止字段。' }
  if (tuned(record, field)) return { reason: '结束时刻是手调过的值，不自动建议覆盖。' }
  if (anchored(record, scene)) return { reason: '时刻使用录屏秒 {src} 锚定；直接写 start_cut/end_cut 可能把对应锚定换成固定秒数，需先确认，或在 values 中保持锚定形式。' }
  if (end <= record.at) return { reason: '收短到错位开头会移除整条记录的生效时段，需先确认是否删除或重设记录。' }
  const start = record.source.values[kind.at], original = record.source.values[field]
  if (typeof start !== 'number' || typeof original !== 'number') return { reason: '开始或结束字段不是可直接换算的固定秒数。' }
  const rawEnd = videoEditSceneWriteBackTime(scene.cuts, end, { original: kind.end ? original : start + original })
  const next = { id: record.id, kind: record.kind, values: { [field]: kind.end ? rawEnd : rawEnd - start } }
  // 结束一侧的写回须与 videoEditScenes.ts 的 retimeRecord 同步；共同依赖解析器的剪切写回函数。
  // 这里只核对被改字段，未改的 parent / ref 不重复校验，也不解析整份片子数据。
  const schema = { ...scene.schema, kinds: { [record.kind]: { fields: { [field]: kind.fields[field] } } } }
  const issues = validateCodeSceneRecords(schema, { ...scene.scene, records: [next] })
  if (issues.length) return { reason: `结束字段未通过声明校验：${issues[0].message}` }
  const safe = videoEditSceneWriteBackSpan(scene.cuts, record.at, end, { start, end: rawEnd })
  if (Math.abs(safe.start - start) > 1e-6 || Math.abs(safe.end - rawEnd) > 1e-6 || Math.abs(videoEditSceneCutTime(scene.cuts, rawEnd) - end) > 1e-6) return { reason: '剪切口换算不能同时保持原开始和要求的结束时刻。' }
  return { proposal: [{ ref: videoEditSceneRecordRef(projectId, scene.scene.id, record.source), propertyId: 'video_edit.scene_record.end_cut', value: end }] }
}

function evidence(projectId: string, local: VideoEditComposition, scene: ResolvedVideoEditScene, fact: VideoEditSceneReviewFact, timeline: VideoEditSourceMapRange, advice: EndAdvice | undefined, includeProposal = false): VideoEditSceneReviewRecord['motionEvidence'] {
  const record = fact.record
  const location = `序列帧 ${timeline.from}–${timeline.to}，片子剪后 ${seconds(fact.from)}`
  if (fact.kind === 'scene_issue') return { basis: 'scene_data', suggestion: `${fact.issue!.message}（${location}；字段 ${fact.issue!.path}）` }
  if (fact.kind === 'scene_cursor_jump') {
    const baked = [fact.previous, fact.shot].some(shot => local.media.find(media => media.id === shot?.media)?.recordingCursor?.cursorBakedIn)
    const manual = record && tuned(record, 'cursor')
    const cursorProposal = includeProposal && record && !manual && !baked && scene.schema.kinds[record.kind].fields.cursor?.type === 'boolean'
      ? [{ ref: videoEditSceneRecordRef(projectId, scene.scene.id, record.source), propertyId: 'video_edit.scene_record.values', value: { ...structuredClone(record.source.values), cursor: false } as JsonValue }] : undefined
    return { basis: 'scene_data', suggestion: `${location} 的鼠标位置跳变；${manual ? 'cursor 是手调过的值，不自动建议覆盖。' : ''}${baked ? '鼠标已烘焙进画面，关闭 values.cursor 无法去掉它；' : manual ? '' : '可把这项 values.cursor 设为 false，或'}微调 src 使鼠标衔接，或在声明允许时加 xf 叠化。跨剪切续放的每个接缝单独列出。`, ...(cursorProposal ? { proposal: cursorProposal } : {}) }
  }
  const kind = record && scene.schema.kinds[record.kind], field = kind?.end ?? kind?.duration
  const manual = record && field && tuned(record, field)
  const anchor = record && anchored(record, scene)
  const proposal = advice?.proposal
  const tail = Boolean(advice) || fact.tail
  const protection = `${manual ? '结束时刻是手调过的值，不自动建议覆盖。' : ''}${anchor ? '时刻使用录屏秒 {src} 锚定；直接写 start_cut/end_cut 可能把对应锚定换成固定秒数，需先确认，或在 values 中保持锚定形式。' : ''}`
  const repair = proposal ? `仅收短这段持续到记录结束的尾部错位，把 end_cut 收到 ${seconds(proposal[0].value as number)}。`
    : kind?.influence === 'neighbors' || kind?.influence === 'untilNext' ? `${protection}核对相邻落点：把下一落点提前到换画面时刻，或在该时刻新增指向正确 media/win 的落点；不能只改本落点的 duration。`
      : tail ? `尾部错位，未给收短建议的原因：${advice?.reason ?? (protection || '真实错位开头尚未确认，需扩大检查范围再查。')}核对 media/win 或 sourceTime 后再选择改法。`
        : fact.openEnd ? `尚未确认是否延续到记录结束（缩小或扩大检查范围再查）。${protection}先核对 media/win 或 sourceTime，不按当前范围边界收短。`
          : `${protection}中段错位：把记录按错位区间拆成多段，保留错位前后正常的部分；或在错位段前后各加指向正确 media/win 的落点。不能把中段错位当作尾部收短。`
  const media = local.media.find(media => media.id === fact.shot?.media)
  const onset = fact.openStart ? `${location} 处仍有数据错位（此前已开始，此时刻只是检查上下文边界）` : `${location} 起数据错位`
  return { basis: 'scene_data', suggestion: `${onset}：这个落点指向的画面此刻不在窗口里${media ? `（当前内容“${media.name}”）` : ''}。${repair}`, ...(proposal ? { proposal } : {}) }
}

/** 用正式嵌套时钟取得完整放置区间，供播放时长阈值与查询边界上下文使用。 */
function placementTimeline(root: VideoEditComposition, local: VideoEditComposition, entry: VideoEditSourceMapEntry): VideoEditSourceMapRange {
  let timeline = { from: 0, to: videoEditDuration(root) }
  for (let i = 0; i < entry.path.length; i++) {
    const clip = entry.path[i].clip
    const projected = projectVideoEditSequenceMapRange({ composition: local, path: entry.path.slice(0, i), timeline }, { from: clip.start, to: clip.start + clip.duration })
    if (!projected) return entry.timeline
    timeline = projected
  }
  return { from: Math.min(timeline.from, entry.timeline.from), to: Math.max(timeline.to, entry.timeline.to) }
}

interface Candidate { local: VideoEditComposition; scene: ResolvedVideoEditScene; fact: VideoEditSceneReviewFact; entry: VideoEditSourceMapEntry; timeline: VideoEditSourceMapRange; subjectRef: ApplicationRef }

/** 同记录同源区间的重复引用只报最早放置；不相连的错位、拆分片段及续放接缝分别保留。 */
export async function collectVideoEditSceneReview(projectId: string, composition: VideoEditComposition, range: VideoEditSourceMapRange, options: VideoEditSceneReviewInput,
  read: VideoEditCodeDeclarationReader, signal: AbortSignal, assertCurrent: () => void, existingCount = 0, warnings: string[] = []): Promise<VideoEditSceneReviewRecord[]> {
  const entries: Array<{ local: VideoEditComposition; entry: VideoEditSourceMapEntry }> = []
  let work = 0
  const checkWork = (count = 1): void => {
    signal.throwIfAborted(); assertCurrent(); work += count
    if (work > VIDEO_EDIT_SCENE_REVIEW_WORK_BUDGET) throw new Error('片子数据检查计算量超过单次5000000步预算；请缩小 from/to 或拆开检查项，未截断结果。')
  }
  visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(local, entry) { checkWork(); if (entry.path.at(-1)!.clip.code) entries.push({ local, entry }) } })
  const candidates = new Map<string, Candidate>()
  const events = new Map<string, Promise<Awaited<ReturnType<typeof readRecordingClipEvents>>>>()
  const factCache = new Map<ResolvedVideoEditScene, Map<string, VideoEditSceneReviewFact[]>>()
  const unreadable = new Set<string>()
  for (const { local, entry } of entries) {
    checkWork()
    const clip = entry.path.at(-1)!.clip
    const inputs = videoEditCodeInputs(local, clip.code, read)
    if (inputs?.unresolved.length) unreadable.add(clip.name)
    const full = placementTimeline(composition, local, entry)
    const padding = Math.ceil(options.minSeconds * composition.fps) + 1
    const context = { from: Math.max(full.from, entry.timeline.from - padding), to: Math.min(full.to, entry.timeline.to + padding) }
    const bounds = videoEditClipSourceRange(clip, local.fps)
    const points = [context.from, context.to - 1, context.to].map(frame => videoEditSourceMapSampleSeconds(entry, frame))
    const sourceRange = { from: Math.max(bounds.from, Math.min(...points)), to: Math.min(bounds.to + 1e-6, Math.max(...points) + 1e-6) }
    for (const scene of Object.values(inputs?.scenes ?? {})) {
      let cache = factCache.get(scene)
      if (!cache) { cache = new Map(); factCache.set(scene, cache) }
      const cacheKey = JSON.stringify([sourceRange, bounds.to, options.checks])
      let facts = cache.get(cacheKey)
      if (!facts) { facts = reviewVideoEditScene(scene, { checks: options.checks, minSeconds: 0, to: Math.max(bounds.to, sourceRange.to), range: sourceRange, work: checkWork }); cache.set(cacheKey, facts) }
      for (const original of facts) {
        checkWork()
        const fact = { ...original }
        if (fact.kind === 'scene_issue') {
          const onset = inputs?.issues.find(item => item.scene === scene.scene && item.issue === fact.issue)?.from
          if (onset !== undefined) fact.from = Math.max(fact.from, onset)
        }
        if (fact.to < fact.from) continue
        const source = [{ fromUs: fact.from * 1e6, toUs: fact.to * 1e6 }]
        const timelines = projectVideoEditSourceMapRanges(entry, source)
        if (!timelines.length) continue
        if (fact.kind === 'scene_box_stale') {
          const duration = projectVideoEditSourceMapRanges({ ...entry, timeline: context }, source).reduce((sum, span) => sum + (span.to - span.from) / composition.fps, 0)
          if (duration + 1e-7 < options.minSeconds) continue
        }
        if (fact.kind === 'scene_cursor_jump') {
          const a = fact.previous!, b = fact.shot!
          const point = async (mediaId: string, src: number): Promise<[number, number] | null> => {
            const source = local.media.find(value => value.id === mediaId)?.recordingCursor
            if (!source) return null
            let pending = events.get(mediaId)
            if (!pending) { pending = readRecordingClipEvents(source, signal); events.set(mediaId, pending) }
            const list = await pending
            checkWork()
            const p = recordingCursorPointAt(list, Math.round(src * 1e6) + source.recordingStartUs)
            return p ? [p[0] / source.width, p[1] / source.width] : null
          }
          const p = await point(a.media, a.src + (b.at - a.at) * a.rate), q = await point(b.media, b.src)
          if (!p || !q || Math.hypot(p[0] - q[0], p[1] - q[1]) <= options.cursorJumpRatio) continue
        }
        const record = fact.record?.source ?? scene.scene.records.find(item => item.id === fact.recordId)
        const subjectRef = record ? videoEditSceneRecordRef(projectId, scene.scene.id, record) : videoEditSceneRef(projectId, scene.scene)
        const covered = [Math.max(fact.from, entry.source.fromUs / 1e6), Math.min(fact.to, entry.source.toUs / 1e6)].map(t => Math.round(t * 1e6))
        const key = JSON.stringify([subjectRef, fact.kind, covered, fact.issue?.path, fact.issue?.message])
        for (const timeline of timelines) {
          const previous = candidates.get(key)
          if (previous && previous.timeline.from <= timeline.from) continue
          if (!previous) assertVideoEditReviewBudget(existingCount + candidates.size + 1)
          candidates.set(key, { local, scene, fact, entry, timeline, subjectRef })
        }
      }
    }
  }
  if (unreadable.size) warnings.push(`部分片段引用的片子数据或代码声明不可读：${[...unreadable].slice(0, 8).join('、')}。这些片段未完成片子数据检查；其他结果照常返回，请核对 scene 参数与固定代码版本后重查。`)
  const grouped = new Map<string, VideoEditSceneReviewFact[]>()
  for (const candidate of candidates.values()) if (candidate.fact.kind === 'scene_box_stale') {
    const list = grouped.get(candidate.subjectRef.id) ?? []
    list.push(candidate.fact); grouped.set(candidate.subjectRef.id, list)
  }
  const tails = new Map<string, VideoEditSceneReviewFact>()
  for (const [id, facts] of grouped) {
    const merged: VideoEditSceneReviewFact[] = []
    for (const fact of facts.sort((a, b) => a.from - b.from)) {
      const last = merged.at(-1)
      if (!last || fact.from > last.to + 1e-6) merged.push({ ...fact })
      else {
        if (fact.from === last.from && !fact.openStart) last.openStart = false
        last.to = Math.max(last.to, fact.to); last.tail ||= fact.tail
      }
    }
    const tail = merged.find(fact => fact.tail)
    if (tail) tails.set(id, tail)
  }
  const proposals = new Map<string, EndAdvice>()
  return [...candidates.values()].map(({ local, scene, fact, entry, timeline, subjectRef }) => {
    let cached: VideoEditSceneReviewRecord['motionEvidence'] | undefined
    const readEvidence = (): VideoEditSceneReviewRecord['motionEvidence'] => {
      if (cached) return cached
      const tail = tails.get(subjectRef.id)
      const inTail = tail && fact.from >= tail.from - 1e-6 && fact.to <= tail.to + 1e-6
      if (fact.kind === 'scene_box_stale' && fact.record && inTail && !proposals.has(subjectRef.id)) proposals.set(subjectRef.id,
        tail.openStart ? { reason: '真实错位开头在检查上下文之外，不能用上下文边界收短；请扩大范围再查。' } : endProposal(projectId, scene, fact.record, tail.from))
      return cached = evidence(projectId, local, scene, fact, timeline, inTail ? proposals.get(subjectRef.id) : undefined, true)
    }
    return { kind: fact.kind, timeline, sequenceId: local.id, path: entry.path, subjectId: subjectRef.id.slice(projectId.length + 1), subjectRef,
      subjectType: subjectRef.kind as VideoEditSceneReviewRecord['subjectType'], motionEvidence: evidence(projectId, local, scene, fact, timeline, undefined), readEvidence }
  })
}

/** 限制每个同步时间片，避免逐条定时器的嵌套延迟；返回前也让待处理的取消或编辑生效。 */
export async function readVideoEditSceneReviewPage(records: readonly VideoEditSceneReviewRecord[], signal: AbortSignal, assertCurrent: () => void): Promise<ReadonlyMap<VideoEditSceneReviewRecord, VideoEditSceneReviewRecord['motionEvidence']>> {
  const prepared = new Map<VideoEditSceneReviewRecord, VideoEditSceneReviewRecord['motionEvidence']>()
  let started = performance.now(), count = 0
  for (const record of records) {
    signal.throwIfAborted(); assertCurrent()
    if (count >= 16 || performance.now() - started >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal.throwIfAborted(); assertCurrent()
      started = performance.now(); count = 0
    }
    prepared.set(record, record.readEvidence?.() ?? record.motionEvidence)
    count++
  }
  if (count) await new Promise<void>(resolve => setTimeout(resolve, 0))
  signal.throwIfAborted(); assertCurrent()
  return prepared
}
