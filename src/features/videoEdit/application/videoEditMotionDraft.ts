import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { motionDraftSchema, refKey, type MotionDraft, type MotionProperty, type MotionSample, type Pose, type Timeline, type ClockSegment } from '@/core/creativeIntent/contracts'
import { assertCandidateCurrent, motionCandidateIdentity, type MotionCandidate, type OptimizeMotionInput } from '@/core/creativeIntent/candidates'
import { type MotionIntent } from '@/core/creativeIntent/recipe'
import { MOTION_CANDIDATE_VERSION, type CreativeIntents, type StoredCreativeIntentResource, creativeIntentLiveResources } from '@/core/creativeIntent/persistence'
import { mergeMotionClipCurves, motionClipBase, motionClipGeometry, motionClipPose } from '@/core/videoEdit/motionDraft'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { assertVideoEditAnnotationTransition } from '@/core/videoEdit/annotations'
import { videoEditComposition, type VideoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { requireVideoEditInstance, getActiveVideoEditSequence, editVideoProject, updateVideoEditCreativeIntents, holdVideoEditActivity, saveVideoEdit, subscribeVideoEditView, setVideoEditPlaybackRate, registerVideoEditClosePreparation, videoEditBusyReason, switchVideoEditSequence, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { motionDigest, motionSamplePage, motionPageRef, readMotionPages, readMotionCandidate, readMotionResource, storeMotionResource } from './videoEditMotionResources'
import { optimizeVideoEditMotionOffThread } from './videoEditMotionWorkerClient'
import { captureVideoMotionReference, readVideoIntentAnnotation, sampleVideoMotionReference, videoMotionConstraintOptionsSchema, type VideoMotionConstraintOptions } from './videoEditIntentAnnotationAdapter'
import { reviewedMovementChanges, type IntentDifferencePlan } from '@/core/creativeIntent/intentPlan'
import { staggerMotion, hasStaggerMotion } from '@/core/creativeIntent/stagger'
import { classifyMotionCapture, superKeyframeSessionId } from '@/core/creativeIntent/captureIntent'

const logger = createLogger('features.videoEdit.motionDraft')
const PAGE_SAMPLE_BUDGET = 256
export function videoStaggerSource(owner: VideoEditInstance): VideoEditClip | undefined {
  const selected = getActiveVideoEditSequence(owner).clips.filter(clip => owner.selectedClipIds.includes(clip.id) && clip.kind !== 'audio' && clip.kind !== 'adjustment')
  if (selected.length < 2) return undefined
  return selected.find(clip => clip.id === owner.selection && hasStaggerMotion(clip)) ?? selected.find(hasStaggerMotion)
}

export function staggerVideoMotion(id: string, sequenceId: string, sourceId: string, targetIds: readonly string[], range: readonly [number, number], stepFrames = 4): string[] {
  logger.info('错峰复制开始', { event: 'video_edit.motion.stagger.start', context: { documentId: id, sourceId, targetCount: targetIds.length } })
  try {
    const owner = requireVideoEditInstance(id)
    const busy = videoEditBusyReason(id); if (busy) throw new Error(busy)
    const sequence = videoEditComposition(owner.document, sequenceId)
    const source = sequence.clips.find(clip => clip.id === sourceId)
    const targets = targetIds.map(targetId => { const target = sequence.clips.find(clip => clip.id === targetId); if (!target) throw new Error('目标片段已不存在。'); return target })
    if (!source || !targets.length) throw new Error('请选择源片段及要应用的片段。')
    assertVideoEditClipsEditable(sequence, [sourceId, ...targetIds])
    if ([source, ...targets].some(clip => clip.kind === 'audio' || clip.kind === 'adjustment' || clip.follow || clip.disabledIntrinsicSections?.includes('motion'))) throw new Error('请使用已启用运动且没有跟随的画面片段。')
    const changed = new Map(staggerMotion(source, targets, range, stepFrames).map(clip => [clip.id, clip]))
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, clips: value.clips.map(clip => changed.get(clip.id) ?? clip) } : value) }))
    logger.info('错峰复制完成', { event: 'video_edit.motion.stagger.completed', context: { documentId: id, targetCount: changed.size } })
    return [...changed.keys()]
  } catch (error) { logger.error('错峰复制失败', error, { event: 'video_edit.motion.stagger.failed', context: { documentId: id } }); throw error }
}
const OVERLAY_SAMPLE_BUDGET = 96
export type MotionCaptureMode = 'navigate' | 'demonstrate'
export type MotionCaptureProperty = Exclude<MotionProperty, 'pivot'>
export interface MotionPresentation { frame: number; revision: number; sequenceId: string; at: number; scrubbing?: boolean }
interface PresentedPose { timeline: Timeline; pose: Pose; monoUs: number; clockId: string }
export interface VideoMotionState {
  owner: VideoEditInstance; draft: MotionDraft; automatic?: boolean; activeTargetId?: string; status: 'recording' | 'paused' | 'reviewing' | 'optimizing';
  mode: MotionCaptureMode; property: MotionCaptureProperty; speed: 1 | 0.5 | 0.25; capture: 'place' | 'record';
  pose: Pose; presentation?: MotionPresentation; preview: 'original' | string; candidates: MotionCandidate[];
  recent: MotionSample[]; pending: MotionSample[]; pinnedSamples?: MotionSample[]; selectedTakeIds?: string[]; intent?: MotionIntent;
  message?: string; generationMs?: number; inputLatencies: number[];
  original?: MotionCandidate; originalRef?: StoredCreativeIntentResource; endpoints?: [MotionSample, MotionSample]; appliedBaseDigest?: string
  takeTargets?: Record<string, string>
  constraints?: VideoMotionConstraintOptions
  reviewRequest?: number
}
interface CaptureRuntime { startedAt: number; seq: number; visit: number; gestureStarted?: boolean; gestureOrigin?: PresentedPose; lastFrame?: number; lastDirection: number; takeId?: string; pointerActive: boolean; inputAt?: number; pendingEvent?: MotionSample['event']; pendingPresentation?: Promise<void>; presented?: () => void; pausedAt?: number; clockId?: string; flushTimer?: ReturnType<typeof setTimeout>; write?: Promise<void>; persist?: Promise<void>; controller?: AbortController; preferredCandidateId?: string; release: () => void; unsubscribe: () => void; previewRevision: number; inputRevision: number; cached?: { base: VideoEditComposition; revision: number; composition: VideoEditComposition } }
const states = new WeakMap<VideoEditInstance, VideoMotionState>()
const runtimes = new WeakMap<VideoEditInstance, CaptureRuntime>()
const listeners = new Set<() => void>(); let revision = 0
export function subscribeVideoMotion(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoMotionRevision(): number { return revision }
export function videoMotionState(owner: VideoEditInstance): VideoMotionState | undefined { return states.get(owner) }
export function videoMotionOrigin(owner: VideoEditInstance): number | undefined { return runtimes.get(owner)?.startedAt }
/** Public metadata CRUD must invalidate the same document-owned preview/capture cache. */
export function syncVideoMotionMetadata(owner: VideoEditInstance): void {
  const state = states.get(owner), runtime = runtimes.get(owner)
  if (!state || !runtime) return
  if (state.status !== 'reviewing') throw new Error('请先结束当前示范或整理，再修改原稿集合。')
  const draft = head(owner).drafts.find(value => value.id === state.draft.id)
  if (!draft) {
    runtime.controller?.abort(); runtime.release(); runtime.unsubscribe()
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer)
    states.delete(owner); runtimes.delete(owner); owner.motionRecording = false
    revision++; listeners.forEach(listener => listener()); return
  }
  const candidatesChanged = JSON.stringify(state.draft.candidateRefs) !== JSON.stringify(draft.candidateRefs)
  state.draft = structuredClone(draft)
  const retained = new Set(draft.takes.map(take => take.id))
  state.recent = state.recent.filter(sample => retained.has(sample.takeRef))
  state.pinnedSamples = state.pinnedSamples?.filter(sample => retained.has(sample.takeRef))
  state.endpoints = state.recent.length ? [state.recent[0], state.recent.at(-1)!] : undefined
  state.selectedTakeIds = head(owner).motionOptions?.find(options => options.draftId === draft.id)?.selectedTakeIds
  if (candidatesChanged) { runtime.controller?.abort(); runtime.inputRevision++; state.candidates = []; state.original = undefined; state.preview = 'original' }
  publish(state)
}
function publish(state: VideoMotionState, preview = true): void {
  if (preview) runtimes.get(state.owner)!.previewRevision++
  revision++; for (const listener of listeners) listener()
}
function head(owner: VideoEditInstance): CreativeIntents { return owner.document.creativeIntents ?? { drafts: [], sessions: [], resources: [] } }
function activeTarget(state: VideoMotionState): MotionDraft['targets'][number] {
  return state.draft.targets.find(target => target.ref.id === state.activeTargetId) ?? state.draft.targets[0]
}
function targetClip(state: VideoMotionState): VideoEditClip {
  const id = activeTarget(state).ref.id
  const clip = state.owner.document.sequences.flatMap(s => s.clips).find(c => `${state.owner.document.id}:${c.id}` === id)
  if (!clip) throw new Error('原片段已移除，请选择片段重新示范。')
  return clip
}
function owningSequence(state: VideoMotionState): VideoEditComposition {
  const clip = targetClip(state)
  const sequence = state.owner.document.sequences.find(s => s.clips.some(c => c.id === clip.id))!
  if (sequence.id !== state.owner.activeSequenceId || state.owner.selection !== clip.id) throw new Error('选中的片段或序列已改变，请回到原片段继续。')
  assertVideoEditClipsEditable(sequence, [clip.id])
  return videoEditComposition(state.owner.document, sequence.id)
}
function timeline(state: VideoMotionState): Timeline | null {
  const evidence = state.presentation
  const seq = owningSequence(state); const clip = targetClip(state)
  if (!evidence || evidence.sequenceId !== seq.id || evidence.frame < clip.start || evidence.frame >= clip.start + clip.duration) return null
  const runtime = runtimes.get(state.owner)!
  return { sequenceRef: { kind: 'video_edit.sequence', id: `${state.owner.document.id}:${seq.id}` }, frame: evidence.frame, fps: seq.frameRate, visitRef: `${state.owner.document.id}:${seq.id}/${runtime.visit}` }
}
function mono(state: VideoMotionState): number { return Math.max(0, Math.round((performance.now() - runtimes.get(state.owner)!.startedAt) * 1000)) }
/** 开始、暂停和轨迹折返划分连续段；所有段落仍属于同一个原稿。 */
function beginAutomaticTake(state: VideoMotionState, at = mono(state)): void {
  if (!state.automatic) return
  const runtime = runtimes.get(state.owner)!
  runtime.takeId = crypto.randomUUID()
  state.draft.takes.push({ id: runtime.takeId, intent: 'demonstrate', pathDemonstration: false, placement: true, monoSpanUs: [at, at], direction: 0, visitRef: null, timelineRange: [state.owner.frame, state.owner.frame], samplePages: [], geometryDigest: activeTarget(state).geometryDigest })
}
function endAutomaticTake(state: VideoMotionState): void {
  const take = state.draft.takes.find(value => value.id === runtimes.get(state.owner)?.takeId)
  if (state.automatic && take) take.monoSpanUs[1] = Math.max(take.monoSpanUs[1], mono(state))
}
function invalidate(state: VideoMotionState): void { const runtime = runtimes.get(state.owner); if (runtime) { runtime.controller?.abort(); runtime.inputRevision++ } state.candidates = []; state.original = undefined; state.originalRef = undefined; state.draft.candidateRefs = []; delete state.draft.selectedCandidateRef; state.preview = 'original' }
async function persistHead(state: VideoMotionState, resources: StoredCreativeIntentResource[] = [], sourceChanged = true): Promise<void> {
  const runtime = runtimes.get(state.owner)!
  const operation = async (): Promise<void> => {
    const draft = structuredClone(state.draft)
    // 选择候选、登记回执不改变原稿；不能因反序列化后的字段顺序重算其身份。
    if (sourceChanged) draft.sourceDigest = await motionDigest({ ...draft, sourceDigest: undefined, candidateRefs: [], selectedCandidateRef: undefined, applications: [] })
    state.draft.sourceDigest = draft.sourceDigest
    const current = head(state.owner)
    const drafts = [...current.drafts.filter(d => d.id !== draft.id), draft]
    const motionOptions = [...(current.motionOptions ?? []).filter(o => o.draftId !== draft.id), { draftId: draft.id, intent: state.intent, selectedTakeIds: state.selectedTakeIds, appliedBaseDigest: state.appliedBaseDigest, originalRef: state.originalRef ? { resourceId: state.originalRef.resourceId, digest: state.originalRef.digest, bytes: state.originalRef.bytes } : undefined }]
    updateVideoEditCreativeIntents(state.owner.document.id, { ...current, drafts, motionOptions, resources: [...current.resources, ...resources] })
  }
  const pending = (runtime.persist ?? Promise.resolve()).then(operation)
  runtime.persist = pending.catch(() => {})
  await pending
}
async function discardUnpublishedResources(state: VideoMotionState, resources: StoredCreativeIntentResource[]): Promise<void> {
  const live = new Set(head(state.owner).resources.map(resource => resource.resourceId))
  for (const resource of resources) if (!live.has(resource.resourceId)) {
    try { await getPlatform().system.fs.remove(resource.path) }
    catch (error) { logger.warn('清理未发布原稿资源失败', { event: 'video_edit.motion.resource_cleanup.failed', error, context: { documentId: state.owner.document.id } }) }
  }
}
export async function startVideoMotion(id: string, capture?: 'place' | 'record'): Promise<void> {
  const automatic = capture === undefined
  capture ??= 'record'
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(id)
  const busy = videoEditBusyReason(id); if (busy) throw new Error(busy)
  if (states.get(owner)?.draft.applications.some(application => !application.saved)) throw new Error('动作已应用，请先重试保存，再开始新的示范。')
  if (['recording', 'paused', 'optimizing'].includes(states.get(owner)?.status ?? '')) throw new Error('请先结束当前示范或整理。')
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips.find(c => c.id === owner.selection)
  if (!clip || clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('请先选中一个画面片段。')
  assertVideoEditClipsEditable(sequence, [clip.id])
  if (clip.follow || clip.disabledIntrinsicSections?.includes('motion')) throw new Error('请先解除运动跟随或启用运动，再示范片段。')
  const baseDigest = await motionDigest(motionClipBase(clip)); const geometryDigest = await motionDigest(motionClipGeometry(sequence, clip))
  if (getActiveVideoEditSequence(owner) !== sequence || owner.selection !== clip.id) throw new Error('选中的片段已改变，请重新开始示范。')
  const pose = motionClipPose(clip, owner.frame)
  const previousState = states.get(owner)
  let continued = automatic && previousState?.automatic && !previousState.draft.applications.length ? previousState : undefined
  if (continued && head(owner).sessions.find(session => session.id === superKeyframeSessionId(continued!.draft.id))?.retentionStatus === 'deleted') continued = undefined
  if (continued) for (const target of continued.draft.targets) {
    const current = owner.document.sequences.flatMap(value => value.clips).find(value => `${id}:${value.id}` === target.ref.id)
    // AI 经通用属性应用后，作品基态变化；下一次录制建立新组，旧证据仍可读回。
    if (!current || await motionDigest(motionClipBase(current)) !== target.baseDigest) { continued = undefined; break }
  }
  if (getActiveVideoEditSequence(owner) !== sequence || owner.selection !== clip.id) throw new Error('选中的片段已改变，请重新开始录制。')
  const draft = continued ? structuredClone(continued.draft) : motionDraftSchema.parse({ id: crypto.randomUUID(), version: 1, ownerRef: { kind: 'document.video_edit', id }, mode: 'animated', label: '超级关键帧原稿', fidelity: .5,
    sourceDigest: baseDigest, targets: [{ ref: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, ownerRef: { kind: 'document.video_edit', id }, editable: [], basePose: pose, baseDigest, geometryDigest, compositionSize: [sequence.width, sequence.height] }],
    clockSegments: [], takes: [], pins: [], constraints: [], recipeRefs: [], candidateRefs: [], applications: [] })
  const targetId = `${id}:${clip.id}`
  if (!draft.targets.some(target => target.ref.id === targetId)) draft.targets.push({ ref: { kind: 'video_edit.clip', id: targetId }, ownerRef: draft.ownerRef, editable: [], basePose: pose, baseDigest, geometryDigest, compositionSize: [sequence.width, sequence.height] })
  const previous = runtimes.get(owner); previous?.controller?.abort(); previous?.release(); previous?.unsubscribe()
  const state: VideoMotionState = { owner, draft, automatic, activeTargetId: targetId, status: 'recording', capture, mode: 'navigate', property: 'position', speed: 1, pose, preview: 'original', candidates: [], recent: [], pending: [], inputLatencies: [] }
  const runtime: CaptureRuntime = { startedAt: continued && previous ? previous.startedAt : performance.now(), seq: continued && previous ? previous.seq : 0, visit: continued && previous ? previous.visit + 1 : 0, lastDirection: 0, pointerActive: false, release: holdVideoEditActivity(id, '动作示范'), unsubscribe: () => {}, previewRevision: 0, inputRevision: 0 }
  states.set(owner, state); runtimes.set(owner, runtime); owner.motionRecording = true; owner.playbackRate = 1
  beginAutomaticTake(state)
  const unregisterClose = registerVideoEditClosePreparation(owner, () => stopVideoMotion(id))
  const release = runtime.release
  runtime.release = () => { release(); unregisterClose() }
  runtime.unsubscribe = subscribeVideoEditView(() => {
    if (state.status !== 'recording' && state.status !== 'paused') return
    try { owningSequence(state) } catch (error) { pauseVideoMotion(id); state.message = error instanceof Error ? error.message : '示范已暂停。'; publish(state, false) }
  })
  invalidate(state)
  await persistHead(state); publish(state)
  logger.info('动作示范开始', { event: 'video_edit.motion.start', context: { documentId: id, capture } })
}
/** Reviewed positions are authored poses, not a replay of recorded editing commands. */
export async function proposeVideoExplanationMotion(id: string, plans: readonly IntentDifferencePlan[], frames: [number, number]): Promise<void> {
  const changes = reviewedMovementChanges(plans), owner = requireVideoEditInstance(id), sequence = getActiveVideoEditSequence(owner)
  // The existing motion editor reviews one selected element at a time.
  if (changes.length !== 1) throw new Error('请分别审阅每个对象的移动候选')
  const change = changes[0], clip = sequence.clips.find(c => change.targetRef.kind === 'video_edit.clip' && change.targetRef.id === `${id}:${c.id}`)
  if (!clip || owner.playing || change.expectedDigest !== await motionDigest([sequence, owner.frame]) || getActiveVideoEditSequence(owner) !== sequence) throw new Error('当前画面已变化，请重新审阅讲解')
  if (!frames.every(frame => Number.isSafeInteger(frame) && frame >= clip.start && frame < clip.start + clip.duration)) throw new Error('移动位置不在该片段的时间范围内')
  setVideoEditView(id, { selection: clip.id, playing: false })
  await startVideoMotion(id, 'place')
  const state = states.get(owner)!, runtime = runtimes.get(owner)!, take = crypto.randomUUID(), clock = crypto.randomUUID(), visit = `review:${take}`
  const range: [number, number] = [...frames]
  const timelineAt = (frame: number): Timeline => ({ sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, frame, fps: sequence.frameRate, visitRef: visit })
  const poses: MotionSample[] = [...new Set(range)].map((frame, index) => ({ seq: index, monoUs: index, timeline: timelineAt(frame), clockSegmentRef: clock, sampleId: `${take}:${index}`, takeRef: take, targetRef: change.targetRef,
    pose: { ...motionClipPose(clip, frame), position: frame === range[1] ? change.after as [number, number] : change.before as [number, number] }, gestureKind: 'place', quality: 'presented', confirmed: true, event: 'up' }))
  state.draft.label = '讲解移动'; activeTarget(state).editable = ['position']; state.draft.fidelity = 1
  state.draft.clockSegments = [{ id: clock, monoSpanUs: [0, Math.max(1, poses.length - 1)], mode: range[0] === range[1] ? 'hold' : 'scrub', start: timelineAt(range[0]), end: timelineAt(range[1]), anchors: [] }]
  state.draft.takes = [{ id: take, intent: 'demonstrate', pathDemonstration: false, placement: true, monoSpanUs: [0, Math.max(1, poses.length - 1)], direction: Math.sign(range[1] - range[0]) as -1 | 0 | 1, visitRef: visit, timelineRange: range, samplePages: [], geometryDigest: activeTarget(state).geometryDigest }]
  state.pending = poses; state.recent = poses; state.endpoints = [poses[0], poses.at(-1)!]; state.status = 'reviewing'
  owner.motionRecording = false; runtime.release(); runtime.unsubscribe()
  await flushVideoMotion(state); await optimizeVideoMotion(id)
  state.reviewRequest = (state.reviewRequest ?? 0) + 1; publish(state)
}
export function recordVideoMotionPresentation(owner: VideoEditInstance, evidence: MotionPresentation): void {
  const state = states.get(owner); const runtime = runtimes.get(owner)
  if (!state || !runtime) return
  if (state.status === 'recording' && evidence.revision !== videoMotionComposition(owner)?.revision) return
  state.presentation = evidence
  if (state.status === 'recording') { const composition = videoMotionComposition(owner); const clip = composition?.clips.find(c => `${owner.document.id}:${c.id}` === activeTarget(state).ref.id); if (clip) state.pose = motionClipPose(clip, evidence.frame) }
  if (runtime.inputAt !== undefined) {
    const latency = Math.max(0, evidence.at - runtime.inputAt); state.inputLatencies.push(latency)
    if (state.inputLatencies.length > 2048) state.inputLatencies.shift()
    performance.measure('video-motion-input-present', { start: runtime.inputAt, end: evidence.at, detail: { frame: evidence.frame, documentId: owner.document.id } }); runtime.inputAt = undefined
  }
  if (state.status !== 'recording') return
  captureClock(state)
  if (runtime.pendingEvent || runtime.pointerActive && runtime.gestureStarted || !state.automatic && state.mode === 'demonstrate' && state.capture === 'record' && state.draft.takes.length > 0) {
    capturePose(state, runtime.pendingEvent ?? 'sample'); runtime.pendingEvent = undefined; runtime.presented?.(); runtime.pendingPresentation = undefined; runtime.presented = undefined
  }
}
function captureClock(state: VideoMotionState): void {
  const runtime = runtimes.get(state.owner)!; const t = timeline(state); if (!t) return
  const at = Math.max(mono(state), state.draft.clockSegments.at(-1)?.monoSpanUs[1] ?? 0)
  let previous = state.draft.clockSegments.at(-1)
  const direction = previous?.end ? Math.sign(t.frame - previous.end.frame) : 0
  const scrubbing = state.presentation?.scrubbing ?? state.owner.scrubbing
  const seek = Boolean(previous?.end && !state.owner.playing && !scrubbing && direction)
  const previousDirection = state.automatic ? state.draft.takes.find(take => take.id === runtime.takeId)?.direction ?? 0 : runtime.lastDirection
  const reverse = Boolean(direction && previousDirection && direction !== previousDirection)
  const currentTake = state.draft.takes.find(take => take.id === runtime.takeId)
  const becomesTrajectory = (state.owner.playing || scrubbing) && (runtime.pointerActive || Boolean(runtime.pendingEvent))
  const firstSampleAt = currentTake ? Math.min(...currentTake.samplePages.map(page => page.monoSpanUs[0]), ...state.pending.filter(sample => sample.takeRef === currentTake.id).map(sample => sample.monoUs)) : Infinity
  const crossedSeek = state.draft.clockSegments.some(clock => clock.mode === 'seek' && clock.monoSpanUs[0] > firstSampleAt)
  // 不把定位跳转或折返硬拼成单调轨迹；保留全部原始段与墙钟，算法无需补造路径。
  if (state.automatic && currentTake && (reverse || seek && !currentTake.placement || becomesTrajectory && currentTake.placement && crossedSeek)) {
    currentTake.monoSpanUs[1] = at
    beginAutomaticTake(state, at)
  }
  if (seek || reverse) {
    runtime.visit++; t.visitRef = `${t.sequenceRef.id}/${runtime.visit}`
    if (!state.automatic && (state.capture === 'record' || reverse)) runtime.takeId = undefined
    state.draft.clockSegments.push({ id: crypto.randomUUID(), mode: 'seek', monoSpanUs: [at, at], start: previous!.end, end: t, anchors: [] }); previous = undefined
  }
  const mode = state.owner.playing ? 'play' : scrubbing && direction ? 'scrub' : 'hold'
  const anchor = { monoUs: at, presentedFrame: t.frame, requestedFrame: state.owner.frame, sequenceRef: t.sequenceRef, visitRef: t.visitRef, playbackDirection: state.owner.playing ? state.owner.playbackDirection : 0 as const, playbackRate: state.speed, playing: state.owner.playing, epoch: runtime.visit, uncertaintyUs: 0 }
  if (previous?.mode === mode && previous.start?.visitRef === t.visitRef && (mode !== 'hold' || previous.start.frame === t.frame) && previous.anchors.at(-1)?.playbackRate === state.speed) {
    previous.end = t; previous.monoSpanUs[1] = at + 1; previous.anchors = [previous.anchors[0], anchor]
    runtime.clockId = previous.id
  } else {
    const segment: ClockSegment = { id: crypto.randomUUID(), mode, monoSpanUs: [at, at + 1], start: t, end: t, anchors: [anchor] }
    state.draft.clockSegments.push(segment); runtime.clockId = segment.id
  }
  if (direction) runtime.lastDirection = direction
  if (!state.automatic && direction && state.mode === 'navigate' && state.capture === 'record' && !runtime.pointerActive) runtime.takeId = undefined
}
function capturePose(state: VideoMotionState, event: MotionSample['event'], inputAt?: number, anchor?: PresentedPose): void {
  const runtime = runtimes.get(state.owner)!; const clock = state.draft.clockSegments.find(s => s.id === (anchor?.clockId ?? runtime.clockId)); const at = anchor?.monoUs ?? clock?.anchors.at(-1)?.monoUs ?? mono(state); const t = anchor?.timeline ?? timeline(state)
  if (!t) { state.message = '请等待片段画面显示后继续示范。'; publish(state, false); return }
  runtime.lastFrame = t.frame
  if (!runtime.takeId) {
    runtime.takeId = crypto.randomUUID()
    state.draft.takes.push({ id: runtime.takeId, intent: 'demonstrate', pathDemonstration: false, ...(state.capture === 'place' || state.automatic && !state.owner.playing && !state.owner.scrubbing ? { placement: true as const } : {}), monoSpanUs: [at, at], direction: 0, visitRef: t.visitRef, timelineRange: [t.frame, t.frame], samplePages: [], geometryDigest: activeTarget(state).geometryDigest })
  }
  const take = state.draft.takes.find(v => v.id === runtime.takeId)!
  if (state.automatic && !take.samplePages.length && !state.pending.some(sample => sample.takeRef === take.id)) {
    take.timelineRange = [t.frame, t.frame]; take.direction = 0
  }
  if (take.visitRef === null) take.visitRef = t.visitRef
  if (take.direction === 0 && take.timelineRange![0] !== t.frame) take.direction = Math.sign(t.frame - take.timelineRange![0]) as -1 | 1
  take.monoSpanUs[1] = at; take.timelineRange![1] = t.frame
  const captureKind = classifyMotionCapture(true, state.owner.playing, !!state.owner.scrubbing, Boolean(runtime.pointerActive && runtime.gestureOrigin && runtime.gestureOrigin.timeline.frame !== t.frame))
  if (state.automatic && captureKind === 'trajectory') delete take.placement
  if (!clock) return
  const sample: MotionSample = { sampleId: crypto.randomUUID(), seq: runtime.seq++, monoUs: at, timeline: t, clockSegmentRef: clock.id, takeRef: take.id, targetRef: activeTarget(state).ref, pose: structuredClone(anchor?.pose ?? state.pose), quality: 'presented', confirmed: true, gestureKind: state.property === 'position' ? 'move' : state.property === 'rotationTurns' ? 'rotate' : 'scale', event }
  if (!state.automatic && !activeTarget(state).editable.includes(state.property)) activeTarget(state).editable.push(state.property)
  state.pending.push(sample); state.recent.push(sample); state.endpoints = [state.endpoints?.[0] ?? sample, sample]
  if (state.recent.length > OVERLAY_SAMPLE_BUDGET) state.recent.shift()
  if (inputAt !== undefined) runtime.inputAt = inputAt
  invalidate(state)
  if (state.pending.length >= PAGE_SAMPLE_BUDGET) {
    if (runtime.write) { pauseVideoMotion(state.owner.document.id); state.message = '原稿正在保存，已暂停采集；保存完成后可继续。' }
    else void flushVideoMotion(state).catch(error => { state.status = 'paused'; state.message = error instanceof Error ? error.message : '原稿保存失败，请重试。'; publish(state) })
  }
  else if (!runtime.flushTimer) runtime.flushTimer = setTimeout(() => { runtime.flushTimer = undefined; void flushVideoMotion(state).catch(error => { state.status = 'paused'; state.message = error instanceof Error ? error.message : '原稿保存失败，请重试。'; publish(state) }) }, 400)
  publish(state, inputAt !== undefined)
}
export function demonstrateVideoMotion(id: string, pose: Pose, event: MotionSample['event'] = 'sample', inputAt?: number): void {
  const state = states.get(requireVideoEditInstance(id)); if (!state || state.status !== 'recording') return
  owningSequence(state)
  const runtime = runtimes.get(state.owner)!
  if (!runtime.gestureStarted && runtime.gestureOrigin) {
    const origin = runtime.gestureOrigin; const current = timeline(state)
    if (origin.timeline.visitRef === current?.visitRef && origin.monoUs > (state.recent.at(-1)?.monoUs ?? -1)) {
      capturePose(state, 'down', undefined, origin)
      if (current.frame !== origin.timeline.frame) capturePose(state, 'dwell-end')
    }
  }
  if (state.automatic) {
    for (const property of ['position', 'rotationTurns', 'scaleXY'] as const) if (JSON.stringify(state.pose[property]) !== JSON.stringify(pose[property]) && !activeTarget(state).editable.includes(property)) activeTarget(state).editable.push(property)
  }
  runtime.gestureStarted = true; state.pose = structuredClone(pose); runtime.pendingEvent = event; runtime.inputAt = inputAt
  if (!runtime.pendingPresentation) runtime.pendingPresentation = new Promise(resolve => { runtime.presented = resolve })
  invalidate(state); publish(state)
}
export function setVideoMotionPointer(id: string, active: boolean): void {
  const owner = requireVideoEditInstance(id); const runtime = runtimes.get(owner); const state = states.get(owner); if (!runtime || !state) return
  runtime.pointerActive = active
  if (active) {
    runtime.gestureStarted = false; const t = timeline(state); const clock = state.draft.clockSegments.at(-1)
    const anchor = clock?.anchors.at(-1)
    runtime.gestureOrigin = t && clock && anchor && state.presentation ? { timeline: t, pose: structuredClone(state.pose), monoUs: anchor.monoUs, clockId: clock.id } : undefined
  } else runtime.gestureOrigin = undefined
  publish(state)
}
export function setVideoMotionOptions(id: string, values: Partial<Pick<VideoMotionState, 'mode' | 'property' | 'speed' | 'capture'>>): void {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  Object.assign(state, values); setVideoEditPlaybackRate(id, state.status === 'recording' || state.status === 'paused' ? state.speed : 1); publish(state)
}
export async function flushVideoMotion(state: VideoMotionState): Promise<void> {
  const runtime = runtimes.get(state.owner)!
  if (runtime.flushTimer) { clearTimeout(runtime.flushTimer); runtime.flushTimer = undefined }
  if (runtime.write) { await runtime.write; if (state.pending.length) return flushVideoMotion(state); return }
  if (!state.pending.length) { await persistHead(state); return }
  const entries = state.pending.splice(0, PAGE_SAMPLE_BUDGET); const draft = structuredClone(state.draft)
  const write = async (): Promise<void> => {
    const resources: StoredCreativeIntentResource[] = []; const refs: { takeId: string; ref: ReturnType<typeof motionPageRef> }[] = []
    try {
      for (const take of draft.takes) {
        const samples = entries.filter(s => s.takeRef === take.id); if (!samples.length) continue
        const page = motionSamplePage(draft, samples); const resource = await storeMotionResource(state.owner.document.id, page, 'page'); resources.push(resource)
        refs.push({ takeId: take.id, ref: motionPageRef(resource, page) })
      }
      for (const entry of refs) state.draft.takes.find(t => t.id === entry.takeId)!.samplePages.push(entry.ref)
      await persistHead(state, resources)
    } catch (error) {
      for (const entry of refs) { const take = state.draft.takes.find(t => t.id === entry.takeId); if (take) take.samplePages = take.samplePages.filter(r => r.resourceId !== entry.ref.resourceId) }
      state.pending.unshift(...entries); pauseVideoMotion(state.owner.document.id)
      await discardUnpublishedResources(state, resources)
      logger.warn('动作原稿保存失败', { event: 'video_edit.motion.save.failed', error, context: { documentId: state.owner.document.id } }); throw error
    }
  }
  runtime.write = write()
  try { await runtime.write } finally { runtime.write = undefined }
  if (state.status !== 'recording' && state.pending.length) await flushVideoMotion(state)
}
export async function stopVideoMotion(id: string): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  const runtime = runtimes.get(state.owner)!
  if (runtime.pendingPresentation) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([runtime.pendingPresentation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('最新姿态尚未显示，请等待画面恢复后再结束示范。')), 10000) })]) } finally { if (timer) clearTimeout(timer) }
  }
  state.status = 'reviewing'; setVideoEditPlaybackRate(id, 1)
  endAutomaticTake(state)
  runtime.pointerActive = false
  try { await flushVideoMotion(state); await saveVideoEdit(id) }
  catch (error) { state.status = 'paused'; state.message = '原稿已保留，保存尚未完成；恢复写入后请再次结束示范。'; publish(state); throw error }
  state.owner.motionRecording = false; runtime.release(); runtime.unsubscribe(); state.message = undefined; publish(state)
  logger.info('动作示范结束', { event: 'video_edit.motion.capture.completed', context: { documentId: id } })
  const latencies = [...state.inputLatencies].sort((a, b) => a - b)
  logger.info('动作输入呈现延迟', { event: 'video_edit.motion.input_latency', context: { documentId: id, count: latencies.length, p95Ms: latencies[Math.floor((latencies.length - 1) * .95)] ?? null, window: 'latest-2048-render-acknowledgements' } })
}
export function pauseVideoMotion(id: string): void {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  if (state.status !== 'recording') return
  endAutomaticTake(state)
  state.status = 'paused'; const runtime = runtimes.get(state.owner)!; runtime.pointerActive = false; runtime.pendingEvent = undefined; runtime.inputAt = undefined; runtime.presented?.(); runtime.pendingPresentation = undefined; runtime.presented = undefined
  // 暂停边界取封存后的墙钟，不能回退到上一次画面呈现时间。
  runtime.pausedAt = Math.max(mono(state), state.draft.clockSegments.at(-1)?.monoSpanUs[1] ?? 0); publish(state)
  if (state.automatic) runtime.takeId = undefined
}
export function resumeVideoMotion(id: string): void {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  if (state.status !== 'paused') throw new Error('只有暂停的示范可以继续。')
  owningSequence(state); state.status = 'recording'; state.message = undefined; state.owner.motionRecording = true
  setVideoEditPlaybackRate(id, state.speed)
  const runtime = runtimes.get(state.owner)!; const at = mono(state)
  if (runtime.pausedAt !== undefined && at > runtime.pausedAt) state.draft.clockSegments.push({ id: crypto.randomUUID(), monoSpanUs: [runtime.pausedAt, at], mode: 'gap', start: null, end: null, anchors: [] })
  runtime.pausedAt = undefined; runtime.takeId = undefined; beginAutomaticTake(state); publish(state)
}
export async function reopenVideoMotion(id: string, draftId: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const draft = head(owner).drafts.find(d => d.id === draftId)
  if (!draft) throw new Error('原稿不存在。')
  if (['recording', 'paused', 'optimizing'].includes(states.get(owner)?.status ?? '')) throw new Error('请先结束当前示范或整理，再打开原稿。')
  const contentVersion = owner.contentVersion
  const readInput = (): string => {
    const current = head(owner); const original = current.drafts.find(value => value.id === draftId); const settings = current.motionOptions?.find(value => value.draftId === draftId)
    return JSON.stringify([original, settings, creativeIntentLiveResources([{ ...current, drafts: original ? [original] : [], sessions: [], motionOptions: settings ? [settings] : [] }])])
  }
  const expectedInput = readInput()
  const options = head(owner).motionOptions?.find(o => o.draftId === draftId)
  const target = draft.targets.find(value => value.ref.id === `${id}:${owner.selection}`) ?? draft.targets[0]
  const state: VideoMotionState = { owner, draft: structuredClone(draft), automatic: head(owner).sessions.some(session => session.id === superKeyframeSessionId(draftId)), activeTargetId: target.ref.id, status: 'reviewing', mode: 'navigate', property: 'position', speed: 1, capture: 'place', pose: target.basePose, preview: 'original', candidates: [], recent: [], pending: [], inputLatencies: [], intent: options?.intent, selectedTakeIds: options?.selectedTakeIds, appliedBaseDigest: options?.appliedBaseDigest }
  state.pinnedSamples = []
  for (const ref of draft.recipeRefs) {
    const resource = head(owner).resources.find(r => r.resourceId === ref.resourceId)
    if (!resource || resource.kind !== 'recipe') throw new Error('动作约束资源缺失，请恢复原稿')
    state.constraints = videoMotionConstraintOptionsSchema.parse(await readMotionResource(resource))
  }
  const pins = new Set(draft.pins.map(pin => pin.sampleId))
  for await (const page of readMotionPages(id, draft)) if (page.kind === 'samples') {
    state.recent = [...state.recent, ...page.entries].slice(-OVERLAY_SAMPLE_BUDGET); state.endpoints = [state.endpoints?.[0] ?? page.entries[0], page.entries.at(-1)!]
    state.pinnedSamples.push(...page.entries.filter(sample => pins.has(sample.sampleId)))
  }
  for (const ref of draft.candidateRefs) { const resource = head(owner).resources.find(r => r.resourceId === ref.resourceId)!; const candidate = await readMotionCandidate(resource); state.candidates.push(candidate); if (ref.resourceId === draft.selectedCandidateRef) state.preview = candidate.id }
  if (options?.originalRef) { state.originalRef = head(owner).resources.find(r => r.resourceId === options.originalRef!.resourceId)!; state.original = await readMotionCandidate(state.originalRef) }
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原稿所在文档已改变，请重新打开原稿。')
  // 只核对本原稿的读取输入；其他任务的元数据更新不使其失效，移除原稿或资源则必须拒绝。
  if (readInput() !== expectedInput) throw new Error('原稿数据已改变，请重新打开原稿。')
  const clip = targetClip(state); const sequence = owner.document.sequences.find(s => s.clips.some(c => c.id === clip.id))!
  switchVideoEditSequence(id, sequence.id); setVideoEditView(id, { selection: clip.id, frame: state.endpoints?.[0]?.timeline?.frame ?? clip.start, playing: false })
  try {
    const input = await inputFor(state)
    for (const candidate of state.candidates) assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, input))
    if (state.original) assertCandidateCurrent(state.original, motionCandidateIdentity({ ...state.draft, fidelity: 1 }, { ...input, intent: undefined, beatFrames: undefined }))
  } catch (error) { state.candidates = []; state.original = undefined; state.preview = 'base'; state.message = error instanceof Error ? error.message : '原稿已保留，请重新示范。' }
  const previous = runtimes.get(owner); previous?.controller?.abort(); previous?.release(); previous?.unsubscribe()
  const elapsedUs = Math.max(0, ...draft.clockSegments.map(clock => clock.monoSpanUs[1]), ...draft.takes.map(take => take.monoSpanUs[1]))
  states.set(owner, state); runtimes.set(owner, { startedAt: performance.now() - elapsedUs / 1000, seq: Math.max(-1, ...draft.takes.flatMap(take => take.samplePages.map(page => page.seqSpan[1]))) + 1, visit: draft.clockSegments.length, lastDirection: 0, pointerActive: false, preferredCandidateId: state.preview, release: () => {}, unsubscribe: () => {}, previewRevision: 0, inputRevision: 0 })
  publish(state)
}
async function inputFor(state: VideoMotionState): Promise<OptimizeMotionInput> {
  const sequence = owningSequence(state); const clip = targetClip(state)
  const draft = structuredClone(state.draft)
  const clips = new Map<string, VideoEditClip>()
  for (const target of draft.targets) {
    const containing = state.owner.document.sequences.find(value => value.clips.some(item => `${state.owner.document.id}:${item.id}` === target.ref.id))
    const current = containing?.clips.find(item => `${state.owner.document.id}:${item.id}` === target.ref.id)
    if (!containing || !current) throw new Error('录制目标已移除，请重新读取原稿。')
    assertVideoEditClipsEditable(containing, [current.id])
    const baseDigest = await motionDigest(motionClipBase(current))
    if (baseDigest !== target.baseDigest && !(target.ref.id === activeTarget(state).ref.id && baseDigest === state.appliedBaseDigest) || await motionDigest(motionClipGeometry(videoEditComposition(state.owner.document, containing.id), current)) !== target.geometryDigest) throw new Error('片段或画幅已修改，请保留原稿并重新示范。')
    clips.set(target.ref.id, current)
  }
  const samples: MotionSample[] = []
  const takeTargets = new Map<string, string>()
  for await (const page of readMotionPages(state.owner.document.id, draft)) if (page.kind === 'samples') for (const sample of page.entries) {
    const previous = takeTargets.get(sample.takeRef)
    if (previous && previous !== sample.targetRef.id) throw new Error('一段包含多个目标，无法自动整理；请按原始采样直接编写关键帧。')
    takeTargets.set(sample.takeRef, sample.targetRef.id)
  }
  if (targetClip(state) !== clip) throw new Error('片段已有后续修改，请重新预览。')
  const annotations = state.constraints?.annotations.map(choice => {
    const mark = sequence.annotations.find(a => a.id === choice.id)
    if (!mark) throw new Error('标注已删除，请重新选择标注并整理')
    return readVideoIntentAnnotation(state.owner.document.id, sequence, mark, clip.id, choice.role, choice.span)
  })
  let relative: OptimizeMotionInput['relative']
  const reference = state.constraints?.reference
  if (reference) {
    const current = sequence.clips.find(c => c.id === reference.clip.id)
    if (!current || current.id === clip.id) throw new Error('参照已删除或指向自身，请重新选择')
    const ranges = draft.takes.filter(t => !state.selectedTakeIds || state.selectedTakeIds.includes(t.id)).flatMap(t => t.timelineRange ? [[Math.min(...t.timelineRange), Math.max(...t.timelineRange)] as [number, number]] : [])
    if (ranges.length) {
      relative = { targetRef: draft.targets[0].ref, mode: reference.mode, recorded: sampleVideoMotionReference(state.owner.document.id, reference, ranges), current: sampleVideoMotionReference(state.owner.document.id, captureVideoMotionReference(sequence, current, reference.mode), ranges) }
      relative.recorded.identity = await motionDigest(reference)
      relative.current.identity = await motionDigest(captureVideoMotionReference(sequence, current, reference.mode))
    }
  }
  state.takeTargets = Object.fromEntries([...takeTargets, ...draft.targets.map(target => [`annotation:${target.ref.id}`, target.ref.id] as const)])
  const takeIds = [...draft.takes.map(t => t.id), ...draft.targets.map(t => `annotation:${t.ref.id}`)]
  return { draft, samples, selectedTakeIds: state.selectedTakeIds, intent: state.intent, annotations, relative, beatFrames: clip.snapToBeat ? (sequence.markers ?? []).filter(mark => mark.type === 'beat').map(mark => mark.frame).sort((a, b) => a - b) : undefined, mappings: Object.fromEntries(takeIds.map(takeId => [takeId, { positionToNative: [1, 0, 0, 1, -.5, -.5], pivotToNative: [1, 0, 0, 1, 0, 0], clipStart: (clips.get(takeTargets.get(takeId) ?? takeId.replace(/^annotation:/, '')) ?? clip).start, scaleFactor: 1, rotationOffsetDegrees: 0 }])) }
}

