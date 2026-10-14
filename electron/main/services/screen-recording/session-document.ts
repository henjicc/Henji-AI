import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { CaptureLogPage, CaptureEvent } from '../../../../src/core/captureLog/events'
import { captureLogPageSchema } from '../../../../src/core/captureLog/events'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../../../src/core/screenRecording/document'
import type { RecordingSessionOptions } from '../../../../src/core/screenRecording/sessionOptions'
import type { CaptureManifest } from '../../../../src/core/screenRecording/capture'
import { recordingTracksSchema, type RecordingTracks } from '../../../../src/core/screenRecording/tracks'
import type { DocumentMeta } from '../../../../src/core/documents/types'
import { getDocumentService } from '../documents/runtime'
import { createMainLogger } from '../logging'
import { RecordingEventStore } from './event-store'
import { recoverCapture } from './capture/storage'
import type { RecordingScriptCapture } from '../../../../src/core/screenRecording/script'

const logger = createMainLogger('main.screen_recording.document')

/** One main-process document writer. Pages and media acknowledge only after their references are durable. */
export class RecordingSessionDocument {
  private queue: Promise<void> = Promise.resolve()
  private constructor(readonly content: RecordingDocument, private meta: DocumentMeta, readonly directory: string) {}

  static async create(id: string, originUs: number, options: RecordingSessionOptions, sourceName: string, capture: CaptureManifest, directory: string): Promise<RecordingSessionDocument> {
    const content = createRecordingDocument()
    Object.assign(content, { sessionId: id, originUs, status: 'prepared', source: { name: sourceName, options: capture.options, cursorEmbedded: capture.cursorEmbedded }, devices: options.tracks })
    logger.info('创建录制会话', { event: 'recording.document.create.start', context: { sessionId: id } })
    const read = await getDocumentService().createDocument({ id, kind: 'screen_recording', name: options.name, draft: false,
      container: options.projectId ? { kind: 'project', projectId: options.projectId } : { kind: 'user' }, content })
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
    this.content.status = manifest.status === 'failed' ? 'interrupted' : manifest.status
    this.content.media = [...this.content.media.filter(media => media.kind !== 'screen'), ...manifest.spans.map(span => ({
      id: `screen-${span.index}`, kind: 'screen' as const, path: path.join(this.directory, span.file), monoUs: span.monoUs, durationUs: span.durationUs,
    }))]
    return this.save()
  }
  tracks(tracks: RecordingTracks): Promise<void> {
    if (tracks.sessionId !== this.content.sessionId || tracks.originUs !== this.content.originUs) throw new Error('录制轨道时钟或归属不符')
    this.content.tracks = recordingTracksSchema.parse(tracks)
    this.content.media = [...this.content.media.filter(media => media.kind === 'screen'), ...tracks.tracks.flatMap(track => track.segments.map(segment => ({
      id: segment.id, kind: track.kind, path: path.join(this.directory, segment.file), monoUs: segment.monoSpanUs[0], durationUs: segment.monoSpanUs[1] - segment.monoSpanUs[0],
    })))]
    return this.save()
  }
  range(edge: 'startUs' | 'endUs', monoUs: number): Promise<void> {
    this.content[edge] = Math.max(0, Math.round(monoUs))
    return this.save()
  }
  page(page: CaptureLogPage, file: string): Promise<void> {
    this.content.eventPages.push({ path: file, firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] })
    for (const entry of page.entries) if (entry.kind === 'mark') this.content.markers.push({ id: entry.eventId, monoUs: entry.monoUs, note: entry.note ?? '' })
    return this.save()
  }
}

export async function readRecordingEvents(documentId: string, offset: number, limit: number, markersOnly: boolean): Promise<{ events: CaptureEvent[]; nextOffset: number | null }> {
  const read = await getDocumentService().readDocument({ id: documentId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content = recordingDocumentSchema.parse(read.content)
  const events: CaptureEvent[] = []
  let index = 0
  for (const reference of content.eventPages) {
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

/** Recovery reads durable facts only. It never starts devices or replays application operations. */
export async function recoverRecordingSession(documentId: string, directory: string): Promise<void> {
  const read = await getDocumentService().readDocument({ id: documentId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content = recordingDocumentSchema.parse(read.content)
  if (content.status === 'stopped') return
  if (content.sessionId !== documentId) throw new Error('副本不能恢复原录制，请打开原会话')
  const recovery = await recoverCapture(directory)
  content.media = [...content.media.filter(media => media.kind !== 'screen'), ...recovery.files.map((file, index) => ({ id: `recovered-${index}`, kind: 'screen' as const, ...file }))]
  content.eventPages = []; content.markers = []
  for await (const page of new RecordingEventStore(directory).recover()) {
    if (page.ownerRef.id !== content.sessionId) throw new Error('采集页不属于该录制')
    const hash = createHash('sha256').update(JSON.stringify(page)).digest('hex')
    content.eventPages.push({ path: path.join(directory, `${String(page.seqSpan[0]).padStart(16, '0')}-${hash}.capture.json`), firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] })
    for (const event of page.entries) if (event.kind === 'mark') content.markers.push({ id: event.eventId, monoUs: event.monoUs, note: event.note ?? '' })
  }
  content.status = 'interrupted'
  await getDocumentService().saveDocument({ target: { id: documentId }, expectedRevision: read.meta.revision, content })
}
