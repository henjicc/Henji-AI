import { withPaidOperation } from '@/services/paidApproval'
import { prepareExplanationGeneration, type PreparedExplanationGeneration, type ExplanationSendRequest } from '@/features/creativeIntent'
import { sameExplanationBinding, eraseExplanationBody, explanationBodyRef, registerExplanationBodyEditor, writeExplanationBody, type ExplanationBodyChanges } from '@/core/creativeIntent/semanticIntentEdits'
import type { ApplicationExecutionContext } from '@/core/application-control'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { explanationSessionSchema, transcriptEventSchema, type ExplanationSession, type ExplanationEvent, type TranscriptEntry } from '@/core/creativeIntent/schema'
import { creativeIntentPageSchema, type CreativeIntentPage } from '@/core/creativeIntent/pages'
import { clockEventIssue, type ClockSegment } from '@/core/creativeIntent/contracts'
import { type CreativeIntents, type StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
import { alignRecordingTranscript } from '@/core/creativeIntent/recordingAlignment'
import { recordingCommandEvent } from '@/core/creativeIntent/recordingEvents'
import { resolveDeixis, confirmedExplanationBinding, pickedExplanationBinding, type DeicticMention, type DeixisResolution, type ExplanationBinding } from '@/core/creativeIntent/deixis'
import { buildIntentDifferencePlan, reviewedMovementChanges, type IntentDifferencePlan, type ReviewedIntentGoal } from '@/core/creativeIntent/intentPlan'
import { captureExplanationPixels } from './videoEditExplanationVisual'
import { serializeRecordingInput } from '@/core/creativeIntent/recordingSerializer'
import { RecordingCollector, captureMicrophone, type CapturedAudioBlock, type MicrophoneCapture } from '@/features/creativeIntent'
import { modelDefaultsManager } from '@/features/settings'
import { motionClipPose } from '@/core/videoEdit/motionDraft'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { videoEditComposition, activeVideoEditClips, type VideoEditComposition } from '@/core/videoEdit/document'
import type { ApplicationRef } from '@/core/application-control/identifiers'
import type { ApplicationSurfaceId } from '@/core/application-control/applicationSurfaces'
import { motionDigest, storeMotionResource, storeMotionResourceBytes, motionPageRef, readMotionResource, readMotionResourceBytes } from './videoEditMotionResources'
import { subscribeVideoMotion, videoMotionState, proposeVideoExplanationMotion } from './videoEditMotionDraft'
import { getActiveVideoEditSequence, requireVideoEditInstance, updateVideoEditCreativeIntents, purgeVideoEditExplanationSession, subscribeVideoEditCommandFacts, subscribeVideoEditView, registerVideoEditClosePreparation, saveVideoEdit, type VideoEditInstance, type VideoEditCommandFact } from './videoEditService'

const logger = createLogger('features.videoEdit.explanation')
export interface VideoExplanationState { collector: RecordingCollector; originMs: number; elapsedUs: number; message?: string; busy: boolean; erased: boolean; microphone?: MicrophoneCapture; controller: AbortController; picture?: { frame: number; sequenceId: string; revision: number; composition: VideoEditComposition }; reviewComposition?: VideoEditComposition; uncertaintyUs: number[] }
interface Runtime { transcription?: AbortController; generation?: PreparedExplanationGeneration; releaseBody?: () => void; state: VideoExplanationState; write: Promise<void>; partial: CapturedAudioBlock[]; samples: number; pendingAudio: Map<string, () => Promise<void>>; queued?: number; erasePaths?: Set<string>; lastBlock?: CapturedAudioBlock; pausing?: Promise<void>; installed?: boolean; viewKey?: string; geometry?: { key: string; id: string }; release: () => void; timer?: ReturnType<typeof setInterval> }
const states = new WeakMap<VideoEditInstance, Runtime>()
const listeners = new Set<() => void>(); let revision = 0
export function subscribeVideoExplanation(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoExplanationRevision(): number { return revision }
export function videoExplanationState(owner: VideoEditInstance): VideoExplanationState | undefined { return states.get(owner)?.state }
function publish(): void { revision++; for (const listener of listeners) listener() }
function now(state: VideoExplanationState): number { return Math.max(state.elapsedUs, Math.round((performance.now() - state.originMs) * 1000)) }
function head(owner: VideoEditInstance): CreativeIntents { return owner.document.creativeIntents ?? { drafts: [], sessions: [], resources: [] } }
function assertCurrent(owner: VideoEditInstance, state: VideoExplanationState): void {
  const runtime = states.get(owner)
  if (state.erased || requireVideoEditInstance(owner.document.id) !== owner || runtime?.state !== state || runtime.installed && !head(owner).sessions.some(s => s.id === state.collector.session.id && s.sourceDigest === state.collector.session.sourceDigest)) { state.controller.abort(); throw new Error('原讲解已关闭或删除。') }
}
function installHead(owner: VideoEditInstance, state: VideoExplanationState, resource?: StoredCreativeIntentResource): void {
  assertCurrent(owner, state)
  const current = head(owner); const session = explanationSessionSchema.parse(structuredClone(state.collector.session))
  updateVideoEditCreativeIntents(owner.document.id, { ...current, sessions: [...current.sessions.filter(s => s.id !== session.id), session], resources: resource ? [...current.resources.filter(r => r.resourceId !== resource.resourceId), resource] : current.resources })
  states.get(owner)!.installed = true
}
function enqueue(runtime: Runtime, operation: () => Promise<void>): Promise<void> {
  runtime.queued = (runtime.queued ?? 0) + 1
  const next = runtime.write.then(operation).finally(() => { runtime.queued!-- })
  runtime.write = next.catch(() => { runtime.state.message = '讲解尚未保存，请重试保存。'; publish() })
  if (runtime.queued >= 8 && !runtime.state.busy && runtime.state.collector.session.state === 'recording') {
    runtime.state.message = '讲解记录处理较慢，正在暂停采集；保存后可继续。'
    void pauseVideoExplanation(runtime.state.collector.session.ownerRef.id).catch(() => publish())
  }
  return next
}
async function flushWrites(runtime: Runtime): Promise<void> {
  await runtime.write
  for (const [key, write] of runtime.pendingAudio) { await write(); runtime.pendingAudio.delete(key) }
}
function bindCapture(owner: VideoEditInstance, runtime: Runtime): void {
  const state = runtime.state; const id = owner.document.id
  const commands = subscribeVideoEditCommandFacts((source, fact) => { if (source === owner) recordCommand(owner, fact) })
  let motionKey = ''
  const modeChanged = (): void => {
    if (state.collector.session.state !== 'recording') return
    const motion = videoMotionState(owner)
    const intent = motion?.status === 'recording' && motion.mode === 'demonstrate' ? 'demonstrate' : 'navigate'
    const key = `${intent}:${motion?.property ?? 'position'}`
    if (key === motionKey) return
    state.collector.record(now(state), { kind: 'control', action: motionKey && motionKey.split(':')[0] === intent ? 'property-mode' : 'demonstration-mode', intent, ...(motion ? { property: motion.property } : {}) })
    motionKey = key
  }
  const motion = subscribeVideoMotion(modeChanged)
  modeChanged()
  const view = subscribeVideoEditView(() => {
    if (state.collector.session.state !== 'recording') return
    const key = JSON.stringify([owner.frame,owner.playing,owner.playbackDirection,owner.playbackRate,owner.scrubbing,owner.activeSequenceId])
    if (runtime.viewKey === key) return
    runtime.viewKey = key
    const picture = state.picture
    const sequence = picture?.composition
    state.collector.presented(now(state), { timeline: sequence && picture ? { sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, frame: picture.frame, fps: sequence.frameRate } : null, requestedFrame: owner.frame, playing: owner.playing, direction: owner.playing ? owner.playbackDirection : 0, rate: owner.playbackRate ?? 1, scrubbing: !!owner.scrubbing }, owner.scrubbing ? 'scrub' : owner.playing ? 'play' : 'pause')
  })
  const close = registerVideoEditClosePreparation(owner, async () => { await runtime.generation?.cancel(); runtime.generation = undefined; if (!state.microphone) state.controller.abort(); await stopVideoExplanation(id); state.controller.abort(); await clearTemporaryVideoExplanationAudio(id); runtime.release() })
  runtime.timer = setInterval(() => {
    if (state.collector.session.state !== 'recording') return
    state.elapsedUs = now(state); publish()
    void runtime.write.then(() => state.collector.flush()).catch(() => { state.message = '讲解保存失败，请暂停后重试。'; publish() })
  }, 2000)
  runtime.release = () => { runtime.releaseBody?.(); clearInterval(runtime.timer); commands(); motion(); view(); close(); state.controller.abort() }
}
export async function startVideoExplanation(id: string, userReceiptRef: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const previous = states.get(owner)
  if (previous?.state.erased || previous?.state.busy) throw new Error('请先完成当前讲解的处理。')
  if (previous && ['recording', 'paused', 'transcribing'].includes(previous.state.collector.session.state)) throw new Error('请先结束当前讲解。')
  if (owner.motionRecording) throw new Error('请先结束动作示范，再录制讲解。')
  if (!userReceiptRef) throw new Error('请先阅读并确认录制范围。')
  if (previous) { previous.state.busy = true; publish() }
  let session: ExplanationSession
  try {
    if (previous) await clearTemporaryVideoExplanationAudio(id)
    session = explanationSessionSchema.parse({ id: crypto.randomUUID(), version: 1, ownerRef: { kind: 'document.video_edit', id }, createdAt: new Date().toISOString(), state: 'consenting', mode: 'animated', sourceDigest: await motionDigest([id, crypto.randomUUID()]), retentionStatus: 'temporary', clockSegments: [], pages: [], visualEvidenceRefs: [], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [], consent: { noticeDigest: await motionDigest('explanation-notice-v2/history-acknowledged-picture'), userReceiptRef, capture: true, keepAudio: false, audioUpload: false, textUpload: false, imageUpload: false } })
    if (previous) assertCurrent(owner, previous.state)
    else if (requireVideoEditInstance(id) !== owner || states.has(owner)) throw new Error('录制宿主已关闭或已有讲解。')
  } catch (error) { if (previous && states.get(owner) === previous) { previous.state.busy = false; publish() } throw error }
  previous?.release()
  const state: VideoExplanationState = { collector: undefined as unknown as RecordingCollector, originMs: performance.now(), elapsedUs: 0, busy: true, erased: false, controller: new AbortController(), uncertaintyUs: [] }
  const runtime: Runtime = { state, write: Promise.resolve(), partial: [], samples: 0, pendingAudio: new Map(), release: () => {} }
  states.set(owner, runtime)
  state.collector = new RecordingCollector(session, async page => {
    const resource = await storeMotionResource(id, page, 'page')
    if (state.erased) { await getPlatform().system.fs.remove(resource.path); return }
    state.collector.session.pages.push(motionPageRef(resource, page)); installHead(owner, state, resource)
  }, message => { state.message = message; void pauseVideoExplanation(id).catch(() => { publish() }) })
  state.collector.start(0)
  registerBodyEditor(owner, runtime)
  bindCapture(owner, runtime)
  try { await openMicrophone(owner, runtime); state.busy = false; installHead(owner, state); publish(); logger.info('录制讲解开始', { event: 'explanation.capture.start', context: { documentId: id } }) }
  catch (error) { state.collector.pause(now(state)); state.collector.session.state = 'recoverable'; state.message = '无法使用麦克风，请检查系统权限或重新连接设备。'; state.busy = false; installHead(owner, state); publish(); throw error }
}
async function openMicrophone(owner: VideoEditInstance, runtime: Runtime): Promise<void> {
  const state = runtime.state
  await getPlatform().audioEdit.recording.microphone(true, state.collector.session.consent!.userReceiptRef)
  try {
  state.microphone = await captureMicrophone(state.originMs, block => {
    if (state.erased) return
    const last = runtime.lastBlock
    if (last && (last.firstFrame + last.samples.length !== block.firstFrame || last.sampleRate !== block.sampleRate)) { sealAudio(owner, runtime); state.message = '音频采集存在缺口，已保留前段并暂停；请检查设备后继续。'; void pauseVideoExplanation(owner.document.id).catch(() => publish()) }
    runtime.lastBlock = block
    runtime.partial.push(block); runtime.samples += block.samples.length
    state.uncertaintyUs.push(block.uncertaintyUs); if (state.uncertaintyUs.length > 2048) state.uncertaintyUs.shift()
    if (runtime.samples >= block.sampleRate * 10) sealAudio(owner, runtime)
  }, message => { state.message = message; void pauseVideoExplanation(owner.document.id).catch(() => { publish() }) }, state.controller.signal)
  } catch (error) { await getPlatform().audioEdit.recording.microphone(false, state.collector.session.consent!.userReceiptRef); throw error }
}
function sealAudio(owner: VideoEditInstance, runtime: Runtime): void {
  if (!runtime.samples) return
  const blocks = runtime.partial; const samples = new Float32Array(runtime.samples); let offset = 0
  for (const block of blocks) { samples.set(block.samples, offset); offset += block.samples.length }
  runtime.partial = []; runtime.samples = 0
  const first = blocks[0]; const chunkId = crypto.randomUUID(); const state = runtime.state
  const event = state.collector.record(now(state), { kind: 'audio', audioSegmentRef: chunkId, startSample: first.firstFrame, endSample: first.firstFrame + samples.length, monoSpanUs: [first.monoStartUs, first.monoStartUs + Math.round(samples.length * 1_000_000 / first.sampleRate)], sampleRate: first.sampleRate, channels: 1, uncertaintyUs: Math.max(...blocks.map(b => b.uncertaintyUs)) })
  if (!event) throw new Error('录音尾部尚未封存。')
  const write = async (): Promise<void> => { if (!state.erased) await getPlatform().audioEdit.recording.write({ action: 'write', sessionId: state.collector.session.id, chunkId, sampleRate: first.sampleRate, samples }) }
  runtime.pendingAudio.set(chunkId, write)
  void enqueue(runtime, async () => { await write(); runtime.pendingAudio.delete(chunkId) }).catch(() => { state.message = '录音保存失败，请保留当前页面并重试保存。'; void pauseVideoExplanation(owner.document.id).catch(() => { publish() }) })
  if (runtime.pendingAudio.size >= 4) { state.message = '录音保存较慢，正在暂停采集；保存后可继续。'; void pauseVideoExplanation(owner.document.id).catch(() => publish()) }
}
export function recordVideoExplanationPresentation(owner: VideoEditInstance, evidence: { frame: number; sequenceId: string; revision: number; at: number; scrubbing?: boolean; composition?: VideoEditComposition }): void {
  const state = states.get(owner)?.state; if (!state || state.collector.session.state !== 'recording') return
  // The renderer passes the immutable composition submitted to this acknowledged draw.
  // A later document revision must never substitute for what was actually presented.
  const sequence = evidence.composition ?? (owner.document.revision === evidence.revision ? videoEditComposition(owner.document, evidence.sequenceId) : undefined)
  if (!sequence) { state.picture = undefined; return }
  state.picture = { ...evidence, composition: sequence }
  state.collector.presented(Math.max(0, Math.round((evidence.at - state.originMs) * 1000)), { timeline: { sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence.id}` }, frame: evidence.frame, fps: sequence.frameRate }, requestedFrame: owner.frame, playing: owner.playing, direction: owner.playing ? owner.playbackDirection : 0, rate: owner.playbackRate ?? 1, scrubbing: !!evidence.scrubbing })
}
export async function pauseVideoExplanation(id: string, focus = false): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime || runtime.state.collector.session.state !== 'recording') return
  if (runtime.pausing) return runtime.pausing
  if (runtime.state.busy && !runtime.state.microphone) { runtime.state.controller.abort(); return }
  const state = runtime.state; state.busy = true; publish()
  runtime.pausing = Promise.resolve().then(async () => { await state.microphone?.stop(); state.microphone = undefined; await getPlatform().audioEdit.recording.microphone(false, state.collector.session.consent!.userReceiptRef); sealAudio(owner, runtime); state.collector.pause(now(state), focus); await flushWrites(runtime); await state.collector.flush(); installHead(owner, state); await saveVideoEdit(id) })
  try { await runtime.pausing }
  finally { runtime.pausing = undefined; state.busy = false; publish() }
}
export async function resumeVideoExplanation(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime) throw new Error('请先打开保存的讲解。')
  const state = runtime.state; if (state.busy || state.collector.session.retentionStatus === 'deleted') throw new Error('当前讲解不能继续录制，请开始新的讲解。')
  await flushWrites(runtime); state.busy = true; state.message = undefined; state.controller = new AbortController(); state.picture = undefined; runtime.geometry = undefined; runtime.viewKey = undefined; runtime.lastBlock = undefined
  state.collector.resume(now(state)); publish()
  try { await openMicrophone(owner, runtime); installHead(owner, state) }
  catch (error) { state.collector.pause(now(state)); state.message = '麦克风仍不可用，请检查权限或设备。'; throw error }
  finally { state.busy = false; publish() }
}
export async function stopVideoExplanation(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime || runtime.state.erased) return
  const state = runtime.state
  if (['reviewing','submitted','cancelled','idle'].includes(state.collector.session.state)) return
  await runtime.pausing
  if (state.collector.session.state === 'transcribing') await getPlatform().audioEdit.recording.cancel(state.collector.session.id)
  await state.microphone?.stop(); state.microphone = undefined; await getPlatform().audioEdit.recording.microphone(false, state.collector.session.consent!.userReceiptRef); sealAudio(owner, runtime); if (state.collector.session.state === 'recording') state.collector.pause(now(state)); await flushWrites(runtime); state.collector.stop(now(state)); await state.collector.flush(); installHead(owner, state)
  await freezeFinalRecordingPoses(owner, state); installHead(owner, state); await saveVideoEdit(id); state.busy = false; publish()
  logger.info('录制讲解结束', { event: 'explanation.capture.completed', context: { documentId: id } })
}
async function freezeFinalRecordingPoses(owner: VideoEditInstance, state: VideoExplanationState): Promise<void> {
  const sequence = getActiveVideoEditSequence(owner); const frame = owner.frame
  state.reviewComposition = sequence
  const clips = new Map(sequence.clips.map(clip => [`${owner.document.id}:${clip.id}`, clip])); const targets = new Map<string, ApplicationRef>()
  for await (const page of pages(owner, state.collector.session)) if (page.kind !== 'clock' && page.kind !== 'samples') for (const event of page.entries) {
    const refs = event.kind === 'command' ? event.targets : event.kind === 'delta' ? event.changes.map(c => c.targetRef) : event.kind === 'pointer' ? [...event.pointedRefs, ...event.selectedRefs] : []
    for (const ref of refs) if (ref.kind === 'video_edit.clip' && clips.has(ref.id)) targets.set(ref.id, ref)
  }
  const stateDigest = await motionDigest([sequence, frame])
  state.collector.session.finalPoseRefs = [...targets.values()].map(targetRef => ({ targetRef, pose: motionClipPose(clips.get(targetRef.id)!, frame), stateDigest }))
}
async function* pages(owner: VideoEditInstance, session: ExplanationSession, kind?: CreativeIntentPage['kind']): AsyncGenerator<CreativeIntentPage> {
  const resources = new Map(head(owner).resources.map(r => [r.resourceId, r]))
  for (const ref of session.pages.filter(r => !kind || r.kind === kind).sort((a, b) => a.monoSpanUs[0] - b.monoSpanUs[0] || a.seqSpan[0] - b.seqSpan[0])) {
    const resource = resources.get(ref.resourceId)
    if (!resource || resource.digest !== ref.digest || resource.bytes !== ref.bytes) throw new Error('讲解页缺失，请恢复原文件。')
    const page = creativeIntentPageSchema.parse(await readMotionResource(resource))
    if (page.ownerRef.kind !== session.ownerRef.kind || page.ownerRef.id !== owner.document.id || page.sourceDigest !== session.sourceDigest || page.kind !== ref.kind || page.count !== ref.count || JSON.stringify(page.seqSpan) !== JSON.stringify(ref.seqSpan) || JSON.stringify(page.monoSpanUs) !== JSON.stringify(ref.monoSpanUs)) throw new Error('讲解页归属或内容不符。')
    if (page.kind !== 'clock') for (const entry of page.entries) { if (clockEventIssue(entry, session.clockSegments)) throw new Error('讲解事件的时间与呈现证据不符。') }
    yield page
  }
}
/** Expand only the audio block's receipts. Sparse header endpoints never stand in for playback frames. */
async function clockReceipts(owner: VideoEditInstance, session: ExplanationSession, span: [number, number]): Promise<ClockSegment[]> {
  const clocks = session.clockSegments.filter(c => c.monoSpanUs[1] >= span[0] && c.monoSpanUs[0] <= span[1]).map(c => ({ ...structuredClone(c), anchors: c.anchors.slice(0, 1) }))
  const byId = new Map(clocks.map(c => [c.id, c]))
  const selection = { ...session, pages: session.pages.filter(p => p.kind === 'timeline' && p.monoSpanUs[0] <= span[1] && p.monoSpanUs[1] >= Math.min(...clocks.map(c => c.monoSpanUs[0]))) }
  for await (const page of pages(owner, selection, 'timeline')) {
    if (page.kind !== 'timeline') continue
    for (const entry of page.entries) {
      const clock = byId.get(entry.clockSegmentRef); if (!clock) continue
      clock.anchors.push({ monoUs: entry.monoUs, presentedFrame: entry.timeline?.frame ?? null, requestedFrame: entry.requestedFrame, sequenceRef: entry.timeline?.sequenceRef ?? null, visitRef: entry.timeline?.visitRef ?? null, playbackDirection: clock.anchors[0]?.playbackDirection ?? 0, playbackRate: entry.playbackRate ?? 1, playing: clock.mode === 'play', epoch: 0, uncertaintyUs: 0 })
    }
  }
  for (const clock of clocks) clock.anchors.sort((a, b) => a.monoUs - b.monoUs)
  return clocks
}
export async function preflightVideoExplanation(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const state = states.get(owner)?.state
  if (!state || state.busy || !['reviewing', 'recoverable'].includes(state.collector.session.state)) throw new Error('请先结束录制。')
  const session = state.collector.session
  const modelId = session.asr?.moduleId ?? modelDefaultsManager.resolveTranscriptionModelId()
  if (session.retentionStatus === 'retained' && session.audio) await restoreRetainedAudio(owner, session)
  const completed = new Set<string>()
  for await (const page of pages(owner, session, 'transcript')) if (page.kind === 'transcript') for (const entry of page.entries) completed.add(entry.audioSegmentRef)
  for await (const page of pages(owner, session, 'audio')) if (page.kind === 'audio') for (const audio of page.entries) {
    if (completed.has(audio.audioSegmentRef)) continue
    await getPlatform().audioEdit.recording.preflight({ action: 'preflight', sessionId: session.id, chunkId: audio.audioSegmentRef, requestId: audio.audioSegmentRef, modelId, resume: session.state === 'recoverable' })
    assertCurrent(owner, state)
  }
}
export async function transcribeVideoExplanation(id: string, audioUploadReceipt: string, resume = false): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime) throw new Error('请先打开讲解。')
  const state = runtime.state; const session = state.collector.session
  if (!['reviewing', 'recoverable'].includes(session.state) || state.busy) throw new Error('请先结束录制。')
  if (!audioUploadReceipt) throw new Error('请先确认音频外发与转写费用。')
  const transcription = new AbortController(); runtime.transcription = transcription
  const abort = (): void => transcription.abort()
  state.controller.signal.addEventListener('abort', abort, { once: true })
  if (state.controller.signal.aborted) abort()
  const modelId = session.asr?.moduleId ?? modelDefaultsManager.resolveTranscriptionModelId(); const providerId = modelId.split('.')[0]
  session.asr = { moduleId: modelId, providerId, granularity: session.asr?.granularity ?? 'segment' }
  session.consent = { ...session.consent!, audioUpload: true, transcriptionProvider: providerId }; session.state = 'transcribing'; state.busy = true; installHead(owner, state); publish()
  try {
    if (session.retentionStatus === 'retained' && session.audio) await restoreRetainedAudio(owner, session)
    const alignedIds = new Set<string>()
    for await (const page of pages(owner, session, 'transcript')) if (page.kind === 'transcript') for (const entry of page.entries) alignedIds.add(entry.audioSegmentRef)
    let hasPendingAudio = false
    for await (const page of pages(owner, session, 'audio')) if (page.kind === 'audio' && page.entries.some(audio => !alignedIds.has(audio.audioSegmentRef))) { hasPendingAudio = true; break }
    if (hasPendingAudio) await withPaidOperation({ category: 'recognition', documentId: id, title: '转写讲解录音', message: '将录音发送给已配置的转写模型，按模型计费。此次只发送录音。' }, async () => {
    for await (const page of pages(owner, session, 'audio')) {
      if (page.kind !== 'audio') continue
      for (const audio of page.entries) {
        if (alignedIds.has(audio.audioSegmentRef)) continue
        assertCurrent(owner, state); transcription.signal.throwIfAborted()
        if (session.state !== 'transcribing') throw new Error('讲解转写已取消。')
        const result = await getPlatform().audioEdit.recording.transcribe({ action: 'transcribe', sessionId: session.id, chunkId: audio.audioSegmentRef, modelId, requestId: audio.audioSegmentRef, audioUploadReceipt, resume })
        assertCurrent(owner, state)
        if (session.state !== 'transcribing') throw new Error('讲解转写已取消。')
        const aligned = alignRecordingTranscript(result.transcript, audio, await clockReceipts(owner, session, audio.monoSpanUs), state.collector.nextSeq, suffix => `${audio.audioSegmentRef}/${suffix}`)
        for (const entry of aligned.entries) state.collector.append(transcriptEventSchema.parse(entry))
        if (aligned.untimed.length) state.message = '部分文字没有时间信息，请人工确认对应画面。'
        // Later coarse chunks must not erase the actual finer granularity already present.
        if (session.asr) session.asr.granularity = session.asr.granularity === 'word' || aligned.entries.some(e => e.granularity === 'word') ? 'word' : session.asr.granularity === 'character' || aligned.entries.some(e => e.granularity === 'character') ? 'character' : 'segment'
        await state.collector.flush(); installHead(owner, state); await saveVideoEdit(id)
      }
    }
    }, transcription.signal)
    session.state = 'reviewing'; installHead(owner, state); await saveVideoEdit(id)
  } catch (error) { if (!state.erased) { session.state = 'recoverable'; state.message = '转写未完成，已保留原稿；可查询原任务继续。'; installHead(owner, state) } throw error }
  finally { state.controller.signal.removeEventListener('abort', abort); runtime.transcription = undefined; state.busy = false; publish() }
}
export async function cancelVideoExplanationTranscription(id: string): Promise<void> {
  const runtime = states.get(requireVideoEditInstance(id)); if (!runtime) return
  const state = runtime.state; runtime.transcription?.abort()
  state.collector.session.state = 'recoverable'; await getPlatform().audioEdit.recording.cancel(state.collector.session.id); publish()
}
export async function readVideoExplanationPage(id: string, pageIndex: number): Promise<ExplanationEvent[]> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state) return []
  const ref = state.collector.session.pages.filter(p => p.kind === 'transcript')[pageIndex]; if (!ref) return []
  const resource = head(owner).resources.find(r => r.resourceId === ref.resourceId); if (!resource) throw new Error('词稿页缺失。')
  const page = creativeIntentPageSchema.parse(await readMotionResource(resource)); if (page.kind !== 'transcript') return []
  const values = page.entries.filter(e => e.source !== 'user')
  const substitutions = new Map<string, TranscriptEntry>(); const wanted = new Set(values.map(e => e.eventId))
  const correctionIds = new Map(state.collector.session.corrections.filter(value => wanted.has(value.originalEventRef)).map(value => [value.originalEventRef, value.correctedEventRef]))
  if (correctionIds.size) for await (const candidate of pages(owner, state.collector.session, 'transcript')) if (candidate.kind === 'transcript') for (const corrected of candidate.entries) {
    if (corrected.originalEventRef && correctionIds.get(corrected.originalEventRef) === corrected.eventId) substitutions.set(corrected.originalEventRef, corrected)
  }
  assertCurrent(owner, state)
  return values.map(entry => substitutions.get(entry.eventId) ?? entry)
}
function registerBodyEditor(owner: VideoEditInstance, runtime: Runtime): void {
  const id = owner.document.id, state = runtime.state
  runtime.releaseBody?.()
  runtime.releaseBody = registerExplanationBodyEditor(explanationBodyRef({ kind: 'video_edit.document', id }, state.collector.session.id), {
    apply: (changes, context) => applyVideoExplanationBody(id, changes, context),
    restore: async (session, context) => {
      assertCurrent(owner, state)
      if (!head(owner).sessions.some(s => s.id === session.id)) throw new Error('讲解已删除，不能恢复私密正文。')
      Object.assign(state.collector.session, structuredClone(session)); installHead(owner, state); if (!context?.persistenceScopes) await saveVideoEdit(id); publish()
    },
  })
}
export async function correctVideoExplanationText(id: string, entry: TranscriptEntry, text: string): Promise<void> {
  const state = videoExplanationState(requireVideoEditInstance(id)); if (!state) throw new Error('请先打开讲解。')
  await writeExplanationBody(explanationBodyRef({ kind: 'video_edit.document', id }, state.collector.session.id), { text: [{ eventId: entry.eventId, text }] })
}
async function applyVideoExplanationBody(id: string, changes: ExplanationBodyChanges, context?: ApplicationExecutionContext): Promise<void> {
  const owner = requireVideoEditInstance(id), runtime = states.get(owner)
  if (!runtime || runtime.state.busy || !['reviewing', 'recoverable'].includes(runtime.state.collector.session.state)) throw new Error('请先结束录制或转写。')
  await enqueue(runtime, async () => {
    const state = runtime.state, session = state.collector.session
    const current: TranscriptEntry[] = []
    for (let index = 0; ; index++) { const page = await readVideoExplanationPage(id, index); if (!page.length && !session.pages.filter(p => p.kind === 'transcript')[index]) break; current.push(...page.filter((event): event is TranscriptEntry => event.kind === 'transcript')) }
    const edits = changes.text?.map(edit => { const original = current.find(e => e.eventId === edit.eventId); if (!original) throw new Error('词稿已经校正，请重新读取。'); return { original, text: edit.text } }) ?? []
    for (const { original, text } of edits) {
      const originalEventRef = original.originalEventRef ?? original.eventId
      const corrected = transcriptEventSchema.parse({ ...original, seq: state.collector.nextSeq, eventId: crypto.randomUUID(), text, source: 'user', originalEventRef })
      session.corrections = [...session.corrections.filter(c => c.originalEventRef !== originalEventRef), { originalEventRef, correctedEventRef: corrected.eventId }]; state.collector.append(corrected)
    }
    await state.collector.flush()
    if (changes.bindings) {
      for (const binding of changes.bindings) {
        if (session.bindings.some(existing => sameExplanationBinding(existing, binding))) continue
        const entry = current.find(e => binding.utteranceIds.includes(e.utteranceId))
        if (!entry) throw new Error('绑定对应的词稿已变化。')
        await applyVideoExplanationBinding(id, entry, binding)
      }
      session.bindings = structuredClone(changes.bindings)
    }
    assertCurrent(owner, state); installHead(owner, state)
    // Video persistence participates in the enclosing generic transaction.
    if (!context?.persistenceScopes) await saveVideoEdit(id)
    publish()
  })
}
export interface VideoExplanationReviewData { resolution: DeixisResolution; plan: IntentDifferencePlan; image?: Uint8Array; imagePoint?: [number, number]; objects?: { ref: ApplicationRef; label: string; corners?: [number, number][] }[] }
/** Verify and read only the indexed sentence/evidence pages; no session-wide materialization. */
async function explanationSentence(owner: VideoEditInstance, state: VideoExplanationState, entry: TranscriptEntry): Promise<{ entries: TranscriptEntry[]; events: ExplanationEvent[] }> {
  const session = state.collector.session; const entries: TranscriptEntry[] = []; const events: ExplanationEvent[] = []
  // A sentence can cross page boundaries: scan transcript pages sequentially with no sentence-size cutoff.
  for await (const page of pages(owner, session, 'transcript')) if (page.kind === 'transcript') for (const value of page.entries) if (value.utteranceId === entry.utteranceId) entries.push(value)
  const originals = entries.filter(value => value.source !== 'user')
  const corrections = new Map(session.corrections.map(value => [value.originalEventRef, value.correctedEventRef]))
  const byId = new Map(entries.map(value => [value.eventId, value]))
  const latest = originals.map(value => byId.get(corrections.get(value.eventId) ?? '') ?? value)
  if (!latest.some(value => value.eventId === entry.eventId)) throw new Error('词稿已经校正或删除，请重新选择')
  const bounds = latest.reduce<[number, number]>((span, value) => [Math.min(span[0], value.monoSpanUs[0]), Math.max(span[1], value.monoSpanUs[1])], [Infinity, 0])
  const start = Math.max(0, bounds[0] - 800_000); const end = bounds[1] + 250_000
  const evidenceHead = { ...session, pages: session.pages.filter(page => !['transcript', 'samples', 'clock', 'audio'].includes(page.kind) && page.monoSpanUs[0] <= end && page.monoSpanUs[1] >= start) }
  for await (const page of pages(owner, evidenceHead)) if (page.kind !== 'clock' && page.kind !== 'samples') events.push(...page.entries.filter(value => value.monoUs >= start && value.monoUs <= end))
  assertCurrent(owner, state)
  return { entries: latest, events }
}
export async function readVideoExplanationReview(id: string, entry: TranscriptEntry, mentionId?: string, includeImage = true): Promise<VideoExplanationReviewData> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state) throw new Error('请先打开讲解')
  const { entries, events } = await explanationSentence(owner, state, entry)
  const resolution = resolveDeixis(entries, events, state.collector.session.clockSegments, state.collector.session.bindings)
  const goals: ReviewedIntentGoal[] = []
  const target = resolution.mentions.find(mention => mention.slot === 'target') ?? resolution.mentions.find(mention => mention.slot === 'source')
  const destination = resolution.mentions.find(mention => mention.slot === 'destination')
  if (!resolution.negated && /移|放|从.*到/.test(resolution.text) && target?.selected?.targetRefs.length === 1 && destination?.selected) goals.push({ targetRef: target.selected.targetRefs[0], property: 'position', value: destination.selected.point, confirmed: target.confirmedByUser && destination.confirmedByUser })
  const sequence = getActiveVideoEditSequence(owner); const frame = owner.frame; const digest = await motionDigest([sequence, frame])
  const current = sequence.clips.map(clip => ({ targetRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}`, label: clip.name }, pose: motionClipPose(clip, frame), stateDigest: digest }))
  const plan = buildIntentDifferencePlan([resolution], goals, current, events)
  // Confirmation is a property of each reference, even while another reference is ambiguous.
  if (!resolution.negated && /移|放|从.*到/.test(resolution.text) && resolution.mentions.some(mention => ['target', 'source', 'destination'].includes(mention.slot) && !mention.confirmedByUser)) {
    plan.changes = []; plan.status = 'blocked'
    if (!plan.issues.includes('差异目标尚未确认')) plan.issues.push('差异目标尚未确认')
  }
  if (!resolution.negated && !goals.length && plan.status !== 'blocked') { plan.status = 'blocked'; plan.issues.push('这句尚未形成完整的差异目标，请补充并确认') }
  const inspected = resolution.mentions.find(mention => mention.id === mentionId) ?? resolution.mentions.find(mention => mention.entries.some(value => value.eventId === entry.eventId)) ?? resolution.mentions[0]
  const chosen = inspected?.selected ?? inspected?.candidates[0]
  const visual = state.collector.session.visualEvidenceRefs.find(value => value.frames.some(frame => chosen?.evidenceSeqs.includes(frame.seq)))
  const resource = visual && head(owner).resources.find(value => value.resourceId === visual.resourceRef.resourceId)
  const image = includeImage && resource ? await readMotionResourceBytes(resource) : undefined
  assertCurrent(owner, state)
  const tracks = sequence.tracks.filter(track => track.kind === 'video').sort((a, b) => a.index - b.index)
  const refs = [...new Map(resolution.mentions.flatMap(mention => [...(mention.selected?.targetRefs ?? []), ...mention.candidates.flatMap(candidate => candidate.targetRefs)]).map(ref => [ref.id, ref])).values()]
  const historicalFrame = chosen?.timeline?.frame ?? frame
  const historical = visual?.frames.find(value => chosen?.evidenceSeqs.includes(value.seq))
  const frozen = state.reviewComposition?.id === sequence.id ? state.reviewComposition : state.picture?.sequenceId === sequence.id ? state.picture.composition : sequence
  const historicalPoses = new Map(refs.flatMap(ref => {
    const clip = frozen.clips.find(c => ref.id === `${id}:${c.id}`)
    return clip ? [[ref.id, motionClipPose(clip, historicalFrame)] as const] : []
  }))
  const restored = new Set<string>(), unavailable = new Set<string>()
  if (includeImage && historical) {
    const after = { ...state.collector.session, pages: state.collector.session.pages.filter(page => page.kind === 'delta' && page.monoSpanUs[1] > historical.monoUs) }
    // Read sealed deltas page by page; reconstruct geometry, never replay an operation.
    for await (const page of pages(owner, after, 'delta')) if (page.kind === 'delta') for (const event of page.entries) if (event.monoUs > historical.monoUs) for (const change of event.changes) {
      const pose = historicalPoses.get(change.targetRef.id), key = `${change.targetRef.id}:${change.property}`
      if (!pose || restored.has(key)) continue
      if (event.timeline?.frame !== historicalFrame) { unavailable.add(change.targetRef.id); continue }
      Object.assign(pose, { [change.property]: change.before }); restored.add(key)
    }
  }
  const verified = includeImage && (!!state.reviewComposition || !!state.picture || !!historical && historical.stateDigest === await motionDigest([sequence, historicalFrame]))
  const objects = refs.flatMap(ref => {
    const clip = sequence.clips.find(c => ref.id === `${id}:${c.id}`); if (!clip) return []
    const duplicates = sequence.clips.filter(c => c.name === clip.name)
    const track = `V${tracks.findIndex(t => t.index === clip.track) + 1}`
    const sameTrack = duplicates.filter(c => c.track === clip.track).sort((a, b) => a.start - b.start)
    const label = duplicates.length > 1 ? `${clip.name} · ${track}${sameTrack.length > 1 ? ` · 第 ${sameTrack.findIndex(c => c.id === clip.id) + 1} 段` : ''}` : clip.name
    const capturedClip = frozen.clips.find(c => c.id === clip.id) ?? clip
    const pose = historicalPoses.get(ref.id) ?? motionClipPose(capturedClip, historicalFrame), placed = { ...capturedClip, x: pose.position[0] - .5, y: pose.position[1] - .5, scale: pose.scaleXY[0], rotation: pose.rotationTurns * 360, anchorX: pose.pivot[0], anchorY: pose.pivot[1] }
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]): [number, number] => { const point = videoEditClipToFrame(placed, videoEditClipPictureSize(frozen, capturedClip), frozen, u, v); return [point.x, point.y] })
    return [{ ref, label, corners: verified && !unavailable.has(ref.id) ? corners : undefined }]
  })
  assertCurrent(owner, state)
  if (owner.playing || owner.frame !== frame || getActiveVideoEditSequence(owner) !== sequence) { plan.changes = []; plan.status = 'blocked'; plan.issues.push('当前画面状态已改变，请暂停播放后重新确认差异') }
  return { resolution, plan, image, imagePoint: visual?.frames.find(frame => chosen?.evidenceSeqs.includes(frame.seq))?.pointer ?? undefined, objects }
}
export async function prepareVideoExplanationGeneration(id: string): Promise<ExplanationSendRequest | undefined> {
  const owner = requireVideoEditInstance(id), runtime = states.get(owner)
  if (!runtime) return undefined
  const state = runtime.state
  await runtime.generation?.cancel()
  runtime.generation = await prepareExplanationGeneration({ documentRef: { kind: 'video_edit.document', id },
    session: () => videoExplanationState(owner)?.collector.session,
    drafts: () => head(owner).drafts,
    read: async resourceId => { const resource = head(owner).resources.find(r => r.resourceId === resourceId); if (!resource) throw new Error('讲解页已删除。'); return readMotionResource(resource) },
    consent: async consent => { assertCurrent(owner, state); state.collector.session.consent = consent; installHead(owner, state); await saveVideoEdit(id); publish() },
    assertCurrent: () => assertCurrent(owner, state),
  })
  return runtime.generation.request
}
export async function runVideoExplanationGeneration(id: string, local: () => Promise<void>): Promise<void> {
  const runtime = states.get(requireVideoEditInstance(id)), generation = runtime?.generation
  if (runtime) runtime.generation = undefined
  if (generation) await generation.run(local)
  else await local()
}
export async function generateVideoExplanationCandidates(id: string, entries: readonly TranscriptEntry[]): Promise<void> {
  return runVideoExplanationGeneration(id, () => generateVideoExplanationCandidatesLocally(id, entries))
}
async function generateVideoExplanationCandidatesLocally(id: string, entries: readonly TranscriptEntry[]): Promise<void> {
  await clearTemporaryVideoExplanationAudio(id)
  const reviews: VideoExplanationReviewData[] = []
  for (const entry of entries) reviews.push(await readVideoExplanationReview(id, entry, undefined, false))
  reviewedMovementChanges(reviews.map(review => review.plan))
  const protectedRefs = reviews.flatMap(review => review.plan.protectedRefs)
  // The existing editor focuses one draft. Preserve all generated drafts and open the last,
  // rather than imposing a limit on the number of instructions in the transcript.
  for (const [index, review] of reviews.entries()) if (review.plan.changes.length) {
    const movement = await readVideoExplanationReview(id, entries[index], undefined, false)
    const source = movement.resolution.mentions.find(mention => mention.slot === 'source' || mention.slot === 'target')?.selected
    const destination = movement.resolution.mentions.find(mention => mention.slot === 'destination')?.selected
    const frame = requireVideoEditInstance(id).frame
    await proposeVideoExplanationMotion(id, [{ ...movement.plan, protectedRefs }], [source?.timeline?.frame ?? frame, destination?.timeline?.frame ?? frame])
  }
}
export async function correctVideoExplanationBinding(id: string, entry: TranscriptEntry, binding: ExplanationBinding): Promise<void> {
  const state = videoExplanationState(requireVideoEditInstance(id)); if (!state) throw new Error('请先打开讲解。')
  const session = state.collector.session
  await writeExplanationBody(explanationBodyRef({ kind: 'video_edit.document', id }, session.id), { bindings: [...session.bindings.filter(b => b.id !== binding.id), binding] })
}
async function applyVideoExplanationBinding(id: string, entry: TranscriptEntry, binding: ExplanationBinding): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner)
  if (!runtime || runtime.state.busy || !['reviewing', 'recoverable'].includes(runtime.state.collector.session.state)) throw new Error('请等待录制或转写结束')
  const review = await readVideoExplanationReview(id, entry); const mention = review.resolution.mentions.find(value => value.id === binding.id)
  const candidate = binding.evidenceSeqs.length ? mention?.candidates.find(value => binding.evidenceSeqs.every(seq => value.evidenceSeqs.includes(seq)) && binding.point?.every((point, index) => point === value.point[index])) : undefined
  if (!mention || !candidate && (binding.evidenceSeqs.length || !binding.point)) throw new Error('原指向已改变，请重新选择')
  for (const ref of binding.targetRefs) if (ref.kind !== 'video_edit.clip' || !getActiveVideoEditSequence(owner).clips.some(clip => ref.id === `${id}:${clip.id}`)) throw new Error('所选对象已不存在。')
  const validated = candidate ? confirmedExplanationBinding(mention, candidate, binding.targetRefs[0]) : pickedExplanationBinding(mention, binding.targetRefs, binding.point!)
  if (!sameExplanationBinding(validated, binding)) throw new Error('绑定必须来自完整历史候选')
  assertCurrent(owner, runtime.state)
  const session = runtime.state.collector.session
  session.bindings = [...session.bindings.filter(value => value.id !== binding.id), validated]
}
export async function* videoExplanationJsonl(id: string): AsyncGenerator<string> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state) throw new Error('请先打开讲解。')
  const session = structuredClone(state.collector.session); const sequence = getActiveVideoEditSequence(owner)
  const finalClips = new Map(sequence.clips.map(clip => [`${id}:${clip.id}`, { ...motionClipPose(clip, owner.frame), atFrame: owner.frame }]))
  // Bounded merge: one page per kind; historical transcripts retain their original wall time.
  const kinds = [...new Set(session.pages.map(p => p.kind))].filter(k => k !== 'clock' && k !== 'samples')
  const streams = kinds.map(kind => (async function* (): AsyncGenerator<ExplanationEvent> {
    for await (const page of pages(owner, session, kind)) if (page.kind !== 'clock' && page.kind !== 'samples') {
      const originals = page.entries.filter(e => e.kind !== 'transcript' || e.source !== 'user')
      const substitutions = new Map<string, TranscriptEntry>()
      if (kind === 'transcript' && session.corrections.length) {
        const wanted = new Set(originals.map(e => e.eventId)); const correctionIds = new Set(session.corrections.filter(c => wanted.has(c.originalEventRef)).map(c => c.correctedEventRef))
        for await (const correctedPage of pages(owner, session, 'transcript')) if (correctedPage.kind === 'transcript') for (const corrected of correctedPage.entries) if (corrected.originalEventRef && correctionIds.has(corrected.eventId)) substitutions.set(corrected.originalEventRef, corrected)
      }
      for (const event of originals) { const correction = substitutions.get(event.eventId); yield correction ? { ...correction, seq: event.seq } : event }
    }
  })())
  const cursors = await Promise.all(streams.map(stream => stream.next()))
  const merged = (async function* (): AsyncGenerator<ExplanationEvent> {
  while (cursors.some(c => !c.done)) {
    let chosen = -1
    cursors.forEach((cursor, i) => { if (!cursor.done && (chosen < 0 || cursor.value.monoUs < cursors[chosen].value!.monoUs || cursor.value.monoUs === cursors[chosen].value!.monoUs && cursor.value.seq < cursors[chosen].value!.seq)) chosen = i })
    yield cursors[chosen].value!; cursors[chosen] = await streams[chosen].next()
  }
  })()
  for await (const line of serializeRecordingInput(session, merged, { size: [sequence.width, sequence.height], finalState: ref => ref.kind === 'video_edit.clip' ? finalClips.get(ref.id) : undefined })) { assertCurrent(owner, state); yield line }
}
export async function reopenVideoExplanation(id: string, sessionId: string): Promise<void> {
  const owner = requireVideoEditInstance(id); if (!head(owner).sessions.some(s => s.id === sessionId)) throw new Error('讲解不存在。')
  const existing = states.get(owner); if (existing?.state.erased || existing?.state.busy || existing?.state.collector.session.state === 'recording' || existing?.state.collector.session.state === 'paused' && existing.state.collector.session.id !== sessionId) throw new Error('请先结束当前录制。')
  if (existing && existing.state.collector.session.id !== sessionId) {
    existing.state.busy = true; publish()
    try { await clearTemporaryVideoExplanationAudio(id); assertCurrent(owner, existing.state) }
    finally { existing.state.busy = false; publish() }
  }
  const session = head(owner).sessions.find(s => s.id === sessionId); if (!session) throw new Error('讲解不存在。')
  existing?.release()
  const elapsedUs = Math.max(session.clockSegments.at(-1)?.monoSpanUs[1] ?? 0, existing?.state.collector.session.id === sessionId ? now(existing.state) : 0)
  const state: VideoExplanationState = { collector: undefined as unknown as RecordingCollector, originMs: performance.now() - elapsedUs / 1000, elapsedUs, busy: false, erased: false, controller: new AbortController(), uncertaintyUs: [] }
  if (existing?.state.collector.session.id === sessionId) state.reviewComposition = existing.state.reviewComposition
  state.collector = new RecordingCollector(session, async page => { const resource = await storeMotionResource(id, page, 'page'); if (state.erased) { await getPlatform().system.fs.remove(resource.path); return } state.collector.session.pages.push(motionPageRef(resource, page)); installHead(owner, state, resource) }, message => { state.message = message; publish() })
  if (['recording', 'paused', 'transcribing'].includes(state.collector.session.state)) state.collector.session.state = 'recoverable'
  const runtime: Runtime = { state, write: Promise.resolve(), partial: [], samples: 0, pendingAudio: new Map(), installed: true, release: () => {} }; states.set(owner, runtime)
  registerBodyEditor(owner, runtime)
  bindCapture(owner, runtime)
  publish()
}
export async function clearTemporaryVideoExplanationAudio(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state) return
  await getPlatform().audioEdit.recording.release(state.collector.session.id)
  assertCurrent(owner, state)
  if (!state.collector.session.consent?.keepAudio) { state.collector.session.retentionStatus = 'deleted'; delete state.collector.session.audio; installHead(owner, state); await saveVideoEdit(id) }
  publish()
}
async function restoreRetainedAudio(owner: VideoEditInstance, session: ExplanationSession): Promise<void> {
  const resource = head(owner).resources.find(r => r.resourceId === session.audio?.resourceId)
  if (!resource || resource.kind !== 'audio' || resource.digest !== session.audio?.digest || resource.bytes !== session.audio.bytes) throw new Error('留存录音缺失，请恢复原文件。')
  await getPlatform().audioEdit.recording.restore({ action: 'restore', sessionId: session.id, path: resource.path, digest: resource.digest, bytes: resource.bytes })
}
export async function retainVideoExplanationAudio(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state || state.busy || !['reviewing', 'recoverable'].includes(state.collector.session.state)) throw new Error('请结束录制后再留存原音。')
  if (state.collector.session.retentionStatus === 'deleted') throw new Error('原音已经删除。')
  state.busy = true; publish()
  let archived: { path: string; digest: string; bytes: number } | undefined
  try {
    archived = await getPlatform().audioEdit.recording.archive(state.collector.session.id); assertCurrent(owner, state)
    const imported = await getPlatform().documents.importFile({ container: owner.session.documentMeta.container, sourcePath: archived.path, folder: 'materials' }); assertCurrent(owner, state)
    const resource: StoredCreativeIntentResource = { resourceId: crypto.randomUUID(), kind: 'audio', path: imported.path, bytes: archived.bytes, digest: archived.digest, sourceDigest: state.collector.session.sourceDigest }
    state.collector.session.audio = { resourceId: resource.resourceId, bytes: resource.bytes, digest: resource.digest }; state.collector.session.consent!.keepAudio = true; state.collector.session.retentionStatus = 'retained'; installHead(owner, state, resource); await saveVideoEdit(id)
  } finally { if (archived) await getPlatform().system.fs.remove(archived.path); state.busy = false; publish() }
}
export async function readVideoExplanationAudio(id: string, entry: TranscriptEntry): Promise<{ bytes: Uint8Array; startSeconds: number; endSeconds: number }> {
  const owner = requireVideoEditInstance(id); const state = videoExplanationState(owner); if (!state || state.erased || state.collector.session.retentionStatus === 'deleted') throw new Error('原音已删除，不能回听。')
  if (state.collector.session.retentionStatus === 'retained') await restoreRetainedAudio(owner, state.collector.session)
  for await (const page of pages(owner, state.collector.session, 'audio')) if (page.kind === 'audio') {
    const audio = page.entries.find(a => a.audioSegmentRef === entry.audioSegmentRef)
    if (audio) return { bytes: await getPlatform().audioEdit.recording.read(state.collector.session.id, audio.audioSegmentRef), startSeconds: (entry.startSample-audio.startSample)/audio.sampleRate, endSeconds: (entry.endSample-audio.startSample)/audio.sampleRate }
  }
  throw new Error('词稿对应的录音块缺失。')
}
export async function retryVideoExplanationSave(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime || runtime.state.busy) throw new Error('请等待当前处理结束。')
  await flushWrites(runtime); await runtime.state.collector.flush(); installHead(owner, runtime.state); await saveVideoEdit(id); runtime.state.message = undefined; publish()
}
export async function eraseVideoExplanation(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id); const runtime = states.get(owner); if (!runtime) return
  const state = runtime.state; state.erased = true; state.controller.abort(); await state.microphone?.stop(); await getPlatform().audioEdit.recording.microphone(false, state.collector.session.consent!.userReceiptRef); await getPlatform().audioEdit.recording.cancel(state.collector.session.id); await runtime.write; runtime.pendingAudio.clear(); await state.collector.flush()
  const sessionId = state.collector.session.id
  const resources = purgeVideoEditExplanationSession(id, sessionId)
  eraseExplanationBody(explanationBodyRef({ kind: 'video_edit.document', id }, sessionId))
  runtime.erasePaths ??= new Set()
  for (const resource of resources) runtime.erasePaths.add(resource.path)
  await saveVideoEdit(id)
  await getPlatform().audioEdit.recording.erase(sessionId)
  for (const path of runtime.erasePaths) { await getPlatform().system.fs.remove(path); runtime.erasePaths.delete(path) }
  await runtime.generation?.cancel(); runtime.generation = undefined
  runtime.releaseBody?.(); runtime.release(); states.delete(owner); publish(); logger.info('私密讲解已删除', { event: 'explanation.erase.completed', context: { documentId: id } })
}
function recordCommand(owner: VideoEditInstance, fact: VideoEditCommandFact): void {
  const runtime = states.get(owner); if (!runtime || runtime.state.collector.session.state !== 'recording') return
  const state = runtime.state; const at = now(state); const frame = state.picture?.frame
  const sequenceId = state.picture?.sequenceId ?? owner.activeSequenceId
  const before = fact.before.sequences.find(s => s.id === sequenceId) ?? { clips: [], annotations: [] }; const after = fact.after.sequences.find(s => s.id === sequenceId) ?? { clips: [], annotations: [] }
  const oldClips = new Map(before.clips.map(clip => [clip.id, clip]))
  const changes: Extract<ExplanationEvent, { kind: 'delta' }>['changes'] = []
  for (const clip of after.clips) { const old = oldClips.get(clip.id); if (!old || frame === undefined) continue; const a = motionClipPose(old, frame); const b = motionClipPose(clip, frame)
    for (const property of ['position', 'rotationTurns', 'scaleXY', 'pivot'] as const) if (JSON.stringify(a[property]) !== JSON.stringify(b[property])) changes.push({ targetRef: { kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }, property, before: a[property], after: b[property] }) }
  const operationRef = { kind: 'video_edit.operation', id: fact.operationId }
  const commandBase = state.collector.reserve(at); if (!commandBase) return
  const deltaBase = changes.length && fact.phase !== 'cancelled' && fact.phase !== 'failed' ? state.collector.reserve(at) : undefined
  const marks = after.annotations.filter(mark => JSON.stringify(before.annotations.find(m => m.id === mark.id)) !== JSON.stringify(mark)).map(mark => ({ mark: structuredClone(mark), base: state.collector.reserve(at) }))
  const beforeSnapshot = { ...fact.before, creativeIntents: undefined, inPlaceGenerations: undefined, revision: 0 }
  const afterSnapshot = { ...fact.after, creativeIntents: undefined, inPlaceGenerations: undefined, revision: 0 }
  const allBefore = new Map(fact.before.sequences.flatMap(sequence => sequence.clips).map(clip => [clip.id, clip]))
  const allAfter = new Map(fact.after.sequences.flatMap(sequence => sequence.clips).map(clip => [clip.id, clip]))
  const affected = [...new Set([...allBefore.keys(), ...allAfter.keys()])].filter(id => JSON.stringify(allBefore.get(id)) !== JSON.stringify(allAfter.get(id)))
  void enqueue(runtime, async () => {
    if (state.erased) return
    const beforeDigest = await motionDigest(beforeSnapshot); const afterDigest = await motionDigest(afterSnapshot)
    // Undo/redo identities belong to the formal history, including operations before capture.
    state.collector.append(recordingCommandEvent(commandBase, { operationRef, phase: fact.phase, ...(fact.relatedOperationId ? { relatedOperationRef: { kind: 'video_edit.operation', id: fact.relatedOperationId } } : {}), targets: [...affected].map(clip => ({ kind: 'video_edit.clip', id: `${owner.document.id}:${clip}` })), beforeDigest, afterDigest: fact.phase === 'cancelled' || fact.phase === 'failed' ? beforeDigest : afterDigest }))
    if (deltaBase) state.collector.append({ ...deltaBase, kind: 'delta', operationRef, changes })
    for (const { mark, base } of marks) { if (!base) continue; const annotationRef = { kind: 'video_edit.annotation', id: `${owner.document.id}:${mark.id}` }; if (!state.collector.session.annotationRefs.some(r => r.id === annotationRef.id)) state.collector.session.annotationRefs.push(annotationRef); state.collector.append({ ...base, kind: 'annotation', annotationRef, snapshotDigest: await motionDigest(mark), role: 'note', timelineSpans: [] }) }
  }).catch(() => { state.message = '操作记录尚未保存，请结束后重试保存。'; publish() })
}
function explanationPointRefs(owner: VideoEditInstance, sequence: VideoEditComposition, frame: number, point: [number, number]): ApplicationRef[] {
  const refs: ApplicationRef[] = []
  for (const clip of [...activeVideoEditClips(sequence, frame)].reverse()) {
    if (clip.kind === 'audio' || clip.kind === 'adjustment') continue
    const pose = motionClipPose(clip, frame)
    const source = videoEditFrameToClip({ ...clip, x: pose.position[0] - .5, y: pose.position[1] - .5, anchorX: pose.pivot[0], anchorY: pose.pivot[1], scale: pose.scaleXY[0], rotation: pose.rotationTurns * 360 }, videoEditClipPictureSize(sequence, clip), sequence, point[0], point[1])
    if (source.u >= 0 && source.u <= 1 && source.v >= 0 && source.v <= 1) refs.push({ kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}`, ...(clip.name ? { label: clip.name.slice(0, 200) } : {}) })
  }
  return refs
}

/** User correction observes one canvas click; it does not replay recorded actions or seek. */
export function pickVideoExplanationBinding(owner: VideoEditInstance, entry: TranscriptEntry, mention: DeicticMention, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const root = document
    const cleanup = (): void => { root.removeEventListener('pointerdown', point, true); signal.removeEventListener('abort', cancel) }
    const cancel = (): void => { cleanup(); resolve() }
    const point = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-observation-sensitive],button,input,textarea,select')) return
      const monitor = target.closest<HTMLElement>('[data-video-edit-program-display]')
      if (!monitor) return
      if (owner.playing) { cleanup(); reject(new Error('请暂停播放后点选。')); return }
      const presented = monitor.querySelector<HTMLCanvasElement>('canvas[aria-label="剪辑画面"]')
      if (!presented || presented.dataset.presentedFrame !== String(owner.frame)) { cleanup(); reject(new Error('画面正在更新，请稍候再点选。')); return }
      const rect = monitor.getBoundingClientRect()
      const position: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
      if (!position.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return
      event.preventDefault(); event.stopPropagation(); cleanup()
      const object = mention.slot === 'target' || mention.slot === 'source'
      const refs = object ? explanationPointRefs(owner, getActiveVideoEditSequence(owner), owner.frame, position).slice(0, 1) : []
      try { void correctVideoExplanationBinding(owner.document.id, entry, pickedExplanationBinding(mention, refs, position)).then(resolve, reject) } catch (error) { reject(error) }
    }
    if (signal.aborted) { resolve(); return }
    root.addEventListener('pointerdown', point, true); signal.addEventListener('abort', cancel, { once: true })
  })
}

export function recordVideoExplanationPointer(owner: VideoEditInstance, event: PointerEvent, monitor: HTMLElement): void {
  const state = videoExplanationState(owner); if (!state || state.busy || state.collector.session.state !== 'recording') return
  const target = event.target as Element | null
  if (!target || typeof target.closest !== 'function' || target.closest('[data-observation-sensitive],input,textarea,[contenteditable="true"],[role="textbox"]')) return
  const rect = monitor.getBoundingClientRect(); if (!rect.width || !rect.height) return
  const point: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  const inside = point.every(v => v >= 0 && v <= 1) && (monitor.parentElement ?? monitor).contains(target)
  const picture = state.picture; const sequence = picture?.composition
  const hoverRefs = inside && picture && sequence ? explanationPointRefs(owner, sequence, picture.frame, point) : []
  const runtime = states.get(owner)!
  const pointerWindow = monitor.ownerDocument.defaultView
  const eventAt = (pointerWindow?.performance.timeOrigin ?? performance.timeOrigin) + event.timeStamp - performance.timeOrigin
  const at = Math.max(0, Math.round((eventAt - state.originMs) * 1000)); const surfaceRef = { kind: 'application.surface', id: 'workspace.video_edit' satisfies ApplicationSurfaceId }
  const geometryKey = JSON.stringify([picture?.sequenceId, picture?.frame, picture?.revision, rect.left, rect.top, rect.width, rect.height, pointerWindow?.devicePixelRatio])
  const changed = runtime.geometry?.key !== geometryKey
  const geometrySnapshotRef = changed ? crypto.randomUUID() : runtime.geometry!.id
  const geometryBase = changed ? state.collector.reserve(at) : undefined
  runtime.geometry = { key: geometryKey, id: geometrySnapshotRef }
  const pointerBase = state.collector.reserve(at); if (!pointerBase) return
  const motion = videoMotionState(owner)
  const pointer: ExplanationEvent = { ...pointerBase, kind: 'pointer', surfaceRef, geometrySnapshotRef, viewPoint: [event.clientX, event.clientY], documentPoint: inside && sequence ? [point[0] * sequence.width, point[1] * sequence.height] : null, compositionPoint: inside && picture ? point : null, hoverRefs, pointedRefs: event.type === 'pointerdown' ? hoverRefs.slice(0, 1) : [], selectedRefs: owner.selectedClipIds.map(clip => ({ kind: 'video_edit.clip', id: `${owner.document.id}:${clip}` })), intent: inside && motion?.status === 'recording' && motion.mode === 'demonstrate' ? 'demonstrate' : 'navigate', phase: event.type === 'pointerdown' ? 'down' : event.type === 'pointerup' ? 'up' : event.type === 'pointercancel' ? 'cancel' : 'move', uncertaintyUs: Math.max(0, Math.round((performance.now() - eventAt) * 1000)) }
  let pixels: ReturnType<typeof captureExplanationPixels>
  try { pixels = event.type === 'pointerdown' && inside && picture && pointer.timeline ? captureExplanationPixels(monitor, picture.frame) : undefined }
  catch { state.message = '指向画面保存失败，请结束后重试保存。'; publish() }
  void pixels?.catch(() => {}) // Observe early rejection; queued write below still reports the failure.
  void enqueue(runtime, async () => {
    if (state.erased) return
    // Freeze the acknowledged document, never hash whichever document happens to be current later.
    if (geometryBase) state.collector.append({ ...geometryBase, kind: 'geometry', snapshotRef: geometrySnapshotRef, surfaceRef, windowRef: state.collector.session.id, compositionSize: sequence ? [sequence.width, sequence.height] : [rect.width, rect.height], validViewRect: [rect.left, rect.top, rect.width, rect.height], documentToView: [rect.width / (sequence?.width ?? rect.width), 0, 0, rect.height / (sequence?.height ?? rect.height), rect.left, rect.top], ancestorAffine: [1, 0, 0, 1, 0, 0], pixelRatio: pointerWindow?.devicePixelRatio ?? 1, crop: [0, 0, sequence?.width ?? rect.width, sequence?.height ?? rect.height], orientationTurns: 0, stateDigest: await motionDigest(picture ? [picture.composition, picture.frame] : ['no-presentation', geometryKey]) })
    state.collector.append(pointer)
    if (pixels && pointer.timeline && picture) {
      const image = await pixels; if (state.erased) return
      const resource = await storeMotionResourceBytes(owner.document.id, image.bytes, 'visual', state.collector.session.sourceDigest)
      if (state.erased) { await getPlatform().system.fs.remove(resource.path); return }
      state.collector.session.visualEvidenceRefs.push({ id: crypto.randomUUID(), kind: 'frame', resourceRef: { resourceId: resource.resourceId, digest: resource.digest, bytes: resource.bytes }, size: image.size, pixelBudget: 1280 * 720, frames: [{ ...pointerBase, stateDigest: await motionDigest([picture.composition, picture.frame]), geometrySnapshotRef, sourceRefs: hoverRefs, pointer: point, reason: 'pointing', attachmentRect: [0, 0, ...image.size] }] })
      installHead(owner, state, resource)
    }
  }).catch(() => { state.message = '指向记录尚未保存，请暂停后重试。'; publish() })
}
