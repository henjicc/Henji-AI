import path from 'node:path'
import { readdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { CaptureLogPage, CaptureEvent } from '../../../../src/core/captureLog/events'
import { captureLogPageSchema } from '../../../../src/core/captureLog/events'
import { createRecordingDocument, recordingDocumentSchema, recordingNeedsRecovery, type RecordingDocument, type RecordingMedia } from '../../../../src/core/screenRecording/document'
import type { RecordingSessionOptions } from '../../../../src/core/screenRecording/sessionOptions'
import type { CaptureManifest } from '../../../../src/core/screenRecording/capture'
import type { RecordingTrackKind, RecordingTrackOptions, RecordingTracks } from '../../../../src/core/screenRecording/tracks'
import type { RecordingTrackRecord } from '../../../../src/core/screenRecording/trackJournal'
import { recordingDurationUs } from '../../../../src/core/screenRecording/range'
import { alignRecordingPauses } from '../../../../src/core/screenRecording/combine'
import type { DocumentMeta } from '../../../../src/core/documents/types'
import { getDocumentService } from '../documents/runtime'
import { DocumentNameConflictError } from '../documents/errors'
import { createMainLogger } from '../logging'
import { RecordingEventStore } from './event-store'
import { recoverCapture } from './capture/storage'
import { captureTimingPauses, readCaptureTiming } from './capture/native-timing'
import { RecordingTrackLedger, replayTrackJournal } from './track-ledger'
import { NATIVE_MICROPHONE_FILE, joinRecordingAudio } from './audio-join'
import type { RecordingScriptCapture } from '../../../../src/core/screenRecording/script'

const logger = createMainLogger('main.screen_recording.document')
type PageReference = RecordingDocument['eventPages'][number]
export interface RecordingFinishSummary { status: RecordingDocument['status']; durationUs: number; screenSpans: number; repairedSpans: number; rejectedSpans: number; eventPages: number; events: number; maxPageWriteMs: number; maxTrackWriteMs: number; detaches: number; tracks: Record<string, { segments: number; gaps: number }>; joinedAudio: number }

function trackKinds(devices: RecordingTrackOptions): RecordingTrackKind[] {
  return [...(devices.microphone ? ['microphone' as const] : []), ...(devices.systemAudio ? ['systemAudio' as const] : []), ...(devices.camera ? ['camera' as const] : [])]
}

/**
 * 主进程唯一的录制文档写入方。录制期间只在开始、暂停、恢复和画面分片变化这些少数时刻存文档；
 * 事件页与声音分段各自追加落盘，索引留在内存，停止（或失败、恢复）时一次写进文档。
 */
export class RecordingSessionDocument {
  private queue: Promise<void> = Promise.resolve()
  private readonly pages: PageReference[] = []
  private readonly markers: RecordingDocument['markers'] = []
  private readonly controls: PauseControl[] = []
  private events = 0
  private maxPageWriteMs = 0
  private finished = false
  readonly ledger: RecordingTrackLedger
  private constructor(readonly content: RecordingDocument, private meta: DocumentMeta, readonly directory: string) {
    this.ledger = new RecordingTrackLedger(directory, content.sessionId!, content.originUs, trackKinds(content.devices), content.devices.camera?.frameRate)
  }

  static async create(id: string, originUs: number, options: RecordingSessionOptions, sourceName: string, capture: CaptureManifest, directory: string, cursor?: NonNullable<RecordingDocument['source']>['cursor']): Promise<RecordingSessionDocument> {
    const content = createRecordingDocument()
    Object.assign(content, { sessionId: id, originUs, status: 'prepared', source: { name: sourceName, options: capture.options, cursorEmbedded: capture.cursorEmbedded, ...(cursor ? { cursor } : {}) }, devices: options.tracks })
    logger.info('创建录制会话', { event: 'recording.document.create.start', context: { sessionId: id } })
    const container = options.projectId ? { kind: 'project' as const, projectId: options.projectId } : { kind: 'user' as const }
    // 会话名会重复（用户手填的名字、录制样子按段数起的“第 N 段”在删过段后再录）：重名时自动加序号，不能因此开不了录。
    let read: Awaited<ReturnType<ReturnType<typeof getDocumentService>['createDocument']>> | undefined
    for (let index = 1; !read; index += 1) {
      const name = index === 1 ? options.name : `${options.name} (${index})`
      try {
        read = await getDocumentService().createDocument({ id, kind: 'screen_recording', name, draft: false, container, content })
      } catch (error) {
        if (!(error instanceof DocumentNameConflictError) || index >= 1000) throw error
      }
    }
    await getDocumentService().markDocumentOpened(id)
    logger.info('录制会话已创建', { event: 'recording.document.create.completed', context: { sessionId: id } })
    return new RecordingSessionDocument(content, read.meta, directory)
  }
  save(): Promise<void> {
    const content = recordingDocumentSchema.parse(structuredClone(this.content))
    const task = this.queue.then(async () => {
      const result = await getDocumentService().saveDocument({ target: { id: this.meta.id }, expectedRevision: this.meta.revision, content })
      this.meta = result.meta
    })
    this.queue = task.catch(error => { logger.error('录制会话保存失败', { event: 'recording.document.save.failed', error, context: { sessionId: this.meta.id } }) })
    return task
  }
  scriptCall(call: RecordingScriptCapture['calls'][number], baselines: RecordingScriptCapture['baselines']): Promise<void> {
    const capture = this.content.scriptCapture
    if (capture.calls.some(value => value.callId === call.callId)) throw new Error('操作记录不可重复')
    if (capture.calls.length >= 20000 || new Set([...capture.baselines, ...baselines].map(value => value.documentId)).size > 16) throw new Error('此会话的操作脚本已达上限，后续操作仍录制画面。')
    for (const baseline of baselines) if (!capture.baselines.some(value => value.documentId === baseline.documentId)) capture.baselines.push(baseline)
    capture.calls.push(call)
    return this.save()
  }
  capture(manifest: CaptureManifest): Promise<void> {
    if (this.finished) return Promise.resolve()
    // 结束状态只由 finish 写：收尾（补分段、拼声音）途中崩溃时，文档仍停在录制中，下次启动会被找出来恢复。
    if (manifest.status !== 'stopped' && manifest.status !== 'failed') this.content.status = manifest.status
    this.content.media = [...this.content.media.filter(media => media.kind !== 'screen'), ...manifest.spans.map(span => ({
      id: `screen-${span.index}`, kind: 'screen' as const, path: path.join(this.directory, span.file), monoUs: span.monoUs, durationUs: span.durationUs,
    }))]
    return this.save()
  }
  range(edge: 'startUs' | 'endUs', monoUs: number): Promise<void> {
    this.content[edge] = Math.max(0, Math.round(monoUs))
    return this.save()
  }
  pause(monoUs: number): Promise<void> {
    const at = Math.max(0, Math.round(monoUs))
    ;(this.content.pauses ??= []).push({ startUs: at, endUs: at })
    return this.save()
  }
  resume(monoUs: number): Promise<void> {
    const open = this.content.pauses?.at(-1)
    if (!open || open.endUs !== open.startUs) return Promise.resolve()
    open.endUs = Math.max(open.startUs, Math.round(monoUs))
    return this.save()
  }
  /** 页文件已独占落盘；这里只记索引，不存文档。 */
  page(page: CaptureLogPage, file: string, writeMs = 0): void {
    this.pages.push({ path: file, firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] })
    this.events += page.entries.length; this.maxPageWriteMs = Math.max(this.maxPageWriteMs, writeMs)
    for (const entry of page.entries) {
      if (entry.kind === 'mark') this.markers.push({ id: entry.eventId, monoUs: entry.monoUs, note: entry.note ?? '' })
      collectPauseControl(this.controls, entry)
    }
  }
  pageReferences(): readonly PageReference[] { return this.pages }
  track(record: RecordingTrackRecord): Promise<void> { return this.ledger.record(record) }

  /** 停止、取消或失败后的唯一收尾：补齐分片与分段，拼接声音，把全部索引一次写进文档。 */
  async finish(manifest: CaptureManifest): Promise<RecordingFinishSummary> {
    if (this.finished) throw new Error('录制会话已收尾')
    this.finished = true
    const capture = await recoverCapture(this.directory, manifest)
    const { media: audio, tracks, joined } = await recordingAudio(this.directory, await this.ledger.finish(), this.content.endUs ?? pictureEndUs(capture.files))
    Object.assign(this.content, {
      status: manifest.status === 'stopped' ? 'stopped' : 'interrupted',
      eventPages: [...this.pages], markers: [...this.markers], tracks,
      media: [...capture.files.map(file => ({ id: `screen-${file.index}`, kind: 'screen' as const, path: file.path, monoUs: file.monoUs, durationUs: file.durationUs })), ...audio],
      ...this.content.pauses ? { pauses: await recordedPauses(this.content.pauses, this.controls, capture.files) } : {},
    })
    await this.save()
    if (joined) await removeNativeMicrophoneCopies(this.directory, tracks)
    return { status: this.content.status, durationUs: recordingDurationUs(this.content), screenSpans: manifest.spans.length, repairedSpans: capture.repaired, rejectedSpans: capture.rejected.length,
      eventPages: this.pages.length, events: this.events, maxPageWriteMs: Math.round(this.maxPageWriteMs), maxTrackWriteMs: Math.round(this.ledger.maxWriteMs), detaches: this.ledger.detaches, tracks: this.ledger.state.counts(), joinedAudio: audio.filter(item => item.id.includes('-joined-')).length }
  }
}


