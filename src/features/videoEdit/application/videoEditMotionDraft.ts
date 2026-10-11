import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { motionDraftSchema, refKey, type MotionDraft, type MotionProperty, type MotionSample, type Pose, type Timeline, type ClockSegment } from '@/core/creativeIntent/contracts'
import { assertCandidateCurrent, motionCandidateIdentity, type MotionCandidate, type OptimizeMotionInput } from '@/core/creativeIntent/candidates'
import { type MotionIntent } from '@/core/creativeIntent/recipe'
import { type CreativeIntents, type StoredCreativeIntentResource, creativeIntentLiveResources } from '@/core/creativeIntent/persistence'
import { mergeMotionClipCurves, motionClipBase, motionClipGeometry, motionClipPose } from '@/core/videoEdit/motionDraft'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditComposition, type VideoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { requireVideoEditInstance, getActiveVideoEditSequence, editVideoProject, updateVideoEditCreativeIntents, holdVideoEditActivity, saveVideoEdit, subscribeVideoEditView, setVideoEditPlaybackRate, registerVideoEditClosePreparation, videoEditBusyReason, switchVideoEditSequence, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { motionDigest, motionSamplePage, motionPageRef, readMotionPages, readMotionCandidate, storeMotionResource } from './videoEditMotionResources'
import { optimizeVideoEditMotionOffThread } from './videoEditMotionWorkerClient'

const logger = createLogger('features.videoEdit.motionDraft')
const PAGE_SAMPLE_BUDGET = 256
const OVERLAY_SAMPLE_BUDGET = 96
export type MotionCaptureMode = 'navigate' | 'demonstrate'
export type MotionCaptureProperty = Exclude<MotionProperty, 'pivot'>
export interface MotionPresentation { frame: number; revision: number; sequenceId: string; at: number; scrubbing?: boolean }
interface PresentedPose { timeline: Timeline; pose: Pose; monoUs: number; clockId: string }
export interface VideoMotionState {
  owner: VideoEditInstance; draft: MotionDraft; status: 'recording' | 'paused' | 'reviewing' | 'optimizing';
  mode: MotionCaptureMode; property: MotionCaptureProperty; speed: 1 | 0.5 | 0.25; capture: 'place' | 'record';
  pose: Pose; presentation?: MotionPresentation; preview: 'original' | string; candidates: MotionCandidate[];
  recent: MotionSample[]; pending: MotionSample[]; pinnedSamples?: MotionSample[]; selectedTakeIds?: string[]; intent?: MotionIntent;
  message?: string; generationMs?: number; inputLatencies: number[];
  original?: MotionCandidate; originalRef?: StoredCreativeIntentResource; endpoints?: [MotionSample, MotionSample]; appliedBaseDigest?: string
}
interface CaptureRuntime { startedAt: number; seq: number; visit: number; gestureStarted?: boolean; gestureOrigin?: PresentedPose; lastFrame?: number; lastDirection: number; takeId?: string; pointerActive: boolean; inputAt?: number; pendingEvent?: MotionSample['event']; pendingPresentation?: Promise<void>; presented?: () => void; pausedAt?: number; clockId?: string; flushTimer?: ReturnType<typeof setTimeout>; write?: Promise<void>; persist?: Promise<void>; controller?: AbortController; preferredCandidateId?: string; release: () => void; unsubscribe: () => void; previewRevision: number; inputRevision: number; cached?: { base: VideoEditComposition; revision: number; composition: VideoEditComposition } }
const states = new WeakMap<VideoEditInstance, VideoMotionState>()
const runtimes = new WeakMap<VideoEditInstance, CaptureRuntime>()
const listeners = new Set<() => void>(); let revision = 0
export function subscribeVideoMotion(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoMotionRevision(): number { return revision }
export function videoMotionState(owner: VideoEditInstance): VideoMotionState | undefined { return states.get(owner) }
function publish(state: VideoMotionState, preview = true): void {
  if (preview) runtimes.get(state.owner)!.previewRevision++
  revision++; for (const listener of listeners) listener()
}
function head(owner: VideoEditInstance): CreativeIntents { return owner.document.creativeIntents ?? { drafts: [], sessions: [], resources: [] } }
function targetClip(state: VideoMotionState): VideoEditClip {
  const id = state.draft.targets[0].ref.id
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
function invalidate(state: VideoMotionState): void { const runtime = runtimes.get(state.owner); if (runtime) { runtime.controller?.abort(); runtime.inputRevision++ } state.candidates = []; state.original = undefined; state.originalRef = undefined; state.draft.candidateRefs = []; delete state.draft.selectedCandidateRef; state.preview = 'original' }
async function persistHead(state: VideoMotionState, resources: StoredCreativeIntentResource[] = []): Promise<void> {
  const runtime = runtimes.get(state.owner)!
  const operation = async (): Promise<void> => {
    const draft = structuredClone(state.draft)
    draft.sourceDigest = await motionDigest({ ...draft, sourceDigest: undefined, candidateRefs: [], selectedCandidateRef: undefined, applications: [] })
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
export async function startVideoMotion(id: string, capture: 'place' | 'record' = 'record'): Promise<void> {
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
  const draft = motionDraftSchema.parse({ id: crypto.randomUUID(), version: 1, ownerRef: { kind: 'document.video_edit', id }, mode: 'animated', label: '超级关键帧原稿', fidelity: .5,
    sourceDigest: baseDigest, targets: [{ ref: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, ownerRef: { kind: 'document.video_edit', id }, editable: [], basePose: pose, baseDigest, geometryDigest, compositionSize: [sequence.width, sequence.height] }],
    clockSegments: [], takes: [], pins: [], constraints: [], recipeRefs: [], candidateRefs: [], applications: [] })
  const previous = runtimes.get(owner); previous?.controller?.abort(); previous?.release(); previous?.unsubscribe()
  const state: VideoMotionState = { owner, draft, status: 'recording', capture, mode: 'navigate', property: 'position', speed: 1, pose, preview: 'original', candidates: [], recent: [], pending: [], inputLatencies: [] }
  const runtime: CaptureRuntime = { startedAt: performance.now(), seq: 0, visit: 0, lastDirection: 0, pointerActive: false, release: holdVideoEditActivity(id, '动作示范'), unsubscribe: () => {}, previewRevision: 0, inputRevision: 0 }
  states.set(owner, state); runtimes.set(owner, runtime); owner.motionRecording = true; owner.playbackRate = 1
  const unregisterClose = registerVideoEditClosePreparation(owner, () => stopVideoMotion(id))
  const release = runtime.release
  runtime.release = () => { release(); unregisterClose() }
  runtime.unsubscribe = subscribeVideoEditView(() => {
    if (state.status !== 'recording' && state.status !== 'paused') return
    try { owningSequence(state) } catch (error) { pauseVideoMotion(id); state.message = error instanceof Error ? error.message : '示范已暂停。'; publish(state, false) }
  })
  await persistHead(state); publish(state)
  logger.info('动作示范开始', { event: 'video_edit.motion.start', context: { documentId: id, capture } })
}
export function recordVideoMotionPresentation(owner: VideoEditInstance, evidence: MotionPresentation): void {
  const state = states.get(owner); const runtime = runtimes.get(owner)
  if (!state || !runtime) return
  if (state.status === 'recording' && evidence.revision !== videoMotionComposition(owner)?.revision) return
  state.presentation = evidence
  if (state.status === 'recording') { const composition = videoMotionComposition(owner); const clip = composition?.clips.find(c => `${owner.document.id}:${c.id}` === state.draft.targets[0].ref.id); if (clip) state.pose = motionClipPose(clip, evidence.frame) }
  if (runtime.inputAt !== undefined) {
    const latency = Math.max(0, evidence.at - runtime.inputAt); state.inputLatencies.push(latency)
    if (state.inputLatencies.length > 2048) state.inputLatencies.shift()
    performance.measure('video-motion-input-present', { start: runtime.inputAt, end: evidence.at, detail: { frame: evidence.frame, documentId: owner.document.id } }); runtime.inputAt = undefined
  }
  if (state.status !== 'recording') return
  captureClock(state)
  if (runtime.pendingEvent || runtime.pointerActive && runtime.gestureStarted || state.mode === 'demonstrate' && state.capture === 'record' && state.draft.takes.length > 0) {
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
  const reverse = Boolean(direction && runtime.lastDirection && direction !== runtime.lastDirection)
  if (seek || reverse) {
    runtime.visit++; t.visitRef = `${t.sequenceRef.id}/${runtime.visit}`
    if (state.capture === 'record' || reverse) runtime.takeId = undefined
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
  if (direction && state.mode === 'navigate' && state.capture === 'record' && !runtime.pointerActive) runtime.takeId = undefined
}
function capturePose(state: VideoMotionState, event: MotionSample['event'], inputAt?: number, anchor?: PresentedPose): void {
  const runtime = runtimes.get(state.owner)!; const clock = state.draft.clockSegments.find(s => s.id === (anchor?.clockId ?? runtime.clockId)); const at = anchor?.monoUs ?? clock?.anchors.at(-1)?.monoUs ?? mono(state); const t = anchor?.timeline ?? timeline(state)
  if (!t) { state.message = '请等待片段画面显示后继续示范。'; publish(state, false); return }
  runtime.lastFrame = t.frame
  if (!runtime.takeId) {
    runtime.takeId = crypto.randomUUID()
    state.draft.takes.push({ id: runtime.takeId, intent: 'demonstrate', pathDemonstration: false, ...(state.capture === 'place' ? { placement: true as const } : {}), monoSpanUs: [at, at], direction: 0, visitRef: t.visitRef, timelineRange: [t.frame, t.frame], samplePages: [], geometryDigest: state.draft.targets[0].geometryDigest })
  }
  const take = state.draft.takes.find(v => v.id === runtime.takeId)!
  if (take.direction === 0 && take.timelineRange![0] !== t.frame) take.direction = Math.sign(t.frame - take.timelineRange![0]) as -1 | 1
  take.monoSpanUs[1] = at; take.timelineRange![1] = t.frame
  if (!clock) return
  const sample: MotionSample = { sampleId: crypto.randomUUID(), seq: runtime.seq++, monoUs: at, timeline: t, clockSegmentRef: clock.id, takeRef: take.id, targetRef: state.draft.targets[0].ref, pose: structuredClone(anchor?.pose ?? state.pose), quality: 'presented', confirmed: true, gestureKind: state.property === 'position' ? 'move' : state.property === 'rotationTurns' ? 'rotate' : 'scale', event }
  if (!state.draft.targets[0].editable.includes(state.property)) state.draft.targets[0].editable.push(state.property)
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
  state.status = 'paused'; const runtime = runtimes.get(state.owner)!; runtime.pointerActive = false; runtime.pendingEvent = undefined; runtime.inputAt = undefined; runtime.presented?.(); runtime.pendingPresentation = undefined; runtime.presented = undefined
  runtime.pausedAt = state.draft.clockSegments.at(-1)?.monoSpanUs[1] ?? mono(state); publish(state)
}
export function resumeVideoMotion(id: string): void {
  const state = states.get(requireVideoEditInstance(id)); if (!state) return
  if (state.status !== 'paused') throw new Error('只有暂停的示范可以继续。')
  owningSequence(state); state.status = 'recording'; state.message = undefined; state.owner.motionRecording = true
  setVideoEditPlaybackRate(id, state.speed)
  const runtime = runtimes.get(state.owner)!; const at = mono(state)
  if (runtime.pausedAt !== undefined && at > runtime.pausedAt) state.draft.clockSegments.push({ id: crypto.randomUUID(), monoSpanUs: [runtime.pausedAt, at], mode: 'gap', start: null, end: null, anchors: [] })
  runtime.pausedAt = undefined; runtime.takeId = undefined; publish(state)
}
export async function reopenVideoMotion(id: string, draftId: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const draft = head(owner).drafts.find(d => d.id === draftId)
  if (!draft) throw new Error('原稿不存在。')
  if (['recording', 'paused', 'optimizing'].includes(states.get(owner)?.status ?? '')) throw new Error('请先结束当前示范或整理，再打开原稿。')
  const expected = owner.document
  const options = head(owner).motionOptions?.find(o => o.draftId === draftId)
  const state: VideoMotionState = { owner, draft: structuredClone(draft), status: 'reviewing', mode: 'navigate', property: 'position', speed: 1, capture: 'place', pose: draft.targets[0].basePose, preview: 'original', candidates: [], recent: [], pending: [], inputLatencies: [], intent: options?.intent, selectedTakeIds: options?.selectedTakeIds, appliedBaseDigest: options?.appliedBaseDigest }
  state.pinnedSamples = []
  const pins = new Set(draft.pins.map(pin => pin.sampleId))
  for await (const page of readMotionPages(id, draft)) if (page.kind === 'samples') {
    state.recent = [...state.recent, ...page.entries].slice(-OVERLAY_SAMPLE_BUDGET); state.endpoints = [state.endpoints?.[0] ?? page.entries[0], page.entries.at(-1)!]
    state.pinnedSamples.push(...page.entries.filter(sample => pins.has(sample.sampleId)))
  }
  for (const ref of draft.candidateRefs) { const resource = head(owner).resources.find(r => r.resourceId === ref.resourceId)!; const candidate = await readMotionCandidate(resource); state.candidates.push(candidate); if (ref.resourceId === draft.selectedCandidateRef) state.preview = candidate.id }
  if (options?.originalRef) { state.originalRef = head(owner).resources.find(r => r.resourceId === options.originalRef!.resourceId)!; state.original = await readMotionCandidate(state.originalRef) }
  if (owner.document !== expected) throw new Error('原稿所在文档已改变，请重新打开原稿。')
  const clip = targetClip(state); const sequence = owner.document.sequences.find(s => s.clips.some(c => c.id === clip.id))!
  switchVideoEditSequence(id, sequence.id); setVideoEditView(id, { selection: clip.id, frame: state.endpoints?.[0]?.timeline?.frame ?? clip.start, playing: false })
  try {
    const input = await inputFor(state)
    for (const candidate of state.candidates) assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, input))
    if (state.original) assertCandidateCurrent(state.original, motionCandidateIdentity({ ...state.draft, fidelity: 1 }, { ...input, intent: undefined }))
  } catch (error) { state.candidates = []; state.original = undefined; state.preview = 'base'; state.message = error instanceof Error ? error.message : '原稿已保留，请重新示范。' }
  const previous = runtimes.get(owner); previous?.controller?.abort(); previous?.release(); previous?.unsubscribe()
  states.set(owner, state); runtimes.set(owner, { startedAt: performance.now(), seq: 0, visit: 0, lastDirection: 0, pointerActive: false, preferredCandidateId: state.preview, release: () => {}, unsubscribe: () => {}, previewRevision: 0, inputRevision: 0 })
  publish(state)
}
async function inputFor(state: VideoMotionState): Promise<OptimizeMotionInput> {
  const sequence = owningSequence(state); const clip = targetClip(state)
  const draft = structuredClone(state.draft)
  const baseDigest = await motionDigest(motionClipBase(clip))
  if (baseDigest !== state.draft.targets[0].baseDigest && baseDigest !== state.appliedBaseDigest || await motionDigest(motionClipGeometry(sequence, clip)) !== state.draft.targets[0].geometryDigest) throw new Error('片段或画幅已修改，请保留原稿并重新示范。')
  const samples: MotionSample[] = []
  if (targetClip(state) !== clip) throw new Error('片段已有后续修改，请重新预览。')
  return { draft, samples, selectedTakeIds: state.selectedTakeIds, intent: state.intent, mappings: Object.fromEntries(draft.takes.map(t => [t.id, { positionToNative: [1, 0, 0, 1, -.5, -.5], pivotToNative: [1, 0, 0, 1, 0, 0], clipStart: clip.start, scaleFactor: 1, rotationOffsetDegrees: 0 }])) }
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
    const current = await inputFor(state)
    for (const candidate of result.candidates) assertCandidateCurrent(candidate, motionCandidateIdentity(state.draft, current))
    for (const candidate of result.candidates) { controller.signal.throwIfAborted(); resources.push(await storeMotionResource(id, { version: 1, ...candidate }, 'candidate')) }
    const originalRef = original ? await storeMotionResource(id, { version: 1, ...original }, 'candidate') : undefined
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
    await persistHead(state, resources); state.generationMs = performance.now() - start
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
  assertCandidateCurrent(candidate, motionCandidateIdentity(candidateId === 'original' ? { ...state.draft, fidelity: 1 } : state.draft, candidateId === 'original' ? { ...input, intent: undefined } : input))
  state.preview = candidateId; runtimes.get(state.owner)!.preferredCandidateId = candidateId; setVideoEditPlaybackRate(id, 1); state.draft.selectedCandidateRef = state.draft.candidateRefs[state.candidates.findIndex(c => c.id === candidateId)]?.resourceId; publish(state); await persistHead(state)
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
  const expected = state.owner.document; const clip = targetClip(state); const seq = owningSequence(state)
  editVideoProject(id, document => {
    if (state.owner.document !== expected) throw new Error('片段已有后续修改，请重新预览。')
    const sequence = document.sequences.find(s => s.id === seq.id)!
    sequence.clips = sequence.clips.map(c => c.id === clip.id ? mergeMotionClipCurves(c, candidate.motions) : c)
    return document
  })
  const applied = targetClip(state); state.appliedBaseDigest = await motionDigest(motionClipBase(applied))
  const application = { candidateRef: state.draft.selectedCandidateRef!, operationRef: { kind: 'creative_intent.application', id: crypto.randomUUID() }, receiptRef: { kind: 'video_edit.document', id }, saved: false }
  state.draft.applications.push(application)
  state.preview = 'base'; publish(state)
  await saveMotionApplication(state, application)
  logger.info('超级关键帧应用完成', { event: 'video_edit.motion.apply.completed', context: { documentId: id } })
}
async function saveMotionApplication(state: VideoMotionState, application: MotionDraft['applications'][number]): Promise<void> {
  try {
    application.saved = true; await persistHead(state); await saveVideoEdit(state.owner.document.id)
    state.message = undefined
  } catch (error) {
    application.saved = false; state.message = '动作已应用，保存尚未完成；请重试保存。'
    try { await persistHead(state) } catch (headError) { logger.warn('应用保存状态尚未封存', { event: 'video_edit.motion.application_save_state.failed', error: headError, context: { documentId: state.owner.document.id } }) }
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
  const target = base.clips.find(c => refKey({ kind: 'video_edit.clip', id: `${owner.document.id}:${c.id}` }) === refKey(state.draft.targets[0].ref))
  if (!target) return base
  let clip = target
  if (state.status === 'recording' || state.status === 'paused') {
    const properties = new Set(state.draft.targets[0].editable)
    if (runtime.pendingEvent || runtime.pointerActive) properties.add(state.property)
    if (properties.size) {
      clip = { ...target, curves: { ...target.curves } }
      if (properties.has('position')) { clip.x = state.pose.position[0] - .5; clip.y = state.pose.position[1] - .5; delete clip.curves!.x; delete clip.curves!.y }
      if (properties.has('rotationTurns')) { clip.rotation = state.pose.rotationTurns * 360; delete clip.curves!.rotation }
      if (properties.has('scaleXY')) { clip.scale = state.pose.scaleXY[0]; delete clip.curves!.scale }
    }
  } else {
    const candidate = state.preview === 'original' ? state.original : state.candidates.find(c => c.id === state.preview)
    if (candidate) clip = mergeMotionClipCurves(target, candidate.motions)
  }
  const composition = clip === target ? base : { ...base, revision: base.revision + runtime.previewRevision, clips: base.clips.map(c => c === target ? clip : c) }
  runtime.cached = { base, revision: runtime.previewRevision, composition }; return composition
}
