import { createLogger } from '@/core/logging'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { videoEditComposition, videoEditDuration, type VideoEditMedia } from '@/core/videoEdit/document'
import { assertVideoEditReviewBudget, collectVideoEditReviewStructure, selectVideoEditReviewFrames, videoEditReviewRange, videoEditTrackingReviewRanges, videoEditCrowdedReviewEvents, VIDEO_EDIT_REVIEW_TRACK_SAMPLE_BUDGET, type VideoEditReviewRecord } from '@/core/videoEdit/review'
import { projectVideoEditTrackingRanges, videoEditSourceMapTrackingRange, visitVideoEditPictureInstances } from '@/core/videoEdit/sourceMap'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
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
import { withVideoEditCodeMetadata, readVideoEditCodeProgram } from './videoEditCodeState'
import { codeTextFontGeneration } from '../videoEditGlyphMetrics'
import { readVideoEditPixelMotion, verifyVideoEditMotionSources } from './videoEditPixelMotion'
import { readVideoEditCodeMotionAudio } from './videoEditCodeMotionAudio'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import type { CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import { videoEditMotionSpeedFacts, VIDEO_EDIT_MOTION_PACE_LIMITS } from '@/core/videoEdit/pictureReview'
import { collectVideoEditTextSafety, type VideoEditTextMeasure } from '@/core/videoEdit/textSafetyReview'
import { videoEditCodeSceneKeys } from '@/core/videoEdit/codeInputParameters'
import { collectVideoEditSceneReview, readVideoEditSceneReviewPage, type VideoEditSceneReviewRecord } from './videoEditSceneReview'
import { settleVideoEditCodeDeclarations, videoEditCodeDeclarationReader } from './videoEditCodeDeclarations'

/** Same measuring path as the Program text overlay: the renderer document's loaded fonts. */
function reviewTextMeasure(): VideoEditTextMeasure | undefined {
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try { context = globalThis.document?.createElement('canvas').getContext('2d') ?? (typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')) } catch { context = null }
  if (!context) return undefined
  const measuring = context
  return (text, font) => { measuring.font = font; return measuring.measureText(text).width }
}

type ReviewRecord = VideoEditReviewRecord | VideoEditSceneReviewRecord
function isSceneRecord(record: ReviewRecord): record is VideoEditSceneReviewRecord { return record.motionEvidence?.basis === 'scene_data' }
/** 抽帧器只需要区间与优先级；片子数据按普通结构事件取帧，不进入运动事件密度。 */
function frameCandidates(records: readonly ReviewRecord[]): VideoEditReviewRecord[] {
  return records.map(record => isSceneRecord(record)
    ? { ...record, kind: 'effect', subjectType: 'video_edit.clip', motionEvidence: undefined } : record)
}

interface Snapshot { key: string; version: string; baseVersion: string; records: ReviewRecord[]; frames: number[]; warnings: string[]; sources: VideoEditMedia[] }
const snapshots = new WeakMap<VideoEditInstance, Map<string, Snapshot>>()
const logger = createLogger('features.videoEdit.review')
/** Recheck the file snapshots used by pixel review before observing its plan. */
export async function verifyVideoEditReviewObservationSources(owner: VideoEditInstance, version: string, sequenceId: string, signal: AbortSignal, assertCurrent: () => void): Promise<VideoEditMedia[]> {
  const marker = version.lastIndexOf('|review:')
  if (marker < 0) return []
  const snapshot = snapshots.get(owner)?.get(version.slice(marker + 8))
  if (!snapshot || snapshot.version !== version || snapshot.baseVersion !== videoEditObservationVersion(owner, owner.document.revision) || JSON.parse(snapshot.key)[0] !== sequenceId) throw new Error('检查计划已失效，请重新查询检查点后取帧。')
  await verifyVideoEditMotionSources(snapshot.sources, signal, assertCurrent)
  return snapshot.sources
}

export async function queryVideoEditReview(raw: unknown, context: Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId'>): Promise<Record<string, unknown>> {
  const input = queryVideoEditReviewCapability.inputSchema.parse(raw)
  const { projectId, childId } = splitVideoEditRef(input.sequenceRef)
  if (projectId !== input.documentRef.id || !childId) throw new Error('sequenceRef 必须属于 documentRef，请使用完整序列引用。')
  const owner = requireVideoEditInstance(projectId); const contentVersion = owner.contentVersion
  const version = videoEditObservationVersion(owner, owner.document.revision)
  const fontGeneration = codeTextFontGeneration()
  const assertCurrent = (): void => {
    context.signal.throwIfAborted()
    if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
    if (!isVideoEditContentCurrent(owner, contentVersion) || videoEditObservationVersion(owner, owner.document.revision) !== version) throw new Error('检查期间剪辑或跟踪结果已改变，请重新查询。')
    if (input.motion && codeTextFontGeneration() !== fontGeneration) throw new Error('检查期间字体已改变，请重新查询。')
  }
  logger.info('剪辑检查点查询开始', { event: 'video_edit.review.start', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId, from: input.from, to: input.to } })
  try {
    assertCurrent()
    const composition = videoEditComposition(owner.document, childId)
    const range = videoEditReviewRange(composition, input.from, input.to)
    const key = JSON.stringify([childId, version, input.from, input.to, input.threshold, input.maxFrames, input.motion, input.motion ? fontGeneration : null, input.scene])
    const saved = snapshots.get(owner) ?? new Map<string, Snapshot>(); snapshots.set(owner, saved)
    let id: string; let offset = 0; let snapshot: Snapshot
    if (input.cursor) {
      const parsed = /^([a-f0-9-]{36}):(\d+)$/.exec(input.cursor); const previous = parsed && saved.get(parsed[1])
      if (!parsed || !previous || previous.key !== key) throw new Error('检查分页已失效，请保持原条件重新查询。')
      id = parsed[1]; offset = Number(parsed[2]); snapshot = previous
      if (!Number.isSafeInteger(offset) || offset >= snapshot.records.length) throw new Error('检查分页位置无效，请重新查询。')
    } else {
      id = crypto.randomUUID()
      const structure = collectVideoEditReviewStructure(composition, range)
      const records: ReviewRecord[] = structure.records
      const { tracking } = structure
      const results = videoEditTrackResults(composition)
      let sources: VideoEditMedia[] = []
      const warnings = ['检查点是结构候选和优先抽样，不证明实际像素可见或其余时段无问题。', '跟踪区间来自原始采样；渲染可能插值或借用附近有效位置，跟丢不等于画面空白。']
      if (input.motion) {
        const programs: Record<string, CodeMaterialProgram> = {}
        await withVideoEditCodeMetadata(() => visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(_local, entry) {
          const code = entry.path.at(-1)!.clip.code
          if (code && !programs[code.versionId]) programs[code.versionId] = readVideoEditCodeProgram(owner, owner.document, code)
        } }))
        const video = input.motion.videoPixels ? await readVideoEditPixelMotion(owner, composition, range, context.signal, assertCurrent) : undefined
        const sound = await readVideoEditCodeMotionAudio(owner, composition, range, programs, context.signal, assertCurrent)
        sources = [...(video?.sources ?? []), ...sound.sources]
        const motion = await analyzeVideoEditMotionStructure({ composition, range, programs, audios: sound.audios, ...(video ? { pixels: video.pixels } : {}), policy: { minGapSeconds: input.motion.minGapSeconds, minimumStillSeconds: input.motion.minimumHoldSeconds } }, context.signal, async (document, frame) => {
          assertCurrent()
          let observation: CodeAuthorFrameObservation | undefined
          await trialVideoEditCodeFrames([{ document, frame }], context.signal, false, undefined, undefined, value => { observation = value })
          assertCurrent()
          if (!observation) throw new Error('渲染会话没有返回作者图层观察。')
          return observation
        })
        assertCurrent()
        // Picture checks on the same evidence: speed against the requested pace, and measured text layout for
        // native titles and captions (code element jitter/safe areas come from the worker's render observations).
        const measure = reviewTextMeasure()
        const pictureChecks = [...videoEditMotionSpeedFacts(motion.records, input.motion.pace, composition.fps), ...(measure ? collectVideoEditTextSafety(composition, range, measure) : [])]
        for (const record of [...motion.records, ...pictureChecks]) {
          assertVideoEditReviewBudget(records.length + 1)
          const code = record.basis === 'code_structure'
          const pixel = record.basis === 'video_pixels'
          const suggestion = record.detail ?? (pixel ? record.kind === 'pixel_unknown' ? '此区间的运动估计不足；请看连续画面，不能沿用邻近速度或据此判静止。'
            : record.kind === 'pixel_still' ? '这是原视频的采样静止候选；结合阅读停留和其他图层动作判断，不自动补动画。'
              : '观察原视频的运动、切换或局部变化是否符合创作意图；此证据不包含叠加效果和最终合成可见性。'
            : record.kind === 'motion_hard_stop' ? '观察运动结束前后连续帧；若非有意硬停，可调整原生曲线或代码动画的减速尾段。'
            : record.kind === 'motion_hold' ? '这是片段变换保持区间；结合阅读、留白及素材内部动作判断是否需要调整，不自动补动画。'
              : code ? '观察此代码元素的独立动作或内容变化是否服务当前信息；按创作意图调整原代码或元素覆盖。' : '观察这段原生变换是否服务当前信息；有意承载运动可保留，调整仍沿原片段属性与曲线。')
          records.push({ ...record, motionEvidence: { basis: record.basis ?? 'clip_transform', ...(record.elementPath ? { elementPath: [...record.elementPath] } : {}), ...(record.peakSpeed === undefined ? {} : { peakSpeed: record.peakSpeed }),
            ...(record.speedLimit === undefined ? {} : { speedLimit: record.speedLimit }), ...(record.jitterPixels === undefined ? {} : { jitterPixels: record.jitterPixels }),
            ...(record.safeArea ? { safeArea: { ...record.safeArea, edges: [...record.safeArea.edges] } } : {}),
            ...(record.input ? { input: { parameter: record.input.parameter, kind: record.input.kind, mediaRef: { kind: 'video_edit.media' as const, id: `${projectId}:${record.input.mediaId}` } } } : {}),
            suggestion: code && record.kind === 'motion_hold' ? '此元素自身结构保持；父组、输入视频或其他图层仍可能运动，请看图判断阅读停留。' : suggestion } })
        }
        warnings.push('原生速度以所在序列画面宽为单位；代码速度以作者画幅宽为单位，均为百分比/播放秒。代码元素仅计自身动作，父组不重复计入子元素；声音驱动复用正式混音和分析。变换保持不等于画面静止，视频、着色器和代码滤镜仍须观察；密集或硬停可属创作意图。', ...(motion.warnings ?? []))
        warnings.push(`画面检查：抖动按作者图层逐帧位姿判断（位移不小于1/256像素即像素会变），不含 draw 内部绘制与原视频；安全框与监视器安全框同一规则（标题90%、动作93%），只看停稳时刻，图形片段内文字未测量；速度上限为${VIDEO_EDIT_MOTION_PACE_LIMITS[input.motion.pace]}%画面宽/秒，不含原视频运动。均为复核依据，有意设计可保留。`)
        if (!measure) warnings.push('本次无法测量文字排版，原生文字与字幕的安全框未检查。')
        if (video) warnings.push('视频像素证据来自原片15fps低分辨率采样，速度以原片显示画幅宽度百分比/播放秒表示，已按当前放置时钟重算；并非精确PTS或最终合成，不排除采样间的短变化。代码视频输入及着色器内部仍须观察。')
        for (const event of videoEditCrowdedReviewEvents(records.filter((record): record is VideoEditReviewRecord => !isSceneRecord(record)), composition.fps, input.motion.minGapSeconds)) {
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
      if (input.scene) {
        const sceneRecords = await settleVideoEditCodeDeclarations(() => {
          // 在异步读录制页以前读齐声明，避免中途重试后重复 I/O。
          const read = videoEditCodeDeclarationReader(owner)
          visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(local, entry) {
            const code = entry.path.at(-1)!.clip.code
            if (code && videoEditCodeSceneKeys(code).length) read(code)
          } })
          return read
        })
        assertCurrent()
        records.push(...await collectVideoEditSceneReview(projectId, composition, range, input.scene, sceneRecords, context.signal, assertCurrent, records.length, warnings))
        warnings.push('片子数据检查只说明数据与窗口内容的对应关系；作者代码可能主动淡掉错位的框，不能据此断言观众看见了框。鼠标日志缺失或隐藏时不判跳动；proposal 是可选改法，修改前读声明，写后读回并重新复核。')
      }
      records.sort((a, b) => a.timeline.from - b.timeline.from || a.kind.localeCompare(b.kind) || a.subjectId.localeCompare(b.subjectId))
      snapshot = { key, baseVersion: version, version: sources.length ? `${version}|review:${id}` : version, records, warnings, sources, frames: selectVideoEditReviewFrames(frameCandidates(records), range, input.maxFrames, videoEditDuration(composition)) }
      assertCurrent()
      while (saved.size >= 4) saved.delete(saved.keys().next().value!)
      saved.set(id, snapshot)
    }
    const ref = (kind: string, id: string) => ({ kind, id: `${projectId}:${id}` })
    const page = snapshot.records.slice(offset, offset + input.limit)
    const prepared = await readVideoEditSceneReviewPage(page.filter(isSceneRecord), context.signal, assertCurrent)
    const records = page.map(original => {
      const record = isSceneRecord(original) ? { ...original, motionEvidence: prepared.get(original) ?? original.motionEvidence } : original
      return {
        kind: record.kind, timeline: { fromFrame: record.timeline.from, toFrame: record.timeline.to }, sequenceRef: ref('video_edit.sequence', record.sequenceId),
        subjectRef: isSceneRecord(record) ? { ...record.subjectRef } : ref(record.kind === 'event_crowded' ? 'video_edit.sequence' : record.kind.startsWith('tracking_') ? 'video_edit.tracker' : record.kind === 'caption' ? 'video_edit.caption' : record.kind === 'transition' ? 'video_edit.transition' : record.subjectType ?? 'video_edit.clip', record.subjectId),
        path: record.path.map(step => ({ sequenceRef: ref('video_edit.sequence', step.sequenceId), clipRef: ref('video_edit.clip', step.clipId) })),
        ...(record.confidence === undefined ? {} : { confidence: record.confidence }), ...(record.source ? { source: { ...record.source } } : {}),
        ...(record.motionEvidence ? { motionEvidence: { ...record.motionEvidence, ...(record.motionEvidence.elementPath ? { elementPath: [...record.motionEvidence.elementPath] } : {}), ...(record.motionEvidence.input ? { input: { ...record.motionEvidence.input, mediaRef: { ...record.motionEvidence.input.mediaRef } } } : {}) } } : {}),
      }
    })
    await verifyVideoEditMotionSources(snapshot.sources, context.signal, assertCurrent)
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