type PauseControl = { action: 'pause' | 'resume'; monoUs: number }
function collectPauseControl(controls: PauseControl[], entry: CaptureEvent): void {
  if (entry.kind === 'control' && (entry.action === 'pause' || entry.action === 'resume')) controls.push({ action: entry.action, monoUs: entry.monoUs })
}
/** 暂停区间按事件时钟与画面第一帧统一（见 alignRecordingPauses）；对齐了几次进日志，便于复盘。 */
function alignedPauses(pauses: NonNullable<RecordingDocument['pauses']>, controls: readonly PauseControl[], screens: ReadonlyArray<{ monoUs: number }>): NonNullable<RecordingDocument['pauses']> {
  const aligned = alignRecordingPauses(pauses, controls, screens) ?? []
  const changed = aligned.filter((pause, index) => pause.startUs !== pauses[index]?.startUs || pause.endUs !== pauses[index]?.endUs).length
  if (pauses.length) logger.info('暂停区间已与事件时钟和画面对齐', { event: 'recording.pauses.aligned', context: { pauses: pauses.length, aligned: changed, controls: controls.length } })
  return aligned
}

/**
 * 原生采集录的画面是一个连续文件，暂停不在文件里：暂停区间直接按它的逐帧时刻表推出（与事件时钟扣掉的、合并时各段的是同一组数）。
 * 其余录法录的按事件时钟与各分片第一帧对齐。
 */
