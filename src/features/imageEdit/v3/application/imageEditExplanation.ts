import { prepareExplanationGeneration, type PreparedExplanationGeneration, type ExplanationSendRequest } from '@/features/creativeIntent'
import { sameExplanationBinding, eraseExplanationBody, explanationBodyRef, registerExplanationBodyEditor, writeExplanationBody, type ExplanationBodyChanges } from '@/core/creativeIntent/semanticIntentEdits'
import { semanticRecordingEvents } from '@/core/creativeIntent/semanticIntentRecording'
import type { ApplicationExecutionContext } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { explanationSessionSchema, transcriptEventSchema, type ExplanationSession, type ExplanationEvent, type TranscriptEntry } from '@/core/creativeIntent/schema'
import { creativeIntentPageSchema } from '@/core/creativeIntent/pages'
import { creativeIntentsSchema, creativeIntentLiveResources, type StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
import { clockEventIssue } from '@/core/creativeIntent/contracts'
import { alignRecordingTranscript } from '@/core/creativeIntent/recordingAlignment'
import { resolveDeixis, confirmedExplanationBinding, pickedExplanationBinding, type DeicticMention, type ExplanationBinding } from '@/core/creativeIntent/deixis'
import { buildIntentDifferencePlan, type ReviewedIntentGoal } from '@/core/creativeIntent/intentPlan'
import { RecordingCollector, captureMicrophone, type CapturedAudioBlock, type MicrophoneCapture } from '@/features/creativeIntent'
import { getPlatform } from '@/platform/runtime'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { imageLayoutDigest, storeImageLayoutResource, readImageLayoutResource, releaseImageLayoutResources } from './imageEditLayoutResources'
import { imageEditV3DocumentRef, imageEditV3LayerRef, splitImageEditV3LayerRef, collectImageEditV3LiveLayers } from './imageEditDocumentRefs'
import { findImageEditDocumentInstanceV3, leaseImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { imageEditLayoutDraft } from './imageEditLayoutDraft'
import { layerToOutputV3 } from '../editor/layerPickingV3'
import { findImageEditLayerLocationV3 } from '../editor/layerTreeV3'
import { resolveAnnotationOutputGeometryV3 } from '../editor/annotationGeometryV3'
import type { ExplanationReviewProps } from '@/features/creativeIntent'
import type { ApplicationRef } from '@/core/application-control/identifiers'
import { captureImageLayoutEntries } from './imageEditLayoutGeometry'
import { reviewedMovementChanges } from '@/core/creativeIntent/intentPlan'

const logger = createLogger('features.imageEdit.explanation')
type ExplanationReviewResult = Awaited<ReturnType<ExplanationReviewProps['onRead']>>
type Pointer = Extract<ExplanationEvent, { kind: 'pointer' }>
type Geometry = Extract<ExplanationEvent, { kind: 'geometry' }>
export interface ImageExplanationPointer {
  point: [number, number] | null; viewPoint: [number, number]; documentPoint: [number, number] | null
  refs: ApplicationRef[]; selectedRefs: ApplicationRef[]; phase: Pointer['phase']
  geometry: Pick<Geometry, 'compositionSize' | 'validViewRect' | 'documentToView' | 'crop' | 'pixelRatio' | 'orientationTurns'>
  capture?: () => Promise<{ resource: StoredCreativeIntentResource; size: [number, number]; point: [number, number] } | null>
}
export interface ImageExplanationState { session?: ExplanationSession; busy: boolean; elapsedUs: number; message?: string; generation: number }
interface ExplanationPorts {
  microphone: typeof captureMicrophone; audio: ReturnType<typeof getPlatform>['audioEdit']['recording']
  store: typeof storeImageLayoutResource; read: typeof readImageLayoutResource; release: typeof releaseImageLayoutResources
  assertCurrent?: () => void
  confirmStep?: (context: ApplicationExecutionContext | undefined, settled: () => Promise<void>) => Promise<void>
  confirm: (context?: ApplicationExecutionContext) => Promise<unknown>; model: () => string | Promise<string>
  eraseResources: (resourceIds: string[]) => Promise<void>
  readVisual: (resourceId: string) => Promise<Uint8Array>
}
/** Document-owned static host. No timeline, provider, or second layout solver is introduced here. */
export class ImageEditExplanation {
  private state: ImageExplanationState = { busy: false, elapsedUs: 0, generation: 0 }
  private listeners = new Set<() => void>()
  private collector?: RecordingCollector
  private eraseResources = new Set<string>()
  private erasedSessionId?: string
  private generation?: PreparedExplanationGeneration
  private controller = new AbortController()
  private microphone?: MicrophoneCapture
  private origin = 0
  private resources: StoredCreativeIntentResource[] = []
  private partial: CapturedAudioBlock[] = []
  private samples = 0
  private lastBlock?: CapturedAudioBlock
  private pending = new Map<string, () => Promise<void>>()
  private writer = Promise.resolve()
  private pendingPointers = 0
  private ending?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private ownWrite = false
  private disposed = false
  private releaseOwner?: () => void
  private releaseBody?: () => void
  private releaseDocument?: () => void
  private saving = Promise.resolve()
  private detaching?: Promise<void>
  private queued = 0
  private picking?: { entry: TranscriptEntry; mention: DeicticMention; resolve: () => void; reject: (error: unknown) => void }
  constructor(private readonly bus: ImageEditCommandBusV3, private readonly ports: ExplanationPorts) {
    this.releaseDocument = bus.subscribe(snapshot => {
      if (this.ownWrite || !this.collector || !['reviewing', 'recoverable'].includes(this.collector.session.state)) return
      const session = snapshot.document.creativeIntents?.sessions.find(s => s.id === this.collector?.session.id)
      if (session && JSON.stringify(session) !== JSON.stringify(this.collector.session)) {
        this.resources = []; this.collector = this.createCollector(explanationSessionSchema.parse(session)); this.publish()
      }
    })
    bus.getLifecycleSignal().addEventListener('abort', () => { void this.close().catch(error => logger.warn('图片讲解关闭未完成', { event: 'image_edit.explanation.close.failed', error })) }, { once: true })
  }
  readonly snapshot = (): ImageExplanationState => this.state
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(patch: Partial<ImageExplanationState> = {}): void { this.state = { ...this.state, ...patch, session: this.collector?.session, generation: this.state.generation + 1 }; this.listeners.forEach(fn => fn()) }
  private now(): number { return Math.max(this.state.elapsedUs, Math.round((performance.now() - this.origin) * 1000)) }
  private require(): RecordingCollector { if (!this.collector || this.disposed) throw new Error('请先打开图片讲解。'); return this.collector }
  private assert(collector: RecordingCollector): void { if (this.disposed || this.collector !== collector || this.erasedSessionId === collector.session.id) throw new Error('原讲解已关闭。') }
  private queue(write: () => Promise<void>): Promise<void> {
    this.queued++
    const next = this.writer.then(write).finally(() => { this.queued-- })
    this.writer = next.catch(() => { this.publish({ message: '讲解尚未保存，请暂停并重试保存。' }) })
    if (this.queued >= 8 && this.collector?.session.state === 'recording') {
      this.publish({ message: '讲解记录保存较慢，已暂停采集；保存后可继续。' })
      void this.pause().catch(() => logger.warn('图片讲解暂停未完成', { event: 'image_edit.explanation.pause.failed' }))
    }
    return next
  }
  private createCollector(session: ExplanationSession): RecordingCollector {
    const collector = new RecordingCollector(session, async page => {
      const resource = await this.ports.store(page, 'page', session.id); this.assert(collector)
      this.resources.push(resource)
      collector.session.pages.push({ resourceId: resource.resourceId, digest: resource.digest, bytes: resource.bytes, kind: page.kind, count: page.count, monoSpanUs: page.monoSpanUs, seqSpan: page.seqSpan })
    }, message => { this.publish({ message }); void this.pause().catch(() => this.publish({ message: '讲解保存失败，请重试保存。' })) })
    this.releaseBody?.()
    this.releaseBody = registerExplanationBodyEditor(explanationBodyRef(imageEditV3DocumentRef(this.bus.getSnapshot().document.id), session.id), {
      apply: (changes, context) => this.applyBody(changes, context),
      restore: async (before, context) => {
        if (!this.bus.getSnapshot().document.creativeIntents?.sessions.some(s => s.id === before.id)) throw new Error('讲解已删除，不能恢复私密正文。')
        this.resources = []; this.collector = this.createCollector(explanationSessionSchema.parse(before)); await this.save(context); this.publish()
      },
    })
    return collector
  }
  async reopen(id: string): Promise<void> {
    if (this.state.busy || this.collector && ['recording', 'paused', 'transcribing'].includes(this.collector.session.state)) throw new Error('请先结束当前讲解。')
    const session = this.bus.getSnapshot().document.creativeIntents?.sessions.find(s => s.id === id)
    if (!session || session.mode !== 'static') throw new Error('图片讲解不存在。')
    this.resources = []; this.collector = this.createCollector(explanationSessionSchema.parse(session))
    this.collector.session.state = 'reviewing'; this.publish({ elapsedUs: session.clockSegments.at(-1)?.monoSpanUs[1] ?? 0, message: undefined })
  }
  async start(receipt: string): Promise<void> {
    await this.detaching
    if (!receipt) throw new Error('请先确认录制范围。')
    if (this.state.busy || this.collector && ['recording', 'paused', 'transcribing'].includes(this.collector.session.state)) throw new Error('请先结束当前讲解。')
    this.publish({ busy: true, message: undefined })
    try {
      if (this.collector) await this.ports.audio.release(this.collector.session.id)
      this.controller = new AbortController(); this.resources = []; this.partial = []; this.samples = 0; this.lastBlock = undefined
      const document = this.bus.getSnapshot().document
      if (findImageEditDocumentInstanceV3(document.id)?.bus === this.bus) this.releaseOwner = leaseImageEditDocumentInstanceV3(document.id)
      const session = explanationSessionSchema.parse({ id: crypto.randomUUID(), version: 1, ownerRef: imageEditV3DocumentRef(document.id), createdAt: new Date().toISOString(), mode: 'static', state: 'consenting', sourceDigest: await imageLayoutDigest([document.id, crypto.randomUUID()]), retentionStatus: 'temporary',
        clockSegments: [], pages: [], visualEvidenceRefs: [], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [],
        consent: { noticeDigest: await imageLayoutDigest('image-explanation-v1'), userReceiptRef: receipt, capture: true, keepAudio: false, audioUpload: false, textUpload: false, imageUpload: false } })
      const collector = this.createCollector(session)
      this.collector = collector; this.origin = performance.now(); this.state.elapsedUs = 0; collector.start(0)
      await this.openMicrophone()
      clearInterval(this.timer)
      this.timer = setInterval(() => { if (collector.session.state === 'recording') this.publish({ elapsedUs: this.now() }) }, 1000)
      logger.info('图片讲解开始', { event: 'image_edit.explanation.start' })
    } catch (error) { this.collector?.pause(this.now()); this.releaseOwner?.(); this.releaseOwner = undefined; this.publish({ message: '无法开始录制，请检查麦克风权限或连接。' }); logger.warn('图片讲解开始失败', { event: 'image_edit.explanation.start.failed' }); throw error }
    finally { this.publish({ busy: false }) }
  }
  private async openMicrophone(): Promise<void> {
    const collector = this.require()
    await this.ports.audio.microphone(true, collector.session.consent!.userReceiptRef)
    try {
      this.microphone = await this.ports.microphone(this.origin, block => {
        if (this.disposed || this.collector !== collector || this.erasedSessionId === collector.session.id) return
        if (this.lastBlock && (this.lastBlock.firstFrame + this.lastBlock.samples.length !== block.firstFrame || this.lastBlock.sampleRate !== block.sampleRate)) {
          this.sealAudio(); this.publish({ message: '音频出现缺口，录制已暂停；请检查设备后继续。' }); void this.pause().catch(() => {})
        }
        this.lastBlock = block; this.partial.push(block); this.samples += block.samples.length
        if (this.samples >= block.sampleRate * 10) this.sealAudio()
      }, message => { this.publish({ message }); void this.pause().catch(() => {}) }, this.controller.signal)
      this.assert(collector)
    } catch (error) { await this.ports.audio.microphone(false, collector.session.consent!.userReceiptRef); throw error }
  }
  private sealAudio(): void {
    if (!this.samples) return
    const collector = this.require(), blocks = this.partial, first = blocks[0], samples = new Float32Array(this.samples)
    let offset = 0; for (const block of blocks) { samples.set(block.samples, offset); offset += block.samples.length }
    this.partial = []; this.samples = 0
    const chunkId = crypto.randomUUID()
    const event = collector.record(this.now(), { kind: 'audio', audioSegmentRef: chunkId, startSample: first.firstFrame, endSample: first.firstFrame + samples.length, monoSpanUs: [first.monoStartUs, first.monoStartUs + Math.round(samples.length * 1e6 / first.sampleRate)], sampleRate: first.sampleRate, channels: 1, uncertaintyUs: blocks.reduce((max, b) => Math.max(max, b.uncertaintyUs), 0) })
    if (!event) throw new Error('录音尾部尚未封存。')
    const write = async (): Promise<void> => { await this.ports.audio.write({ action: 'write', sessionId: collector.session.id, chunkId, sampleRate: first.sampleRate, samples }) }
    this.pending.set(chunkId, write)
    void this.queue(async () => { await write(); this.pending.delete(chunkId) }).catch(() => { void this.pause().catch(() => {}) })
    if (this.pending.size >= 4) { this.publish({ message: '正在保存录音，已暂停采集；保存后可继续。' }); void this.pause().catch(() => {}) }
  }
  async pause(focus = false): Promise<void> {
    if (this.ending) return this.ending
    if (this.collector?.session.state !== 'recording') return
    if (this.state.busy && !this.microphone) { this.controller.abort(); return }
    this.publish({ busy: true })
    this.ending = (async () => {
      await this.microphone?.stop(); this.microphone = undefined
      await this.ports.audio.microphone(false, this.require().session.consent!.userReceiptRef)
      this.sealAudio(); this.require().pause(this.now(), focus); await this.save()
    })()
    try { await this.ending } finally { this.ending = undefined; this.publish({ busy: false }) }
  }
  async resume(): Promise<void> {
    const collector = this.require()
    if (this.state.busy || collector.session.state !== 'paused') throw new Error('当前讲解不能继续录制。')
    this.publish({ busy: true, message: undefined })
    try { await this.save(); this.controller = new AbortController(); this.lastBlock = undefined; collector.resume(this.now()); await this.openMicrophone() }
    catch (error) { collector.pause(this.now()); throw error }
    finally { this.publish({ busy: false }) }
  }
  async stop(): Promise<void> {
    const collector = this.require()
    await this.pause()
    if (collector.session.state !== 'paused') return
    collector.stop(this.now()); clearInterval(this.timer); await this.save(); this.publish()
    this.releaseOwner?.(); this.releaseOwner = undefined
    logger.info('图片讲解结束', { event: 'image_edit.explanation.stop' })
  }
  async save(context?: ApplicationExecutionContext): Promise<void> {
    const next = this.saving.catch(() => {}).then(() => this.saveCurrent(context))
    this.saving = next
    return next
  }
  private async saveCurrent(context?: ApplicationExecutionContext): Promise<void> {
    const collector = this.require(); await this.writer
    for (const [id, write] of this.pending) { await write(); this.pending.delete(id) }
    await collector.flush(); this.assert(collector)
    this.ports.assertCurrent?.()
    const document = this.bus.getSnapshot().document, current = document.creativeIntents ?? { drafts: [], sessions: [], resources: [] }
    const next = { ...current, sessions: [...current.sessions.filter(s => s.id !== collector.session.id), structuredClone(collector.session)], resources: [...new Map([...current.resources, ...this.resources].map(r => [r.resourceId, r])).values()] }
    next.resources = creativeIntentLiveResources([next]); creativeIntentsSchema.parse(next)
    this.ownWrite = true
    try { this.bus.dispatch({ type: 'document.set-creative-intents', commandId: crypto.randomUUID(), expectedRevision: document.revision, intents: next, resources: creativeIntentLiveResources([current, next]).map(r => ({ resourceId: r.resourceId, byteSize: r.bytes })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)) }) }
    finally { this.ownWrite = false }
    const settled = () => this.ports.release(collector.session.id)
    if (this.ports.confirmStep) await this.ports.confirmStep(context, settled)
    else { await this.ports.confirm(context); await settled() }
  }
  recordPointer(input: ImageExplanationPointer): void {
    const collector = this.collector
    if (!collector || collector.session.state !== 'recording' || this.ownWrite) return
    const at = this.now(), base = collector.reserve(at), geometryBase = collector.reserve(at)
    if (!base || !geometryBase) return
    const document = this.bus.getSnapshot().document, geometryId = crypto.randomUUID(), surfaceRef = { kind: 'application.surface', id: 'image-editor.preview' }
    const pointer: Pointer = { ...base, kind: 'pointer', surfaceRef, geometrySnapshotRef: geometryId, viewPoint: input.viewPoint, documentPoint: input.documentPoint, compositionPoint: input.point, hoverRefs: input.refs, pointedRefs: input.phase === 'down' ? input.refs : [], selectedRefs: input.selectedRefs, intent: 'navigate', phase: input.phase, uncertaintyUs: 0 }
    collector.append(pointer)
    // At most one native screenshot is in flight. Later pointer samples still remain in the event pages.
    const capture = input.phase === 'down' && input.capture && this.pendingPointers === 0 ? input.capture() : undefined
    if (capture) { this.pendingPointers++; void capture.catch(() => {}) }
    void this.queue(async () => {
      this.assert(collector)
      const stateDigest = await imageLayoutDigest([document.geometry, document.layers])
      collector.append({ ...geometryBase, kind: 'geometry', snapshotRef: geometryId, surfaceRef, windowRef: collector.session.id, ...input.geometry, ancestorAffine: [1, 0, 0, 1, 0, 0], stateDigest })
      if (capture) {
        try {
          const image = await capture; this.assert(collector)
          if (image) { this.resources.push(image.resource); collector.session.visualEvidenceRefs.push({ id: crypto.randomUUID(), kind: 'frame', resourceRef: { resourceId: image.resource.resourceId, digest: image.resource.digest, bytes: image.resource.bytes }, size: image.size, pixelBudget: image.size[0] * image.size[1], frames: [{ ...base, stateDigest, geometrySnapshotRef: geometryId, sourceRefs: input.refs, pointer: image.point, reason: 'pointing', attachmentRect: [0, 0, ...image.size] }] }) }
          else this.publish({ message: '画面在指向时发生变化，本次只保留位置记录。' })
        } finally { this.pendingPointers-- }
      }
    }).catch(() => this.publish({ message: '这次指向未能保存画面，请重新指向后再讲解。' }))
  }
  async *events(kind?: ExplanationEvent['kind']): AsyncGenerator<ExplanationEvent> {
    const collector = this.require(), resources = new Map([...(this.bus.getSnapshot().document.creativeIntents?.resources ?? []), ...this.resources].map(r => [r.resourceId, r]))
    for (const ref of collector.session.pages.filter(p => !kind || p.kind === kind)) {
      const resource = resources.get(ref.resourceId)
      if (!resource || resource.digest !== ref.digest || resource.bytes !== ref.bytes) throw new Error('讲解页缺失，请恢复原文件。')
      const page = creativeIntentPageSchema.parse(await this.ports.read(resource)); this.assert(collector)
      if (page.sourceDigest !== collector.session.sourceDigest || JSON.stringify(page.ownerRef) !== JSON.stringify(collector.session.ownerRef) || page.kind !== ref.kind) throw new Error('讲解页归属不符。')
      if (page.kind === 'samples' || page.kind === 'clock') continue
      for (const event of page.entries) { if (clockEventIssue(event, collector.session.clockSegments)) throw new Error('讲解时间证据不符。'); yield event }
    }
  }
  private async *effectiveTranscript(): AsyncGenerator<TranscriptEntry> {
    const collector = this.require(), session = collector.session
    for await (const event of semanticRecordingEvents(session, async id => {
      const resource = [...(this.bus.getSnapshot().document.creativeIntents?.resources ?? []), ...this.resources].find(r => r.resourceId === id)
      if (!resource) throw new Error('讲解页缺失。')
      const page = await this.ports.read(resource); this.assert(collector); return page
    })) if (event.kind === 'transcript') {
      this.assert(collector)
      if (clockEventIssue(event, session.clockSegments)) throw new Error('讲解时间证据不符。')
      yield event
    }
  }
  async transcript(pageIndex = 0): Promise<TranscriptEntry[]> {
    const result: TranscriptEntry[] = []; let index = 0
    for await (const event of this.effectiveTranscript()) { if (index >= pageIndex * 256 && index < (pageIndex + 1) * 256) result.push(event); index++; if (index >= (pageIndex + 1) * 256) break }
    return result
  }
  async correctText(entry: TranscriptEntry, text: string): Promise<void> {
    await writeExplanationBody(explanationBodyRef(imageEditV3DocumentRef(this.bus.getSnapshot().document.id), this.require().session.id), { text: [{ eventId: entry.eventId, text }] })
  }
  private async applyBody(changes: ExplanationBodyChanges, context?: ApplicationExecutionContext): Promise<void> {
    const collector = this.require()
    if (this.state.busy || !['reviewing', 'recoverable'].includes(collector.session.state)) throw new Error('请先结束录制或转写。')
    const current = new Map<string, TranscriptEntry>()
    if (changes.text?.length) for await (const event of this.effectiveTranscript()) current.set(event.eventId, event)
    // Validate every text before appending any immutable correction page.
    const edits = changes.text?.map(edit => { const original = current.get(edit.eventId); if (!original) throw new Error('词稿已变化，请重新读取。'); return { original, text: edit.text } }) ?? []
    for (const { original, text } of edits) {
      const originalEventRef = original.originalEventRef ?? original.eventId
      const corrected = transcriptEventSchema.parse({ ...original, eventId: crypto.randomUUID(), seq: collector.nextSeq, source: 'user', originalEventRef, text })
      collector.append(corrected); collector.session.corrections = [...collector.session.corrections.filter(c => c.originalEventRef !== originalEventRef), { originalEventRef, correctedEventRef: corrected.eventId }]
    }
    if (changes.bindings) {
      for (const binding of changes.bindings) {
        if (collector.session.bindings.some(existing => sameExplanationBinding(existing, binding))) continue
        let entry: TranscriptEntry | undefined
        for await (const candidate of this.effectiveTranscript()) if (binding.utteranceIds.includes(candidate.utteranceId)) { entry = candidate; break }
        if (!entry) throw new Error('绑定对应的词稿已变化。')
        await this.applyBinding(entry, binding)
      }
      collector.session.bindings = structuredClone(changes.bindings)
    }
    await this.save(context); this.publish()
  }
  async preflightTranscription(): Promise<void> {
    const collector = this.require(), session = collector.session
    if (this.state.busy || !['reviewing', 'recoverable'].includes(session.state)) throw new Error('请先结束录制。')
    const modelId = session.asr?.moduleId ?? await this.ports.model()
    const completed = new Set<string>()
    for await (const event of this.events('transcript')) if (event.kind === 'transcript') completed.add(event.audioSegmentRef)
    for await (const audio of this.events('audio')) {
      if (audio.kind !== 'audio' || completed.has(audio.audioSegmentRef)) continue
      await this.ports.audio.preflight({ action: 'preflight', sessionId: session.id, chunkId: audio.audioSegmentRef, requestId: audio.audioSegmentRef, modelId, resume: session.state === 'recoverable' })
      this.assert(collector)
    }
  }
  async transcribe(receipt: string): Promise<void> {
    const collector = this.require(), session = collector.session
    if (!receipt || this.state.busy || !['reviewing', 'recoverable'].includes(session.state)) throw new Error('请结束录制并确认转写授权。')
    const resume = session.state === 'recoverable'
    this.publish({ busy: true, message: undefined })
    try {
      const modelId = session.asr?.moduleId ?? await this.ports.model()
      this.assert(collector)
      session.asr = { moduleId: modelId, providerId: modelId.split('.')[0], granularity: 'segment' }
      session.consent = { ...session.consent!, audioUpload: true, transcriptionProvider: session.asr.providerId }; session.state = 'transcribing'; this.publish()
      const completed = new Set<string>(); for await (const event of this.events('transcript')) if (event.kind === 'transcript') completed.add(event.audioSegmentRef)
      for await (const audio of this.events('audio')) {
        if (audio.kind !== 'audio' || completed.has(audio.audioSegmentRef)) continue
        const result = await this.ports.audio.transcribe({ action: 'transcribe', sessionId: session.id, chunkId: audio.audioSegmentRef, modelId, requestId: audio.audioSegmentRef, audioUploadReceipt: receipt, resume })
        this.assert(collector); if (session.state !== 'transcribing') throw new Error('转写已取消。')
        const aligned = alignRecordingTranscript(result.transcript, audio, session.clockSegments, collector.nextSeq, suffix => `${audio.audioSegmentRef}/${suffix}`)
        for (const entry of aligned.entries) collector.append(transcriptEventSchema.parse(entry))
        await this.save()
      }
      session.state = 'reviewing'; await this.save()
      logger.info('图片讲解转写完成', { event: 'image_edit.explanation.transcribe.completed' })
    } catch (error) { session.state = 'recoverable'; this.publish({ message: '转写未完成，原稿已保留。' }); logger.warn('图片讲解转写未完成', { event: 'image_edit.explanation.transcribe.failed' }); throw error }
    finally { this.publish({ busy: false }) }
  }
  async readReview(entry: TranscriptEntry, mentionId?: string, includeImage = true): Promise<ExplanationReviewResult> {
    const collector = this.require(), events: ExplanationEvent[] = [], entries: TranscriptEntry[] = []
    for await (const event of this.effectiveTranscript()) if (event.utteranceId === entry.utteranceId) entries.push(event)
    if (!entries.some(e => e.eventId === entry.eventId)) throw new Error('词稿已变化，请重新打开。')
    const from = entries.reduce((v, e) => Math.min(v, e.monoSpanUs[0]), Infinity) - 800000
    const to = entries.reduce((v, e) => Math.max(v, e.monoSpanUs[1]), 0) + 250000
    for await (const event of this.events()) if (event.kind !== 'transcript' && event.monoUs >= from && event.monoUs <= to) events.push(event)
    const resolution = resolveDeixis(entries, events, collector.session.clockSegments, collector.session.bindings)
    const document = this.bus.getSnapshot().document, stateDigest = await imageLayoutDigest([document.geometry, document.layers]), output = resolveAnnotationOutputGeometryV3(document)
    const current = collectImageEditV3LiveLayers(document).filter(l => l.layer.type !== 'group').map(location => {
      const matrix = layerToOutputV3(document, findImageEditLayerLocationV3(document.layers, location.layer.id)!)
      return { targetRef: { ...imageEditV3LayerRef(document.id, location.layer.id), label: location.layer.name }, stateDigest, pose: { position: [matrix[4] / output.width, matrix[5] / output.height] as [number, number], rotationTurns: Math.atan2(matrix[1], matrix[0]) / (2 * Math.PI), scaleXY: [Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])] as [number, number], pivot: [.5, .5] as [number, number] } }
    })
    const destination = resolution.mentions.find(m => m.slot === 'destination')?.selected
    const goals: ReviewedIntentGoal[] = destination ? resolution.mentions.filter(m => m.slot === 'target' || m.slot === 'source').flatMap(m => m.selected?.targetRefs.map(targetRef => ({ targetRef, property: 'position' as const, value: destination.point, confirmed: true })) ?? []) : []
    const plan = buildIntentDifferencePlan([resolution], goals, current, events)
    const mention = resolution.mentions.find(m => m.id === mentionId) ?? resolution.mentions.find(m => m.entries.some(e => e.eventId === entry.eventId)) ?? resolution.mentions[0]
    const chosen = mention?.selected ?? mention?.candidates[0]
    const evidence = collector.session.visualEvidenceRefs.find(visual => visual.frames.some(frame => chosen?.evidenceSeqs.includes(frame.seq)))
    const image = includeImage && evidence ? await this.ports.readVisual(evidence.resourceRef.resourceId) : undefined
    this.assert(collector)
    if (document !== this.bus.getSnapshot().document) throw new Error('图片已变化，请重新审阅。')
    const refs = resolution.mentions.filter(m => /[这那]几个/.test(m.text)).flatMap(m => m.selected?.targetRefs ?? [])
    const layout = !resolution.negated && !resolution.issues.length && resolution.mentions.every(m => m.selected) && /等距|对齐/.test(resolution.text) && refs.length >= (/等距/.test(resolution.text) ? 3 : 2)
      ? { targetRefs: refs, action: /等距/.test(resolution.text) ? 'distribute' as const : 'align' as const } : undefined
    const refsForOptions = [...new Map(resolution.mentions.flatMap(m => [...(m.selected?.targetRefs ?? []), ...m.candidates.flatMap(c => c.targetRefs)]).map(ref => [ref.id, ref])).values()]
    const locations = collectImageEditV3LiveLayers(document)
    const objects = refsForOptions.map(ref => {
      const location = locations.find(l => imageEditV3LayerRef(document.id, l.layer.id).id === ref.id), name = location?.layer.name ?? ref.label ?? '图层'
      const duplicates = locations.filter(l => l.layer.name === name)
      const position = location ? duplicates.findIndex(l => l.layer.id === location.layer.id) : -1
      const suffix = location?.ancestors.at(-1)?.name
      const label = duplicates.length > 1 ? `${name} · ${suffix && duplicates.filter(l => l.ancestors.at(-1)?.name === suffix).length === 1 ? suffix : position === 0 ? '上层' : position === duplicates.length - 1 ? '下层' : `第 ${position + 1} 层`}` : name
      return { ref, label, corners: undefined as [number, number][] | undefined }
    })
    // Never project changed artwork over an old screenshot.
    const historical = evidence?.frames.find(frame => chosen?.evidenceSeqs.includes(frame.seq))
    if (image && historical?.stateDigest === stateDigest) {
      const ids = objects.map(object => splitImageEditV3LayerRef(object.ref).layerId)
      const measured = await captureImageLayoutEntries(document, ids, this.controller.signal, undefined, 1)
      for (const object of objects) object.corners = measured.find(e => e.item.targetRef.id === object.ref.id)?.item.worldCorners.map(([x, y]) => [x / output.width, y / output.height])
    }
    this.assert(collector)
    if (this.bus.getSnapshot().document !== document) throw new Error('画面已改变，请重新选择这处指代')
    return { resolution, plan, image, imagePoint: historical?.pointer ?? undefined, layout, objects }
  }
  private historicalEvidence(entry: TranscriptEntry): ExplanationSession['visualEvidenceRefs'][number] | undefined {
    const middle = (entry.monoSpanUs[0] + entry.monoSpanUs[1]) / 2
    return this.require().session.visualEvidenceRefs.filter(v => v.frames.some(f => f.monoUs >= entry.monoSpanUs[0] - 500000 && f.monoUs <= entry.monoSpanUs[1] + 500000))
      .sort((a, b) => Math.abs(a.frames[0].monoUs - middle) - Math.abs(b.frames[0].monoUs - middle))[0]
  }
  historicalRefs(entry: TranscriptEntry): ApplicationRef[] { return this.historicalEvidence(entry)?.frames[0]?.sourceRefs ?? [] }
  async bind(entry: TranscriptEntry, binding: ExplanationBinding): Promise<void> {
    const session = this.require().session
    await writeExplanationBody(explanationBodyRef(imageEditV3DocumentRef(this.bus.getSnapshot().document.id), session.id), { bindings: [...session.bindings.filter(b => b.id !== binding.id), binding] })
  }
  private async applyBinding(entry: TranscriptEntry, binding: ExplanationBinding): Promise<void> {
    const review = await this.readReview(entry), mention = review.resolution.mentions.find(m => m.id === binding.id)
    if (mention && !binding.evidenceSeqs.length && binding.point) {
      const document = this.bus.getSnapshot().document
      for (const ref of binding.targetRefs) { const target = splitImageEditV3LayerRef(ref); if (target.documentId !== document.id || !findImageEditLayerLocationV3(document.layers, target.layerId)) throw new Error('所选对象已不存在。') }
      const corrected = pickedExplanationBinding(mention, binding.targetRefs, binding.point)
      if (!sameExplanationBinding(corrected, binding)) throw new Error('点选校正必须来自当前讲解。')
      this.require().session.bindings = [...this.require().session.bindings.filter(b => b.id !== corrected.id), corrected]
      return
    }
    const candidate = mention?.candidates.find(c => binding.evidenceSeqs.every(seq => c.evidenceSeqs.includes(seq)) && binding.point?.every((v, i) => c.point[i] === v))
    if (!mention || !candidate) throw new Error('指向证据已变化，请重新确认。')
    const target = /[这那]几个/.test(mention.text) ? undefined : binding.targetRefs[0]
    if (target && !candidate.targetRefs.some(r => r.kind === target.kind && r.id === target.id)) throw new Error('对象不属于当时指向。')
    const confirmed = confirmedExplanationBinding(mention, candidate, target)
    if (!sameExplanationBinding(confirmed, binding)) throw new Error('指代校正必须来自完整候选。')
    const collector = this.require(); collector.session.bindings = [...collector.session.bindings.filter(b => b.id !== confirmed.id), confirmed]
    logger.info('图片讲解指向已确认', { event: 'image_edit.explanation.binding.completed' })
  }
  async organize(entry: TranscriptEntry): Promise<void> {
    const review = await this.readReview(entry)
    if (!review.layout) throw new Error('请先确认需要等距或对齐的图层。')
    const documentId = this.bus.getSnapshot().document.id
    const ids = review.layout.targetRefs.map(ref => { const target = splitImageEditV3LayerRef(ref); if (target.documentId !== documentId) throw new Error('图层不属于当前图片。'); return target.layerId })
    await imageEditLayoutDraft(this.bus).organize(ids, review.layout.action)
  }
  async prepareGeneration(): Promise<ExplanationSendRequest | undefined> {
    const collector = this.require()
    await this.generation?.cancel()
    this.generation = await prepareExplanationGeneration({
      documentRef: imageEditV3DocumentRef(this.bus.getSnapshot().document.id),
      session: () => this.collector?.session,
      drafts: () => this.bus.getSnapshot().document.creativeIntents?.drafts ?? [],
      read: async id => { const resource = this.bus.getSnapshot().document.creativeIntents?.resources.find(r => r.resourceId === id); if (!resource) throw new Error('讲解页已删除。'); return this.ports.read(resource) },
      consent: async consent => { this.assert(collector); collector.session.consent = consent; await this.save(); this.publish() },
      assertCurrent: () => this.assert(collector),
    })
    return this.generation.request
  }
  async generate(entries: readonly TranscriptEntry[]): Promise<void> {
    const generation = this.generation; this.generation = undefined
    if (generation) return generation.run(() => this.generateLocal(entries))
    return this.generateLocal(entries)
  }
  private async generateLocal(entries: readonly TranscriptEntry[]): Promise<void> {
    await this.finishReview()
    const reviews: ExplanationReviewResult[] = []
    for (const entry of entries) reviews.push(await this.readReview(entry, undefined, false))
    const plans = reviews.filter(review => !review.layout).map(review => review.plan)
    const protectedIds = new Set(reviews.flatMap(review => review.plan.protectedRefs.map(ref => ref.id)))
    if (reviews.some(review => review.layout?.targetRefs.some(ref => protectedIds.has(ref.id)))) throw new Error('排列包含保护对象，请重新确认。')
    if (plans.some(plan => plan.changes.length)) {
      reviewedMovementChanges(plans)
      await imageEditLayoutDraft(this.bus).move(plans)
    }
    if (!plans.some(plan => plan.changes.length) && !reviews.some(review => review.layout)) throw new Error('请先确认对象和动作。')
    for (const [index, review] of reviews.entries()) if (review.layout) await this.organize(entries[index])
  }
  pick(entry: TranscriptEntry, mention: DeicticMention): Promise<void> {
    this.cancelPick()
    return new Promise((resolve, reject) => { this.picking = { entry, mention, resolve, reject } })
  }
  hasPendingPick(): boolean { return !!this.picking }
  cancelPick(): void { const pending = this.picking; this.picking = undefined; pending?.resolve() }
  acceptPick(point: [number, number], refs: ApplicationRef[], selectedRefs: ApplicationRef[]): void {
    const pending = this.picking; if (!pending) return
    const object = pending.mention.slot === 'target' || pending.mention.slot === 'source'
    const targets = object ? /[这那]几个/.test(pending.mention.text) ? selectedRefs : refs : []
    this.picking = undefined
    try { void this.bind(pending.entry, pickedExplanationBinding(pending.mention, targets, point)).then(pending.resolve, pending.reject) } catch (error) { pending.reject(error) }
  }
  async cancelTranscription(): Promise<void> {
    const collector = this.require(); collector.session.state = 'recoverable'
    await this.ports.audio.cancel(collector.session.id); this.publish()
    logger.info('图片讲解转写已取消', { event: 'image_edit.explanation.transcribe.cancelled' })
  }
  async finishReview(): Promise<void> {
    this.cancelPick()
    const collector = this.collector; if (!collector || !['reviewing', 'recoverable'].includes(collector.session.state)) return
    await this.ports.audio.release(collector.session.id)
    collector.session.retentionStatus = 'deleted'; delete collector.session.audio
    await this.save(); this.publish()
    logger.info('图片讲解原音已释放', { event: 'image_edit.explanation.audio.released' })
  }
  async remove(): Promise<void> {
    const collector = this.require()
    if (this.state.busy || ['recording', 'paused', 'transcribing'].includes(collector.session.state)) throw new Error('请先结束录制。')
    try {
    await this.generation?.cancel(); this.generation = undefined
    if (this.erasedSessionId !== collector.session.id) {
    await this.finishReview(); await this.ports.audio.erase(collector.session.id)
    const document = this.bus.getSnapshot().document
    for (const resource of await this.bus.eraseExplanationSession(collector.session.id)) this.eraseResources.add(resource)
    this.erasedSessionId = collector.session.id
    eraseExplanationBody(explanationBodyRef(imageEditV3DocumentRef(document.id), collector.session.id))
    }
    await this.ports.confirm(); await this.ports.release(collector.session.id); await this.ports.eraseResources([...this.eraseResources]); this.eraseResources.clear(); this.resources = []; this.collector = undefined; this.publish({ message: undefined })
    logger.info('图片讲解已删除', { event: 'image_edit.explanation.remove.completed' })
    } catch (error) { logger.warn('图片讲解删除未完成', { event: 'image_edit.explanation.remove.failed', error }); throw error }
  }
  async close(): Promise<void> {
    if (this.disposed) return
    await this.generation?.cancel(); this.generation = undefined
    this.cancelPick()
    this.controller.abort(); clearInterval(this.timer)
    await this.microphone?.stop(); this.microphone = undefined
    const collector = this.collector
    if (collector) { await this.ports.audio.microphone(false, collector.session.consent!.userReceiptRef); await this.ports.audio.cancel(collector.session.id); await this.writer; await this.ports.audio.release(collector.session.id); await this.ports.release(collector.session.id) }
    this.releaseDocument?.(); this.releaseDocument = undefined; this.releaseBody?.(); this.releaseBody = undefined; this.releaseOwner?.(); this.releaseOwner = undefined; this.disposed = true; this.listeners.clear()
  }
  async detach(): Promise<void> {
    if (!this.collector || this.disposed) return
    if (this.detaching) return this.detaching
    this.detaching = (async () => {
      if (this.state.busy && !this.microphone) this.controller.abort()
      await this.stop()
      const collector = this.require()
      await this.ports.audio.release(collector.session.id)
      collector.session.retentionStatus = 'deleted'; await this.save(); this.publish()
    })()
    try { await this.detaching } finally { this.detaching = undefined }
  }
}

