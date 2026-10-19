import { createLogger } from '@/core/logging'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { videoEditComposition, videoEditDuration } from '@/core/videoEdit/document'
import { assertVideoEditReviewBudget, collectVideoEditReviewStructure, selectVideoEditReviewFrames, videoEditReviewRange, videoEditTrackingReviewRanges, videoEditCrowdedReviewEvents, VIDEO_EDIT_REVIEW_TRACK_SAMPLE_BUDGET, type VideoEditReviewRecord } from '@/core/videoEdit/review'
import { projectVideoEditTrackingRanges, videoEditSourceMapTrackingRange } from '@/core/videoEdit/sourceMap'
import { videoEditTrackerKey } from '@/core/videoEdit/tracking'
import { videoEditTrackingSourceId } from '@/core/videoEdit/trackingSource'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { readVideoEditTrackReviewHeader } from '../engine/videoEditTrackResults'
import { videoEditTrackResults } from './videoEditTracking'
import { videoEditTrackerEntityId } from './videoEditCompositeEntities'
import { videoEditObservationVersion } from './videoEditObservationVersion'
import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { analyzeVideoEditMotionStructure } from './videoEditMotionReviewWorkerClient'

interface Snapshot { key: string; version: string; records: VideoEditReviewRecord[]; frames: number[]; warnings: string[] }
const snapshots = new WeakMap<VideoEditInstance, Map<string, Snapshot>>()
const logger = createLogger('features.videoEdit.review')