async function recordedPauses(pauses: NonNullable<RecordingDocument['pauses']>, controls: readonly PauseControl[], screens: ReadonlyArray<{ path: string; monoUs: number; durationUs: number }>): Promise<NonNullable<RecordingDocument['pauses']>> {
  if (screens.length === 1) {
    const [screen] = screens
    const timing = await readCaptureTiming(screen.path).catch(error => { logger.warn('逐帧时刻表读不出，暂停按事件时钟对齐', { event: 'recording.pauses.timing_failed', error }); return null })
    if (timing) {
      const result = captureTimingPauses(timing, screen.monoUs, Math.round(screen.durationUs * timing.fpsNum / timing.fpsDen / 1e6))
      logger.info('暂停区间按逐帧时刻表定下', { event: 'recording.pauses.timing', context: { pauses: pauses.length, recorded: result.length } })
      return result
    }
  }
  return alignedPauses(pauses, controls, screens)
}

/** 没按停止就结束的（取消、失败、崩溃）以最后一帧画面为录制终点。 */
function pictureEndUs(files: ReadonlyArray<{ monoUs: number; durationUs: number }>): number | undefined {
  return files.length ? Math.max(...files.map(file => file.monoUs + file.durationUs)) : undefined
}

/**
 * 每路声音拼成连续的一条交给剪辑，麦克风缺的采样从原生整段副本补齐，补上的空档从轨道里去掉；
 * 拼不成（例如磁盘满）就沿用逐段文件和原来的空档，只是片段多。摄像头保持分段。
 */