/** Same domain entry for UI and the shared entity-property adapter; selecting never edits artwork. */
export async function configureVideoMotionConstraints(id: string, choice: { annotation?: { id: string; role: 'path' | 'target' | 'dwell' | 'text'; span?: [number, number] }; referenceId?: string; referenceMode?: 'local' | 'composition'; clear?: boolean }): Promise<void> {
  assertApplicationWritesAllowed()
  const state = states.get(requireVideoEditInstance(id)); if (!state) throw new Error('请先开始示范，再选择标注或参照')
  if (state.status === 'optimizing') throw new Error('请先取消整理再调整约束')
  const sequence = owningSequence(state); const clip = targetClip(state)
  const constraints: VideoMotionConstraintOptions = choice.clear ? { kind: 'video-motion-constraints', version: 1, annotations: [] } : structuredClone(state.constraints ?? { kind: 'video-motion-constraints', version: 1, annotations: [] })
  if (choice.annotation) {
    const mark = sequence.annotations.find(a => a.id === choice.annotation!.id)
    if (!mark) throw new Error('标注已删除，请重新选择')
    const annotation = readVideoIntentAnnotation(id, sequence, mark, clip.id, choice.annotation.role, choice.annotation.span)
    constraints.annotations = [...constraints.annotations.filter(a => a.id !== mark.id), { id: mark.id, role: choice.annotation.role, span: annotation.span! }]
  }
  if (choice.referenceId !== undefined) {
    if (choice.referenceId === '') delete constraints.reference
    else {
      const reference = sequence.clips.find(c => c.id === choice.referenceId)
      if (!reference || reference.id === clip.id) throw new Error('请选择另一个画面片段作为参照')
      constraints.reference = constraints.reference?.clip.id === reference.id ? { ...constraints.reference, mode: choice.referenceMode ?? constraints.reference.mode } : captureVideoMotionReference(sequence, reference, choice.referenceMode ?? 'local')
    }
  }
  const parsed = videoMotionConstraintOptionsSchema.parse(constraints)
  const resource = await storeMotionResource(id, parsed, 'recipe')
  if (states.get(state.owner) !== state || getActiveVideoEditSequence(state.owner).revision !== sequence.revision) { await discardUnpublishedResources(state, [resource]); throw new Error('画面已改变，请重新选择约束') }
  invalidate(state); state.constraints = parsed
  if (parsed.annotations.some(a => a.role !== 'text') && !activeTarget(state).editable.includes('position')) activeTarget(state).editable.push('position')
  state.draft.recipeRefs = [{ resourceId: resource.resourceId, bytes: resource.bytes, digest: resource.digest }]
  await persistHead(state, [resource]); publish(state)
}

