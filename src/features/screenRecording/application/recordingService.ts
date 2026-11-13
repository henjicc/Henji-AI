import { isRemovedVideoEditTransition } from '@/core/videoEdit/transitionCatalog'
import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { recordingDocumentSchema, type RecordingDocument } from '@/core/screenRecording/document'
import type { RecordingSessionOptions } from '@/core/screenRecording/sessionOptions'
import type { ScreenCaptureOptions } from '@/core/screenRecording/capture'
import type { CaptureKind, RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { CaptureEvent } from '@/core/captureLog/events'
import { recordingDurationUs, recordingRange } from '@/core/screenRecording/range'
import { attachScreenCapture, prepareScreenCapture, type ScreenCaptureSession } from '../capture/session'
import type { RecoveredRecording } from '@/core/screenRecording/capture'
import { recordingTimeLabel } from '../useRecordingControlSnapshot'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { defaultDocumentOperationChanges, markSessionDocumentOpened } from '@/features/documents'
import { notifyUser } from '@/contexts/NotificationContext'
import { notificationMessage, notificationText } from '@/i18n/notifications'

const logger = createLogger('features.screenRecording.session')
/**
 * 录好的素材放进哪份剪辑、哪条序列。`placement` 放在序列的录屏轨上（剪辑的录制样子）：`end` 接在末尾，`overwrite` 从 `frame` 起覆盖，
 * 盖到哪算哪；省略时按 `frame` 放到空轨道上。
 */
export interface RecordingDestination {
  documentId: string; sequenceId?: string; frame?: number; placement?: 'end' | 'overwrite'
  /** 开始时录屏轨的指纹（`videoEditRecordingLaneBasis`）：停止时对不上就不按 `frame` 覆盖，改为接在末尾。 */
  basis?: string
}
/** `opening` covers the moment between stop and the edit appearing, so the page never flashes the setup. */
interface View { documentId: string | null; snapshot: RecordingControlSnapshot | null; content: RecordingDocument | null; busy: boolean; opening: boolean; error: string | null; destination: RecordingDestination | null }
let view: View = { documentId: null, snapshot: null, content: null, busy: false, opening: false, error: null, destination: null }
const quickSessions = new Map<string, { directory?: string }>()
/** Sessions started from the recording page: when they stop, the person is taken to the result. */
const handoffSessions = new Set<string>()
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
/** Quick mode ends as one MP4 in the chosen folder; a toast says where, with a way to show it. */
export async function saveQuickRecording(sessionId: string, directory?: string): Promise<string> {
  try {
    const result = await getPlatform().screenRecording.capture({ operation: 'quick-export', sessionId, ...(directory ? { directory } : {}) }) as { path: string; durationUs: number }
    const reveal = (): void => { void revealQuickRecording(sessionId).catch(error => logger.warn('显示视频文件失败', { event: 'recording.quick_export.reveal_failed', error })) }
    notifyUser(notificationMessage('recordingVideoSaved', { name: result.path.split(/[\\/]/).at(-1) ?? '' }), 'success', { label: notificationText('recordingReveal'), onClick: reveal })
    return result.path
  } catch (error) {
    logger.error('快速录制保存视频失败', { event: 'recording.quick_export.failed', error, context: { sessionId } })
    notifyUser(notificationMessage('recordingVideoFailed', { error: error instanceof Error ? error.message : String(error) }), 'error')
    throw error
  }
}
export async function revealQuickRecording(sessionId: string): Promise<void> {
  await getPlatform().screenRecording.capture({ operation: 'reveal-export', sessionId })
}
/** Stopping inside the countdown leaves nothing recorded; there is nothing to save or edit then. */
function recordingHasPicture(content: RecordingDocument): boolean {
  const range = recordingRange(content)
  return range.endUs > range.startUs && content.media.some(media => media.kind === 'screen' && media.durationUs > 0)
}
export async function readRecordingDocument(id: string): Promise<RecordingDocument> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  return recordingDocumentSchema.parse(read.content)
}
export async function showRecordingDocument(id: string): Promise<void> {
  if (capture && view.documentId !== id) throw new Error('请先结束当前录制')
  const content = await readRecordingDocument(id)
  const removed = content.scriptCapture.baselines.flatMap(baseline => baseline.content.sequences.flatMap(sequence => (sequence.transitions ?? []).filter(transition => isRemovedVideoEditTransition(transition.kind))))
  if (removed.length) logger.warn('此过渡已移除，按交叉溶解播放', { event: 'recording.document.removed_transitions_tolerated', context: { documentId: id, kinds: [...new Set(removed.map(transition => transition.kind))] } })
  await markSessionDocumentOpened(id)
  publish({ documentId: id, content, error: null })
}
/**
 * 停止后录好的素材去了哪：导入了哪份剪辑（导入了哪些素材项），或存成了哪个视频文件（快速录制在后台存，存好前 path 为空）。
 * 停止的回执据此说清楚，免得调用方以为没导入又导一遍。
 */