export async function queryVideoEditReview(raw: unknown, context: Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId'>): Promise<Record<string, unknown>> {
  const input = queryVideoEditReviewCapability.inputSchema.parse(raw)
  const { projectId, childId } = splitVideoEditRef(input.sequenceRef)
  if (projectId !== input.documentRef.id || !childId) throw new Error('sequenceRef 必须属于 documentRef，请使用完整序列引用。')
  const owner = requireVideoEditInstance(projectId); const contentVersion = owner.contentVersion
  const version = videoEditObservationVersion(owner, owner.document.revision)
  const assertCurrent = (): void => {
    context.signal.throwIfAborted()
    if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
    if (!isVideoEditContentCurrent(owner, contentVersion) || videoEditObservationVersion(owner, owner.document.revision) !== version) throw new Error('检查期间剪辑或跟踪结果已改变，请重新查询。')
  }
  logger.info('剪辑检查点查询开始', { event: 'video_edit.review.start', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId, from: input.from, to: input.to } })
  try {
    assertCurrent()
    const composition = videoEditComposition(owner.document, childId)
    const range = videoEditReviewRange(composition, input.from, input.to)
    const key = JSON.stringify([childId, version, input.from, input.to, input.threshold, input.maxFrames, input.motion])
    const saved = snapshots.get(owner) ?? new Map<string, Snapshot>(); snapshots.set(owner, saved)
    let id: string; let offset = 0; let snapshot: Snapshot
    if (input.cursor) {
      const parsed = /^([a-f0-9-]{36}):(\d+)$/.exec(input.cursor); const previous = parsed && saved.get(parsed[1])
      if (!parsed || !previous || previous.key !== key) throw new Error('检查分页已失效，请保持原条件重新查询。')
      id = parsed[1]; offset = Number(parsed[2]); snapshot = previous
      if (!Number.isSafeInteger(offset) || offset >= snapshot.records.length) throw new Error('检查分页位置无效，请重新查询。')
    } else {
      id = crypto.randomUUID()
      const { records, tracking } = collectVideoEditReviewStructure(composition, range)
      const results = videoEditTrackResults(composition)
      const warnings = ['检查点是结构候选和优先抽样，不证明实际像素可见或其余时段无问题。', '跟踪区间来自原始采样；渲染可能插值或借用附近有效位置，跟丢不等于画面空白。']
      if (input.motion) {
        const motion = await analyzeVideoEditMotionStructure({ composition, range, policy: { minGapSeconds: input.motion.minGapSeconds, minimumStillSeconds: input.motion.minimumHoldSeconds } }, context.signal)
        assertCurrent()
        for (const record of motion.records) {
          assertVideoEditReviewBudget(records.length + 1)
          const suggestion = record.kind === 'motion_hard_stop' ? '观察运动结束前后连续帧；若非有意硬停，可沿原片段曲线调整减速尾段。'
            : record.kind === 'motion_hold' ? '这是片段变换保持区间；结合阅读、留白及素材内部动作判断是否需要调整，不自动补动画。'
              : '观察这段原生变换是否服务当前信息；有意承载运动可保留，调整仍沿原片段属性与曲线。'
          records.push({ ...record, motionEvidence: { basis: 'clip_transform', ...(record.peakSpeed === undefined ? {} : { peakSpeed: record.peakSpeed }), suggestion } })
        }
        warnings.push('运动证据仅覆盖片段原生变换，速度为所在序列画面宽度百分比/播放秒；代码内部动画、视频像素运动、跟随和效果未据此判断。变换保持不等于画面静止，事件密集和硬停也可能是创作意图。')
        for (const event of videoEditCrowdedReviewEvents(records, composition.fps, input.motion.minGapSeconds)) {
          assertVideoEditReviewBudget(records.length + 1)
          records.push({ kind: 'event_crowded', timeline: { from: event.from, to: Math.min(range.to, event.to) }, sequenceId: childId, path: [], subjectId: childId,
            motionEvidence: { basis: 'structural_events', gapSeconds: event.gapSeconds, suggestion: '核对这段是否有多个信息同时争抢注意力；按风格和阅读时间决定是否错开、合并或保留，不能只按间隔删减。' } })
        }
      }
      const headers = new Map<string, ReturnType<typeof readVideoEditTrackReviewHeader>>()
      const budget = { remaining: VIDEO_EDIT_REVIEW_TRACK_SAMPLE_BUDGET }
      for (const { composition: local, entry } of tracking) {
        const step = entry.path.at(-1)!; const sourceId = videoEditTrackingSourceId(local, step.clip)
        for (const tracker of step.clip.trackers ?? []) {
          assertCurrent()
          const base = { sequenceId: local.id, path: entry.path, subjectId: videoEditTrackerEntityId(step.clipId, tracker.id) }
          const handle = sourceId ? results[videoEditTrackerKey(sourceId, tracker)] : undefined
          if (!handle) { assertVideoEditReviewBudget(records.length + 1); records.push({ ...base, kind: 'tracking_unavailable', timeline: entry.timeline }); continue }
          let header
          try {
            const handleKey = JSON.stringify(handle)
            let pending = headers.get(handleKey)
            if (!pending) { pending = readVideoEditTrackReviewHeader(handle, context.signal); headers.set(handleKey, pending) }
            header = await pending
          } catch (error) {
            assertCurrent()
            logger.warn('已有跟踪结果暂不可读', { event: 'video_edit.review.tracking_unavailable', requestId: context.requestId, context: { documentId: projectId, sequenceId: local.id, clipId: step.clipId, trackerId: tracker.id }, error })
            if (!warnings.includes('部分已有跟踪结果不可读，请稍后复核或重新跟踪。')) warnings.push('部分已有跟踪结果不可读，请稍后复核或重新跟踪。')
            assertVideoEditReviewBudget(records.length + 1); records.push({ ...base, kind: 'tracking_unavailable', timeline: entry.timeline }); continue
          }
          assertCurrent()
          const source = videoEditSourceMapTrackingRange(entry)
          for (const fact of videoEditTrackingReviewRanges(header, source, input.threshold, budget)) {
            for (const timeline of projectVideoEditTrackingRanges(entry, [fact])) {
              assertVideoEditReviewBudget(records.length + 1)
              records.push({ ...base, kind: fact.kind, timeline, source: { fromUs: fact.fromUs, toUs: fact.toUs }, ...(fact.confidence === undefined ? {} : { confidence: fact.confidence }) })
            }
          }
        }
      }
      records.sort((a, b) => a.timeline.from - b.timeline.from || a.kind.localeCompare(b.kind) || a.subjectId.localeCompare(b.subjectId))
      snapshot = { key, version, records, warnings, frames: selectVideoEditReviewFrames(records, range, input.maxFrames, videoEditDuration(composition)) }
      assertCurrent()
      while (saved.size >= 4) saved.delete(saved.keys().next().value!)
      saved.set(id, snapshot)
    }
    const ref = (kind: string, id: string) => ({ kind, id: `${projectId}:${id}` })
    const records = snapshot.records.slice(offset, offset + input.limit).map(record => ({
      kind: record.kind, timeline: { fromFrame: record.timeline.from, toFrame: record.timeline.to }, sequenceRef: ref('video_edit.sequence', record.sequenceId),
      subjectRef: ref(record.kind === 'event_crowded' ? 'video_edit.sequence' : record.kind.startsWith('tracking_') ? 'video_edit.tracker' : record.kind === 'caption' ? 'video_edit.caption' : record.kind === 'transition' ? 'video_edit.transition' : record.subjectType ?? 'video_edit.clip', record.subjectId),
      path: record.path.map(step => ({ sequenceRef: ref('video_edit.sequence', step.sequenceId), clipRef: ref('video_edit.clip', step.clipId) })),
      ...(record.confidence === undefined ? {} : { confidence: record.confidence }), ...(record.source ? { source: { ...record.source } } : {}),
      ...(record.motionEvidence ? { motionEvidence: { ...record.motionEvidence } } : {}),
    }))
    assertCurrent()
    logger.info('剪辑检查点查询完成', { event: 'video_edit.review.completed', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId, total: snapshot.records.length, frames: snapshot.frames.length } })
    return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, documentVersion: snapshot.version, range: { fromFrame: range.from, toFrame: range.to }, checkpoints: { frames: [...snapshot.frames], selection: 'prioritized_sample' }, records, total: snapshot.records.length,
      nextCursor: offset + records.length < snapshot.records.length ? `${id}:${offset + records.length}` : null, warnings: [...snapshot.warnings], message: `已选择${snapshot.frames.length}个检查帧，返回${records.length}项复核依据，共${snapshot.records.length}项。` }
  } catch (error) {
    const meta = { event: context.signal.aborted ? 'video_edit.review.cancelled' : 'video_edit.review.failed', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId } }
    if (context.signal.aborted) logger.info('剪辑检查点查询已取消', meta)
    else logger.error('剪辑检查点查询失败', error, meta)
    throw error
  }
}
