import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { recordingDocumentSchema, type RecordingDocument } from '@/core/screenRecording/document'
import type { RecordingSessionOptions } from '@/core/screenRecording/sessionOptions'
import type { ScreenCaptureOptions } from '@/core/screenRecording/capture'
import type { CaptureKind, RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { CaptureEvent } from '@/core/captureLog/events'
import { prepareScreenCapture, type ScreenCaptureSession } from '../capture/session'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { defaultDocumentOperationChanges, markSessionDocumentOpened } from '@/features/documents'

const logger = createLogger('features.screenRecording.session')
export interface RecordingDestination { documentId: string; sequenceId?: string; frame?: number }
interface View { documentId: string | null; snapshot: RecordingControlSnapshot | null; content: RecordingDocument | null; busy: boolean; error: string | null; destination: RecordingDestination | null }
let view: View = { documentId: null, snapshot: null, content: null, busy: false, error: null, destination: null }
let capture: ScreenCaptureSession | undefined
let detach: (() => void) | undefined
let finishing: Promise<void> | undefined
let releaseTarget: (() => void) | undefined
const listeners = new Set<() => void>()
export const recordingView = (): View => view
export function subscribeRecording(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(change: Partial<View>): void { view = { ...view, ...change }; for (const listener of listeners) listener() }
export function setRecordingDestination(destination: RecordingDestination | null): void {
  if (capture || view.busy) throw new Error('请先结束当前录制')
  publish({ destination, documentId: null, content: null, error: null })
}
export async function readRecordingDocument(id: string): Promise<RecordingDocument> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  return recordingDocumentSchema.parse(read.content)
}
export async function showRecordingDocument(id: string): Promise<void> {
  if (capture && view.documentId !== id) throw new Error('请先结束当前录制')
  const content = await readRecordingDocument(id)
  await markSessionDocumentOpened(id)
  publish({ documentId: id, content, error: null })
}
async function finish(id: string, importResult: boolean): Promise<void> {
  if (finishing) return finishing
  if (!capture) return
  const current = capture
  const destination = view.destination
  finishing = (async () => {
    publish({ busy: true })
    try {
      let closeFailure: unknown
      try { await current.close() } catch (error) { closeFailure = error }
      finally { if (capture === current) capture = undefined; detach?.(); detach = undefined }
      const content = await readRecordingDocument(id)
      publish({ documentId: id, content, snapshot: null })
      if (closeFailure) throw closeFailure
      if (importResult && destination && content.media.some(media => media.durationUs > 0)) {
        const { importRecordingToVideo } = await import('./recordingVideoImport')
        await importRecordingToVideo(id, destination)
      }
      defaultDocumentOperationChanges.changed()
      logger.info('录制会话已封存', { event: 'recording.session.finish.completed', context: { sessionId: id } })
    } catch (error) { publish({ error: String(error) }); logger.error('录制会话收尾失败', { event: 'recording.session.finish.failed', error }); throw error }
    finally { releaseTarget?.(); releaseTarget = undefined; publish({ busy: false }); finishing = undefined }
  })()
  return finishing
}
export async function startRecording(options: ScreenCaptureOptions, session: RecordingSessionOptions, destination: RecordingDestination | null = null, signal?: AbortSignal): Promise<string> {
  if (capture || view.busy) throw new Error('请先停止或取消当前录制')
  const id = crypto.randomUUID()
  const api = getPlatform().screenRecording
  publish({ busy: true, error: null, destination, documentId: id })
  logger.info('准备录制会话', { event: 'recording.session.start.start', context: { sessionId: id } })
  try {
    signal?.throwIfAborted()
    let projectId = session.projectId
    if (destination) {
      const { openVideoEditDocument, holdVideoEditActivity } = await import('@/features/videoEdit')
      const owner = await openVideoEditDocument({ id: destination.documentId }, { focus: false })
      if (owner.session.documentMeta.container.kind !== 'project') throw new Error('目标剪辑必须位于项目中')
      projectId = owner.session.documentMeta.container.projectId
      releaseTarget = holdVideoEditActivity(destination.documentId, '屏幕录制')
    }
    const kinds: CaptureKind[] = ['screen', ...(session.tracks.microphone ? ['microphone' as const] : []), ...(session.tracks.systemAudio ? ['systemAudio' as const] : []), ...(session.tracks.camera ? ['camera' as const] : [])]
    await api.grant({ sessionId: id, userReceipt: crypto.randomUUID(), kinds, selection: { sourceId: options.sourceId, excludedSourceIds: [] } })
    signal?.throwIfAborted()
    capture = await prepareScreenCapture(id, options, { ...session, ...(projectId ? { projectId } : {}) })
    publish({ documentId: id, content: await readRecordingDocument(id), snapshot: await api.snapshot() })
    defaultDocumentOperationChanges.changed()
    detach = api.onChanged(snapshot => {
      if (snapshot && snapshot.sessionId !== id) return
      publish({ snapshot })
      if (snapshot?.phase === 'stopped' && !snapshot.busy) void finish(id, true).catch(() => undefined)
    })
    signal?.throwIfAborted()
    await api.control(id, 'toggle')
    logger.info('录制会话已准备', { event: 'recording.session.start.completed', context: { sessionId: id } })
    return id
  } catch (error) {
    try { await capture?.close() } finally { capture = undefined; detach?.(); detach = undefined; releaseTarget?.(); releaseTarget = undefined; await api.revoke(id) }
    publish({ error: String(error) }); logger.error('准备录制失败', { event: 'recording.session.start.failed', error }); throw error
  } finally { publish({ busy: false }) }
}
export async function controlRecording(id: string, action: 'pause' | 'resume' | 'mark' | 'stop' | 'cancel', note?: string): Promise<void> {
  const api = getPlatform().screenRecording
  const state = await api.snapshot()
  if (!state || state.sessionId !== id) throw new Error('该录制已结束，请读取会话查看保存结果')
  if (action === 'cancel') { await finish(id, false); return }
  if (action === 'pause' && state.phase !== 'recording' || action === 'resume' && state.phase !== 'paused') throw new Error('录制状态已变化，请读取会话后重试')
  await api.control(id, action === 'pause' || action === 'resume' ? 'toggle' : action, note)
  if (action === 'stop') await finish(id, true)
}
export async function recoverRecording(id: string): Promise<void> {
  await getPlatform().screenRecording.capture({ operation: 'recover-session', sessionId: id })
  await showRecordingDocument(id)
}
export async function recordingEvents(id: string, offset = 0, limit = 100, markersOnly = false): Promise<{ events: CaptureEvent[]; nextOffset: number | null }> {
  return await getPlatform().screenRecording.capture({ operation: 'events', sessionId: id, offset, limit, markersOnly }) as { events: CaptureEvent[]; nextOffset: number | null }
}
registerApplicationCloseGuard(async () => {
  if (!capture) return
  const state = await getPlatform().screenRecording.snapshot()
  if (capture && state) await controlRecording(state.sessionId, state.phase === 'failed' ? 'cancel' : 'stop')
})