export type RecordingStopOutcome = { kind: 'edit'; documentId: string; sequenceId?: string; frame?: number; placement?: import('./recordingVideoImport').RecordingPlacementResult; itemIds?: string[]; combined?: boolean; screens?: number; separate?: string } | { kind: 'file'; path?: string; error?: string }
const stopOutcomes = new Map<string, RecordingStopOutcome>()
export function recordingStopOutcome(id: string): RecordingStopOutcome | undefined { return stopOutcomes.get(id) }
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
      const handoff = handoffSessions.delete(id)
      // From the recording page the view goes straight back to setup: the result lives in the editor or the saved
      // file. Assistant and director runs keep reading the stopped session from here.
      publish(handoff ? { documentId: null, content: null, snapshot: null, opening: importResult && !quickSessions.has(id) } : { documentId: id, content, snapshot: null })
      if (closeFailure) throw closeFailure
      const quick = quickSessions.get(id)
      quickSessions.delete(id)
      const recorded = recordingHasPicture(content)
      if (importResult && recorded && quick) {
        stopOutcomes.set(id, { kind: 'file' })
        void saveQuickRecording(id, quick.directory).then(path => { stopOutcomes.set(id, { kind: 'file', path }) }, error => { stopOutcomes.set(id, { kind: 'file', error: error instanceof Error ? error.message : String(error) }) })
      } else if (importResult && recorded && handoff) {
        const { openRecordingInEditor } = await import('./recordingVideoImport')
        try {
          const { imported, placement: _requested, basis: _basis, ...target } = await openRecordingInEditor(id, destination)
          stopOutcomes.set(id, { kind: 'edit', ...target, ...imported })
        }
        catch (error) { notifyUser(notificationMessage('recordingEditFailed', { error: error instanceof Error ? error.message : String(error) }), 'error'); throw error }
      } else if (importResult && recorded && destination) {
        // Assistant and director runs keep control of what happens next; they only fill the edit they named.
        const { importRecordingToVideo } = await import('./recordingVideoImport')
        // 回执写实际落点（导入的 placement 结果），不写开始时请求的放置方式与录屏轨指纹。
        const { placement: _requested, basis: _basis, ...where } = destination
        stopOutcomes.set(id, { kind: 'edit', ...where, ...await importRecordingToVideo(id, destination) })
      }
      defaultDocumentOperationChanges.changed()
      logger.info('录制会话已封存', { event: 'recording.session.finish.completed', context: { sessionId: id } })
    } catch (error) { publish({ error: String(error) }); logger.error('录制会话收尾失败', { event: 'recording.session.finish.failed', error }); throw error }
    finally { releaseTarget?.(); releaseTarget = undefined; publish({ busy: false, opening: false }); finishing = undefined }
  })()
  return finishing
}
export async function startRecording(options: ScreenCaptureOptions, session: RecordingSessionOptions, destination: RecordingDestination | null = null, signal?: AbortSignal, quick?: { directory?: string }, handoff = false): Promise<string> {
  if (capture || view.busy) throw new Error('请先停止或取消当前录制')
  const id = crypto.randomUUID()
  const api = getPlatform().screenRecording
  if (quick) quickSessions.set(id, quick)
  if (handoff) handoffSessions.add(id)
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
    capture = await prepareScreenCapture(id, options, { ...session, ...(projectId ? { projectId } : {}) }, quick ? 'embed' : undefined, { handoff, ...(quick ? { quick } : {}), ...(destination ? { destination } : {}) })
    publish({ documentId: id, content: await readRecordingDocument(id), snapshot: await api.snapshot() })
    defaultDocumentOperationChanges.changed()
    follow(id)
    signal?.throwIfAborted()
    await api.control(id, 'toggle')
    logger.info('录制会话已准备', { event: 'recording.session.start.completed', context: { sessionId: id } })
    return id
  } catch (error) {
    quickSessions.delete(id); handoffSessions.delete(id)
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
/** 停止由主进程状态驱动：控制条、快捷键、助手哪一处按的都一样收尾。 */
function follow(id: string): void {
  detach?.()
  detach = getPlatform().screenRecording.onChanged(snapshot => {
    if (snapshot && snapshot.sessionId !== id) return
    publish({ snapshot })
    if (snapshot?.phase === 'stopped' && !snapshot.busy) void finish(id, true).catch(() => undefined)
  })
}

/**
 * 界面进程重载或崩溃重开后，接回主进程里还在进行的录制：显示时长、可以暂停和停止，停止后照原来的安排进剪辑或存成视频。
 * 声音与摄像头在断开期间没有数据，主进程记作空档。
 */
export async function attachActiveRecording(): Promise<void> {
  if (capture || view.busy) return
  const api = getPlatform().screenRecording
  const snapshot = await api.snapshot()
  if (!snapshot) return
  const id = snapshot.sessionId
  try {
    // 采集失败时主进程已经收尾保存，只剩控制条要关。
    if (snapshot.phase === 'failed') { await api.capture({ operation: 'close', sessionId: id }); return }
    const phase = snapshot.phase === 'countdown' || snapshot.phase === 'recording' || snapshot.phase === 'paused' ? snapshot.phase : 'ready'
    const { capture: attached, attachment } = await attachScreenCapture(id, phase)
    capture = attached
    const followUp = attachment.followUp
    if (followUp?.handoff) handoffSessions.add(id)
    if (followUp?.quick) quickSessions.set(id, followUp.quick)
    // 先订阅再做耗时的事：期间停下的录制不会漏掉“已停止”。
    follow(id)
    publish({ destination: followUp?.destination ?? null, error: null })
    // 录制期间目标剪辑一直被占着，重载后的新界面重新登记。
    if (followUp?.destination) {
      const { openVideoEditDocument, holdVideoEditActivity } = await import('@/features/videoEdit')
      try { await openVideoEditDocument({ id: followUp.destination.documentId }, { focus: false }); releaseTarget = holdVideoEditActivity(followUp.destination.documentId, '屏幕录制') }
      catch (error) { logger.warn('接回录制时目标剪辑未能打开', { event: 'recording.session.attach.destination_failed', error }) }
    }
    const current = await api.snapshot()
    publish({ documentId: id, content: await readRecordingDocument(id), snapshot: current })
    logger.info('已接回进行中的录制', { event: 'recording.session.attach.completed', context: { sessionId: id, phase: current?.phase } })
    // 界面断开期间用快捷键或控制条停下的录制：照原来的安排进剪辑或存成视频。
    if (current?.sessionId === id && current.phase === 'stopped' && !current.busy) void finish(id, true).catch(() => undefined)
  } catch (error) { logger.error('接回进行中的录制失败', { event: 'recording.session.attach.failed', error, context: { sessionId: id } }) }
}

/** 应用上次意外退出时没收尾的录制：主进程补齐后，在这里提示一次，可以直接进剪辑。 */
export async function recoverUnfinishedRecordings(): Promise<RecoveredRecording[]> {
  const recovered = await getPlatform().screenRecording.capture({ operation: 'unfinished' }) as RecoveredRecording[]
  for (const item of recovered) {
    logger.info('上次中断的录制已自动恢复', { event: 'recording.session.recover.notified', context: { sessionId: item.documentId, durationUs: item.durationUs } })
    notifyUser(notificationMessage('recordingRecovered', { name: item.name, duration: recordingTimeLabel(item.durationUs / 1000) }), 'warning', { label: notificationText('recordingRecoveredOpen'), onClick: () => {
      void import('./recordingVideoImport').then(module => module.openRecordingInEditor(item.documentId)).catch(error => notifyUser(notificationMessage('recordingEditFailed', { error: error instanceof Error ? error.message : String(error) }), 'error'))
    } })
  }
  if (recovered.length) defaultDocumentOperationChanges.changed()
  return recovered
}

/** 两周内中断、还没进过剪辑的录制；录制页据此提示可以接着用。 */
export async function listInterruptedRecordings(): Promise<RecoveredRecording[]> {
  const since = Date.now() - 14 * 24 * 3600 * 1000
  const candidates = (await getPlatform().documents.listDocuments({ kind: 'screen_recording', includeMissing: false }))
    .filter(document => document.summary.status === 'interrupted' && document.updatedAt >= since && document.id !== view.snapshot?.sessionId)
  const found: RecoveredRecording[] = []
  for (const document of candidates.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const content = await readRecordingDocument(document.id).catch(() => null)
    if (!content || content.compositions.length || !content.media.some(media => media.kind === 'screen' && media.durationUs > 0)) continue
    found.push({ documentId: document.id, name: document.name, durationUs: recordingDurationUs(content) })
  }
  return found
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