async function recordingAudio(directory: string, tracks: RecordingTracks, untilUs?: number): Promise<{ media: RecordingMedia[]; tracks: RecordingTracks; joined: boolean }> {
  const segments = (kinds: RecordingTrackKind[]): RecordingMedia[] => tracks.tracks.filter(track => kinds.includes(track.kind)).flatMap(track => track.segments.map(segment => ({
    id: segment.id, kind: track.kind, path: path.join(directory, segment.file), monoUs: segment.monoSpanUs[0], durationUs: segment.monoSpanUs[1] - segment.monoSpanUs[0],
  })))
  const started = performance.now()
  try {
    const { audio, gaps } = await joinRecordingAudio(directory, tracks, untilUs)
    const filled = tracks.tracks.reduce((sum, track) => sum + track.gaps.length - (gaps.get(track.kind) ?? track.gaps).length, 0)
    logger.info('录制声音已拼成连续轨道', { event: 'recording.audio.join.completed', context: { files: audio.length, filledGaps: filled, durationMs: Math.round(performance.now() - started) } })
    return { joined: true, tracks: { ...tracks, tracks: tracks.tracks.map(track => ({ ...track, gaps: gaps.get(track.kind) ?? track.gaps })) },
      media: [...audio.map(item => ({ id: path.basename(item.path, '.wav'), kind: item.kind, path: item.path, monoUs: item.monoUs, durationUs: item.durationUs })), ...segments(['camera'])] }
  } catch (error) {
    logger.error('录制声音拼接失败，按分段导入', { event: 'recording.audio.join.failed', error })
    return { joined: false, tracks, media: segments(['microphone', 'systemAudio', 'camera']) }
  }
}

/** 原生整段副本拼接后已经用不上：麦克风有分段、拼接成功才删；一段都没有时留着备查。 */
async function removeNativeMicrophoneCopies(directory: string, tracks: RecordingTracks): Promise<void> {
  const names = (await readdir(directory).catch(() => [] as string[])).filter(name => NATIVE_MICROPHONE_FILE.test(name))
  if (!names.length) return
  if (!tracks.tracks.find(track => track.kind === 'microphone')?.segments.length) { logger.warn('麦克风没有录到分段，保留原生整段副本', { event: 'recording.microphone.native_copy.kept', context: { files: names.length } }); return }
  for (const name of names) await rm(path.join(directory, name), { force: true }).catch(error => logger.warn('麦克风原生副本仍被占用，稍后可手动删除', { event: 'recording.microphone.native_copy.busy', error }))
}