const adapters = new WeakMap<ImageEditCommandBusV3, ImageEditExplanation>()
export function imageEditExplanation(bus: ImageEditCommandBusV3): ImageEditExplanation {
  let adapter = adapters.get(bus)
  if (!adapter) {
    adapter = new ImageEditExplanation(bus, {
      microphone: captureMicrophone, get audio() { return getPlatform().audioEdit.recording }, store: storeImageLayoutResource, read: readImageLayoutResource, release: releaseImageLayoutResources,
      model: async () => (await import('@/features/settings')).modelDefaultsManager.resolveTranscriptionModelId(),
      assertCurrent: () => { const owner = findImageEditDocumentInstanceV3(bus.getSnapshot().document.id)?.persistenceOwner; if (!owner) throw new Error('图片尚不能保存，请保留当前页面。'); owner.assertCurrent() },
      confirmStep: async (context, settled) => { const owner = findImageEditDocumentInstanceV3(bus.getSnapshot().document.id)?.persistenceOwner; if (!owner) throw new Error('图片尚不能保存，请保留当前页面。'); owner.acceptCurrent(); await owner.confirmStep(context, settled) },
      confirm: async context => { const owner = findImageEditDocumentInstanceV3(bus.getSnapshot().document.id)?.persistenceOwner; if (!owner) throw new Error('图片尚不能保存，请保留当前页面。'); owner.acceptCurrent(); return context ? owner.confirmStep(context, async () => {}) : owner.confirm(true) },
      eraseResources: async resourceIds => { await getPlatform().imageEditorV3.collectGarbage({ requestId: crypto.randomUUID(), retainedResourceRefs: [], eraseResourceRefs: resourceIds as `sha256:${string}`[] }) },
      readVisual: async resourceId => {
        const proxy = await getPlatform().imageEditorV3.readFastProxy({ requestId: crypto.randomUUID(), resourceRef: resourceId as `sha256:${string}`, maxDimension: 1280 })
        const bitmap = await createImageBitmap(new Blob([proxy.bytes], { type: proxy.mediaType }))
        try { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); canvas.getContext('2d')!.drawImage(bitmap, 0, 0); return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) }
        finally { bitmap.close() }
      },
    }); adapters.set(bus, adapter)
  }
  return adapter
}