export async function organizeVideoMotionAnnotation(id: string, annotationId: string, role: 'path' | 'target' | 'dwell' | 'text', span: [number, number]): Promise<void> {
  if (!states.get(requireVideoEditInstance(id))) { await startVideoMotion(id, 'place'); await stopVideoMotion(id) }
  await configureVideoMotionConstraints(id, { annotation: { id: annotationId, role, span } })
  await optimizeVideoMotion(id)
}
export async function optimizeVideoMotion(id: string): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) throw new Error('请先示范动作。')
  if (state.status === 'recording' || state.status === 'paused') await stopVideoMotion(id)
  const runtime = runtimes.get(state.owner)!; runtime.controller?.abort(); const controller = new AbortController(); runtime.controller = controller
  state.status = 'optimizing'; state.message = undefined; publish(state, false)
  const start = performance.now(); const release = holdVideoEditActivity(id, '整理动作')
  const resources: StoredCreativeIntentResource[] = []
  logger.info('动作整理开始', { event: 'video_edit.motion.optimize.start', context: { documentId: id } })
  try {
    await flushVideoMotion(state); const input = await inputFor(state)
    const pages = async function* (): AsyncGenerator<MotionSample[]> { for await (const page of readMotionPages(id, input.draft, controller.signal)) if (page.kind === 'samples') yield page.entries }
    const { result, original } = await optimizeVideoEditMotionOffThread(input, controller.signal, pages()); controller.signal.throwIfAborted()
    if (input.relative || input.annotations?.some(a => a.geometry.kind !== 'text')) {
      result.candidates = result.candidates.filter(candidate => candidate.id === 'constrained')
      result.unavailable = result.unavailable.filter(item => item.family === 'constrained')
    }
    const current = await inputFor(state)
    for (const candidate of result.candidates) assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, current))
    for (const candidate of result.candidates) { controller.signal.throwIfAborted(); resources.push(await storeMotionResource(id, { version: MOTION_CANDIDATE_VERSION, ...candidate }, 'candidate')) }
    const originalRef = original ? await storeMotionResource(id, { version: MOTION_CANDIDATE_VERSION, ...original }, 'candidate') : undefined
    if (originalRef) resources.push(originalRef)
    controller.signal.throwIfAborted()
    const fresh = await inputFor(state); for (const candidate of result.candidates) assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, fresh)); controller.signal.throwIfAborted()
    state.candidates = result.candidates; state.original = original; state.originalRef = originalRef
    state.draft.candidateRefs = resources.slice(0, result.candidates.length).map(r => ({ resourceId: r.resourceId, digest: r.digest, bytes: r.bytes }))
    delete state.draft.selectedCandidateRef
    const chosen = result.candidates.find(candidate => candidate.id === runtime.preferredCandidateId) ?? result.candidates.find(candidate => candidate.id === 'intent') ?? result.candidates.find(candidate => candidate.id === 'clean') ?? result.candidates[0]
    state.preview = runtime.preferredCandidateId === 'original' && original ? 'original' : chosen?.id ?? 'original'
    runtime.preferredCandidateId = state.preview
    state.message = result.candidates.length ? undefined : result.unavailable[0]?.message ?? '请先摆出两个不同时间的姿态。'
    state.draft.selectedCandidateRef = state.draft.candidateRefs[result.candidates.findIndex(candidate => candidate.id === state.preview)]?.resourceId
    await persistHead(state, resources, false); state.generationMs = performance.now() - start
    performance.measure('video-motion-candidate-generation', { start, end: performance.now(), detail: { documentId: id, candidates: result.candidates.length } })
    logger.info('动作整理完成', { event: 'video_edit.motion.optimize.completed', context: { documentId: id, durationMs: state.generationMs, candidates: result.candidates.length } })
  } catch (error) { await discardUnpublishedResources(state, resources); logger.warn('动作整理失败', { event: 'video_edit.motion.optimize.failed', error, context: { documentId: id } }); throw error }
  finally { if (runtime.controller === controller) state.status = 'reviewing'; release(); publish(state) }
}
export function cancelVideoMotionOptimization(id: string): void { runtimes.get(requireVideoEditInstance(id))?.controller?.abort() }
export async function previewVideoMotion(id: string, candidateId: string): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  if (candidateId === 'base') { state.preview = 'base'; setVideoEditPlaybackRate(id, 1); publish(state); return }
  if (candidateId !== 'original' && !state.candidates.some(c => c.id === candidateId)) throw new Error('请选择有效候选。')
  const input = await inputFor(state)
  const candidate = candidateId === 'original' ? state.original : state.candidates.find(c => c.id === candidateId)
  if (!candidate) throw new Error('请先整理，再对照原稿与候选。')
  assertCandidateCurrent(candidate, motionCandidateIdentity(candidateId === 'original' ? { ...state.draft, fidelity: 1 } : state.draft, candidateId === 'original' ? { ...input, intent: undefined, beatFrames: undefined } : input))
  state.preview = candidateId; runtimes.get(state.owner)!.preferredCandidateId = candidateId; setVideoEditPlaybackRate(id, 1); state.draft.selectedCandidateRef = state.draft.candidateRefs[state.candidates.findIndex(c => c.id === candidateId)]?.resourceId; publish(state); await persistHead(state, [], false)
}
export async function configureVideoMotion(id: string, values: { fidelity?: number; intent?: MotionIntent; selectedTakeIds?: string[]; pinSampleId?: string; unpinId?: string }): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  if (values.pinSampleId && state.draft.pins.some(p => p.sampleId === values.pinSampleId)) return
  const source = state.draft; const draft = structuredClone(source)
  if (values.fidelity !== undefined) draft.fidelity = values.fidelity
  if (values.selectedTakeIds?.some(takeId => !draft.takes.some(take => take.id === takeId))) throw new Error('所选示范已不存在，请重新选择。')
  if (values.unpinId) draft.pins = draft.pins.filter(p => p.id !== values.unpinId)
  let pinnedSample: MotionSample | undefined
  if (values.pinSampleId) {
    pinnedSample = state.recent.find(entry => entry.sampleId === values.pinSampleId)
    if (!pinnedSample) for await (const page of readMotionPages(id, source)) if (page.kind === 'samples') pinnedSample = page.entries.find(entry => entry.sampleId === values.pinSampleId) ?? pinnedSample
    if (!pinnedSample) throw new Error('钉住的原稿姿态不存在，请重新选择。')
    draft.pins.push({ id: crypto.randomUUID(), sampleId: pinnedSample.sampleId, targetRef: draft.targets[0].ref, properties: [...draft.targets[0].editable], timeLocked: true, valueLocked: true })
  }
  const parsed = motionDraftSchema.safeParse(draft)
  if (!parsed.success) throw new Error('保真度或钉住姿态无效，请重新选择。')
  if (state.draft !== source) throw new Error('原稿已改变，请重新选择姿态。')
  invalidate(state); state.draft = parsed.data; state.draft.candidateRefs = []; delete state.draft.selectedCandidateRef
  if (values.intent) { if (values.intent.kind !== state.intent?.kind) runtimes.get(state.owner)!.preferredCandidateId = undefined; state.intent = values.intent }
  if (values.selectedTakeIds) state.selectedTakeIds = values.selectedTakeIds
  if (pinnedSample) { const sample = pinnedSample; state.pinnedSamples = [...(state.pinnedSamples ?? []).filter(entry => entry.sampleId !== sample.sampleId), sample] }
  state.pinnedSamples = state.pinnedSamples?.filter(sample => state.draft.pins.some(pin => pin.sampleId === sample.sampleId))
  await flushVideoMotion(state); publish(state)
}
/** Intent endpoints come from sealed samples of the selected take, never from the bounded overlay cache. */
export async function setVideoMotionIntent(id: string, value: 'path' | 'overshoot' | 'spring' | 'bounce' | 'orbit' | 'pingpong'): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  await flushVideoMotion(state); await inputFor(state)
  let first: MotionSample | undefined; let last: MotionSample | undefined
  for await (const page of readMotionPages(id, state.draft)) if (page.kind === 'samples') for (const sample of page.entries) {
    if (!sample.timeline || state.selectedTakeIds && !state.selectedTakeIds.includes(sample.takeRef)) continue
    if (!first || sample.timeline.frame < first.timeline!.frame || sample.timeline.frame === first.timeline!.frame && sample.seq > first.seq) first = sample
    if (!last || sample.timeline.frame > last.timeline!.frame || sample.timeline.frame === last.timeline!.frame && sample.seq > last.seq) last = sample
  }
  if (!first || !last) throw new Error('请先示范动作。')
  const from = first.pose.position; const to = last.pose.position
  if (value === 'bounce' || value === 'orbit' || value === 'pingpong') {
    const duration = last.timeline!.frame - first.timeline!.frame
    if (duration < 2) throw new Error('请延长示范，留出动作的转向时间。')
    const intent: MotionIntent = value === 'bounce' ? { kind: 'bounce', from, to, heightRatio: .12, count: 2, decay: .75 }
      : value === 'orbit' ? { kind: 'orbit', center: [from[0] - .12, from[1]], radiusXY: [.12, .12], startTurns: 0, sweepTurns: 2 }
      : { kind: 'cycle', mode: 'pingpong', periodFrames: duration, template: { kind: 'move_line', from, to } }
    await configureVideoMotion(id, { intent }); return
  }
  await configureVideoMotion(id, { intent: value === 'path' ? { kind: 'follow_path', preserveJitter: false } : value === 'overshoot' ? { kind: 'overshoot', from, to, amountRatio: .08, settleFraction: .625 } : { kind: 'spring_settle', from, to, damping: 6, cycles: 2 } })
}
export async function pinVideoMotionFrame(id: string, frame: number | 'end'): Promise<void> {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  await flushVideoMotion(state)
  let selected: MotionSample | undefined
  for await (const page of readMotionPages(id, state.draft)) if (page.kind === 'samples') for (const sample of page.entries) {
    if (state.selectedTakeIds && !state.selectedTakeIds.includes(sample.takeRef)) continue
    if (frame === 'end' || sample.timeline?.frame === frame) selected = sample
  }
  if (!selected?.timeline) throw new Error('这一帧没有原稿姿态，请先选择示范过的时刻。')
  await configureVideoMotion(id, { pinSampleId: selected.sampleId })
  if (state.status === 'reviewing') await optimizeVideoMotion(id)
}
export async function applyVideoMotion(id: string): Promise<void> {
  assertApplicationWritesAllowed()
  const state = states.get(requireVideoEditInstance(id)); if (!state || state.status === 'optimizing' || state.status === 'recording') throw new Error('请先结束示范并整理。')
  const pending = state.draft.applications.find(application => !application.saved)
  if (pending) { await saveMotionApplication(state, pending); return }
  const candidate = state.candidates.find(c => c.id === state.preview); if (!candidate) throw new Error('请选择整理候选后应用。')
  const runtime = runtimes.get(state.owner)!; const inputRevision = runtime.inputRevision
  const input = await inputFor(state); assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, input))
  if (states.get(state.owner) !== state || runtime.inputRevision !== inputRevision) throw new Error('原稿已有后续修改，请重新预览。')
  const contentVersion = state.owner.contentVersion; const seq = owningSequence(state)
  const transactionId = crypto.randomUUID()
  editVideoProject(id, document => {
    if (!isVideoEditContentCurrent(state.owner, contentVersion)) throw new Error('片段已有后续修改，请重新预览。')
    document = { ...document, sequences: document.sequences.map(targetSequence => {
      const clips = targetSequence.clips.map(current => {
      const motions = candidate.motions.filter(motion => state.takeTargets?.[motion.takeId] === `${id}:${current.id}`)
      return motions.length ? mergeMotionClipCurves(current, motions) : current
      })
      return clips.every((clip, index) => clip === targetSequence.clips[index]) ? targetSequence : { ...targetSequence, clips }
    }) }
    const sequence = { ...document.sequences.find(s => s.id === seq.id)! }
    const ids = new Set(state.constraints?.annotations.filter(a => a.role !== 'text').map(a => a.id))
    sequence.annotations = sequence.annotations.map(mark => {
      if (!ids.has(mark.id)) return mark
      const open = mark.status === 'draft' ? { ...mark, status: 'open' as const } : mark
      const next = { ...open, status: 'addressed' as const, addressedBy: { transactionId, revision: document.revision + 1 }, thread: [...mark.thread, { id: crypto.randomUUID(), author: { kind: 'assistant' as const, name: '动作整理' }, createdAt: new Date().toISOString(), text: '已按已确认的标注角色整理当前动作区间，请预览审查；可用剪辑撤销恢复。' }] }
      assertVideoEditAnnotationTransition(mark, open, 'agent'); assertVideoEditAnnotationTransition(open, next, 'agent')
      return next
    })
    return { ...document, sequences: document.sequences.map(value => value.id === sequence.id ? sequence : value) }
  })
  const applied = targetClip(state); state.appliedBaseDigest = await motionDigest(motionClipBase(applied))
  const application = { candidateRef: state.draft.selectedCandidateRef!, operationRef: { kind: 'creative_intent.application', id: transactionId }, receiptRef: { kind: 'video_edit.document', id }, saved: false }
  state.draft.applications.push(application)
  state.preview = 'base'; publish(state)
  await saveMotionApplication(state, application)
  logger.info('超级关键帧应用完成', { event: 'video_edit.motion.apply.completed', context: { documentId: id } })
}
async function saveMotionApplication(state: VideoMotionState, application: MotionDraft['applications'][number]): Promise<void> {
  try {
    application.saved = true; await persistHead(state, [], false); await saveVideoEdit(state.owner.document.id)
    state.message = undefined
  } catch (error) {
    application.saved = false; state.message = '动作已应用，保存尚未完成；请重试保存。'
    try { await persistHead(state, [], false) } catch (headError) { logger.warn('应用保存状态尚未封存', { event: 'video_edit.motion.application_save_state.failed', error: headError, context: { documentId: state.owner.document.id } }) }
    throw error
  } finally { publish(state) }
}
export function videoMotionLiveResources(owner: VideoEditInstance): StoredCreativeIntentResource[] {
  return creativeIntentLiveResources([owner.document.creativeIntents, ...owner.past.map(d => d.creativeIntents), ...owner.future.map(d => d.creativeIntents)])
}
/** One preview projection feeds the existing renderer; no committed document or history is touched. */
export function videoMotionComposition(owner: VideoEditInstance): VideoEditComposition | undefined {
  if (!owner.activeSequenceId) return undefined
  const base = getActiveVideoEditSequence(owner); const state = states.get(owner); const runtime = runtimes.get(owner)
  if (!state || !runtime) return base
  if (runtime.cached?.base === base && runtime.cached.revision === runtime.previewRevision) return runtime.cached.composition
  const target = base.clips.find(c => refKey({ kind: 'video_edit.clip', id: `${owner.document.id}:${c.id}` }) === refKey(activeTarget(state).ref))
  if (!target) return base
  let clip = target
  if (state.status === 'recording' || state.status === 'paused') {
    const properties = new Set(activeTarget(state).editable)
    if (runtime.pendingEvent || runtime.pointerActive) properties.add(state.property)
    if (properties.size) {
      clip = { ...target, curves: { ...target.curves } }
      if (properties.has('position')) { clip.x = state.pose.position[0] - .5; clip.y = state.pose.position[1] - .5; delete clip.curves!.x; delete clip.curves!.y }
      if (properties.has('rotationTurns')) { clip.rotation = state.pose.rotationTurns * 360; delete clip.curves!.rotation }
      if (properties.has('scaleXY')) { clip.scale = state.pose.scaleXY[0]; delete clip.curves!.scale }
    }
  } else {
    const candidate = state.preview === 'original' ? state.original : state.candidates.find(c => c.id === state.preview)
    if (candidate) clip = mergeMotionClipCurves(target, candidate.motions.filter(motion => state.takeTargets?.[motion.takeId] === `${owner.document.id}:${target.id}`))
  }
  const candidate = state.status === 'reviewing' ? state.preview === 'original' ? state.original : state.candidates.find(value => value.id === state.preview) : undefined
  const composition = candidate ? { ...base, revision: base.revision + runtime.previewRevision, clips: base.clips.map(current => {
    const motions = candidate.motions.filter(motion => state.takeTargets?.[motion.takeId] === `${owner.document.id}:${current.id}`)
    return motions.length ? mergeMotionClipCurves(current, motions) : current
  }) } : clip === target ? base : { ...base, revision: base.revision + runtime.previewRevision, clips: base.clips.map(c => c === target ? clip : c) }
  runtime.cached = { base, revision: runtime.previewRevision, composition }; return composition
}