export async function readRecordingEvents(documentId: string, offset: number, limit: number, markersOnly: boolean, livePages?: readonly PageReference[]): Promise<{ events: CaptureEvent[]; nextOffset: number | null }> {
  const read = await getDocumentService().readDocument({ id: documentId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content = recordingDocumentSchema.parse(read.content)
  const events: CaptureEvent[] = []
  let index = 0
  // 录制进行中页索引还在内存里，文档要到停止时才写入。
  for (const reference of livePages ?? content.eventPages) {
    // Full-event offsets count all entries. Skip preceding pages without repeatedly decoding
    // an entire long recording; marker-only offsets still require reading/filtering each page.
    const count = reference.lastSequence - reference.firstSequence + 1
    if (!markersOnly && index + count <= offset) { index += count; continue }
    // Paths come only from the authoritative document, never from caller input.
    const text = await readFile(reference.path, 'utf8')
    const expected = /-([a-f0-9]{64})\.capture\.json$/.exec(path.basename(reference.path))?.[1]
    if (!expected || createHash('sha256').update(text).digest('hex') !== expected) throw new Error('采集页校验失败')
    const page = captureLogPageSchema.parse(JSON.parse(text))
    if (page.ownerRef.id !== content.sessionId || page.seqSpan[0] !== reference.firstSequence || page.seqSpan[1] !== reference.lastSequence) throw new Error('采集页归属不符')
    for (const event of page.entries) {
      if (markersOnly && event.kind !== 'mark') continue
      if (index++ < offset) continue
      if (events.length === limit) return { events, nextOffset: offset + events.length }
      events.push(event)
    }
  }
  return { events, nextOffset: null }
}

/**
 * 界面与助手共用的恢复。只读已落盘的事实（画面分片、事件页、轨道记录与声音文件），不启动设备、不重放操作；
 * 重复执行结果相同。
 */
export async function recoverRecordingSession(documentId: string, directory: string): Promise<{ name: string; durationUs: number; status: RecordingDocument['status'] }> {
  const read = await getDocumentService().readDocument({ id: documentId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content = recordingDocumentSchema.parse(read.content)
  const result = (): { name: string; durationUs: number; status: RecordingDocument['status'] } => ({ name: read.meta.name, durationUs: recordingDurationUs(content), status: content.status })
  // 已经收尾或恢复过的不再重做：补声音用的原生副本在第一次之后就清理了，重做只会更差。
  if (!recordingNeedsRecovery(content)) return result()
  if (content.sessionId !== documentId) throw new Error('副本不能恢复原录制，请打开原会话')
  logger.info('恢复中断的录制', { event: 'recording.session.recover.start', context: { sessionId: documentId, status: content.status } })
  const capture = await recoverCapture(directory)
  const screen = capture.files.map(file => ({ id: `screen-${file.index}`, kind: 'screen' as const, path: file.path, monoUs: file.monoUs, durationUs: file.durationUs }))
  content.eventPages = []; content.markers = []
  const controls: PauseControl[] = []
  for await (const page of new RecordingEventStore(directory).recover()) {
    if (page.ownerRef.id !== content.sessionId) throw new Error('采集页不属于该录制')
    const hash = createHash('sha256').update(JSON.stringify(page)).digest('hex')
    content.eventPages.push({ path: path.join(directory, `${String(page.seqSpan[0]).padStart(16, '0')}-${hash}.capture.json`), firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] })
    for (const event of page.entries) {
      if (event.kind === 'mark') content.markers.push({ id: event.eventId, monoUs: event.monoUs, note: event.note ?? '' })
      collectPauseControl(controls, event)
    }
  }
  if (content.pauses) content.pauses = await recordedPauses(content.pauses, controls, capture.files)
  // 早于轨道记录的录制没有 tracks.journal：沿用文档里录制期间存下的轨道。
  const replayed = await replayTrackJournal(directory, documentId, content.originUs, trackKinds(content.devices), content.devices.camera?.frameRate) ?? content.tracks
  const audio = replayed ? await recordingAudio(directory, replayed, content.endUs ?? pictureEndUs(capture.files)) : null
  content.tracks = audio?.tracks ?? replayed
  content.media = [...screen, ...audio ? audio.media : content.media.filter(media => media.kind !== 'screen')]
  // 停在倒计时里就中断的会话什么也没录到：当作已结束，不再当成待恢复的录制。
  content.status = content.media.some(media => media.durationUs > 0) ? 'interrupted' : 'stopped'
  await getDocumentService().saveDocument({ target: { id: documentId }, expectedRevision: read.meta.revision, content })
  if (audio?.joined) await removeNativeMicrophoneCopies(directory, audio.tracks)
  logger.info('中断的录制已恢复', { event: 'recording.session.recover.completed', context: { sessionId: documentId, status: content.status, screenSpans: screen.length, rejectedSpans: capture.rejected.length, eventPages: content.eventPages.length, audio: content.media.filter(media => media.kind !== 'screen').length } })
  return result()
}
