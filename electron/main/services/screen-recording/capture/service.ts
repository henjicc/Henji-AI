import { recordingEncoderChoices } from '../../video/hwaccel'
import { BrowserWindow, screen, shell, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { release } from 'node:os'
import path from 'node:path'
import type { CaptureAttachment, CaptureBackendKind, CaptureCommand, CaptureFollowUp, CaptureManifest, CaptureOperation, CapturePrepared, CaptureRequest, RecoveredRecording, ScreenCaptureBackend } from '../../../../../src/core/screenRecording/capture'
import type { RecordingSessionOptions } from '../../../../../src/core/screenRecording/sessionOptions'
import type { CaptureKind } from '../../../../../src/core/screenRecording/contracts'
import { getUserFolderDir } from '../../appPaths'
import { getDocumentService } from '../../documents/runtime'
import { mediaPermissions } from '../../media-permissions'
import { createMainLogger } from '../../logging'
import { openRecordingControl, closeRecordingControl, minimizeOwnerWhileRecording, notifyRecordingProblem, recordingControl, recordingEventBacklog } from '../runtime'
import { CaptureStorage, recoverCapture } from './storage'
import { GfxCaptureBackend } from './gfxcapture'
import { systemCursorLook } from './cursor-look'
import { resolveNativeCaptureSource } from './source'
import { createCaptureBounds, createCaptureGeometry } from './geometry'
import { RecordingSessionDocument, readRecordingEvents, recoverRecordingSession } from '../session-document'
import { exportQuickRecording, quickExportPath } from '../quick-export'
import { systemAudioCapture, type SystemAudioRecorder } from '../../audio-capture/system-audio'
import { nativeSystemAudioSupported } from '../../../../../src/platform/contracts/audioCapture'

const logger = createMainLogger('main.screen_recording.capture')
interface Active {
  owner: WebContents; storage: CaptureStorage; backend: ScreenCaptureBackend; originUs: number
  rpc: Map<string, { resolve(): void; reject(error: Error): void }>
  document?: RecordingSessionDocument
  /** 声音与摄像头由界面写；界面进程重载或崩溃期间为 false，画面与事件照常在主进程录。 */
  tracksAttached: boolean
  /** 采集本身出错（区别于用户取消）。 */
  failed: boolean
  session?: RecordingSessionOptions
  followUp?: CaptureFollowUp
  prepared: CapturePrepared
  /** 停止与取消都会走到收尾（失败后关控制条还会再取消一次），只收一次。 */
  finishing?: Promise<void>
  /** Windows 上系统声由原生录音服务在主进程这边录：与画面、事件一样不依赖界面。开始后才有录制器。 */
  systemAudio?: { recorder?: SystemAudioRecorder }
}
let active: Active | null = null
/** 正在准备的会话：文档已建、还没成为 active，启动恢复不能把它当成上次崩溃留下的。 */
let preparing: string | null = null
const now = (): number => Number(process.hrtime.bigint() / 1000n)
const sessionDirectory = (sessionId: string): string => path.join(getUserFolderDir('uploads'), 'screen-recordings', sessionId)

async function remote(session: Active, operation: CaptureOperation): Promise<void> {
  // 界面不在时声音轨已经断开，没有可以等的回执；重新接上的界面按当时的阶段自己开始。
  if (!session.tracksAttached) return
  if (session.owner.isDestroyed()) throw new Error('录制窗口已经关闭')
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { session.rpc.delete(requestId); reject(new Error('采集窗口未响应，已写片段可以恢复')) }, operation === 'cancel' ? 2000 : 20000)
    session.rpc.set(requestId, { resolve: () => { clearTimeout(timer); resolve() }, reject: error => { clearTimeout(timer); reject(error) } })
    const command: CaptureCommand = { sessionId: session.storage.manifest.sessionId, requestId, operation }
    session.owner.send('screenRecording:captureCommand', command)
  })
}
async function fail(session: Active, error: Error): Promise<void> {
  if (active !== session || session.storage.manifest.status === 'failed') return
  session.storage.manifest.status = 'failed'; session.failed = true
  logger.error('屏幕录制失败', { event: 'recording.capture.failed', error })
  await recordingControl.captureFailed(session.storage.manifest.sessionId, error)
}

/**
 * 界面进程重载或崩溃：画面（原生采集）和事件在主进程照常录，只记下声音轨从这里断开，等界面回来重新接上。
 * 兼容采集的画面本身在界面里编码，界面没了就录不下去，按采集失败收尾、保住已录部分。
 */
function ownerLost(session: Active): void {
  if (active !== session) return
  if (session.storage.manifest.backend === 'chromium' || !session.document) {
    session.tracksAttached = false
    void fail(session, new Error('界面进程已退出，兼容录制无法继续；已录部分可以导入。')).catch(error => logger.error('界面退出后录制收尾失败', { event: 'recording.host.lost_cleanup.failed', error }))
    return
  }
  if (!session.tracksAttached) return
  session.tracksAttached = false
  for (const pending of session.rpc.values()) pending.resolve()
  session.rpc.clear()
  void session.document.track({ type: 'detach', atUs: now() - session.originUs })
  logger.warn('界面进程断开，画面继续录制，声音等待界面重新接上', { event: 'recording.host.detached', context: { sessionId: session.prepared.sessionId } })
}

/** 系统声跟着画面开始、暂停、恢复、停止；轨道记录直接进录制文档的轨道记录，与界面写的麦克风、摄像头同一份。 */
async function systemAudioStep(session: Active, operation: Exclude<CaptureOperation, 'cancel'>, signal: AbortSignal): Promise<void> {
  const host = session.systemAudio, document = session.document
  if (!host || !document) return
  const sessionId = session.prepared.sessionId
  if (operation === 'start') {
    const recorder = await systemAudioCapture().start({
      directory: session.storage.directory, originUs: session.originUs,
      record: record => { void document.track(record) },
      failed: error => { void fail(session, error).catch(failure => logger.error('系统声失败后收尾失败', { event: 'recording.system_audio.cleanup.failed', error: failure })) },
      available: available => recordingControl.setHostTrackWarning(sessionId, 'device-disconnected', !available),
    })
    // 开始途中录制已被取消：这一路随即收尾，不留在后台录。
    if (active !== session || signal.aborted) { await recorder.stop(); signal.throwIfAborted(); return }
    host.recorder = recorder
  } else if (operation === 'pause') await host.recorder?.pause()
  else if (operation === 'resume') await host.recorder?.resume()
  else await host.recorder?.stop(now() - session.originUs)
}

function grantKinds(options: RecordingSessionOptions | undefined): CaptureKind[] {
  return ['screen', ...(options?.tracks.microphone ? ['microphone' as const] : []), ...(options?.tracks.systemAudio ? ['systemAudio' as const] : []), ...(options?.tracks.camera ? ['camera' as const] : [])]
}

/** 停止、取消、失败都走这里：一次写全文档，留一条汇总日志；意外停止时提醒用户。 */
async function finishSession(session: Active, document: RecordingSessionDocument): Promise<void> {
  const sessionId = session.prepared.sessionId
  try {
    const summary = await document.finish(session.storage.manifest)
    const capture = session.backend instanceof GfxCaptureBackend ? session.backend.stats() : undefined
    logger.info('录制结束汇总', { event: 'recording.capture.summary', context: { sessionId, backend: session.storage.manifest.backend, failed: session.failed, ...summary, eventPageBacklog: recordingEventBacklog(), ...capture ? { droppedFrames: capture.droppedFrames, duplicatedFrames: capture.duplicatedFrames, encoderRestarts: capture.restarts, encoder: capture.encoder } : {} } })
    if (session.failed) notifyRecordingProblem(session.owner, `录制意外停止，已保存 ${formatDuration(summary.durationUs)}，可以导入剪辑。`)
  } catch (error) {
    logger.error('录制收尾失败，已写文件保留，可以从录制页恢复', { event: 'recording.capture.finish.failed', error, context: { sessionId } })
    if (session.failed) notifyRecordingProblem(session.owner, '录制意外停止，已写的文件都在，导入或重启应用时会自动补齐。')
    throw error
  }
}
export function formatDuration(us: number): string {
  const seconds = Math.max(0, Math.round(us / 1_000_000)), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60
  return hours ? `${hours} 小时 ${minutes} 分` : minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}

/** 应用上次意外退出时停在录制中的会话：补齐后改成“已中断”，可以直接导入。正在录的这一个不算。 */
async function recoverUnfinished(): Promise<RecoveredRecording[]> {
  const recovered: RecoveredRecording[] = []
  for (const document of await getDocumentService().listDocuments({ kind: 'screen_recording', includeMissing: false })) {
    if (document.id === active?.prepared.sessionId || document.id === preparing || !['prepared', 'recording', 'paused'].includes(String(document.summary.status))) continue
    try {
      const result = await recoverRecordingSession(document.id, sessionDirectory(document.id))
      if (result.status === 'interrupted') recovered.push({ documentId: document.id, name: result.name, durationUs: result.durationUs })
    } catch (error) { logger.warn('上次中断的录制未能自动恢复', { event: 'recording.session.recover.failed', error, context: { sessionId: document.id } }) }
  }
  return recovered
}

export async function handleCaptureRequest(owner: WebContents, request: CaptureRequest): Promise<unknown> {
  if (request.operation === 'encoders') return recordingEncoderChoices(request.codec)
  if (request.operation === 'application-source') return BrowserWindow.fromWebContents(owner)?.getMediaSourceId() ?? null
  if (request.operation === 'events') return readRecordingEvents(request.sessionId, request.offset, request.limit, request.markersOnly, active?.prepared.sessionId === request.sessionId ? active.document?.pageReferences() : undefined)
  if (request.operation === 'unfinished') return recoverUnfinished()
  if (request.operation === 'quick-export') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先结束当前录制，再保存视频')
    return exportQuickRecording(request.sessionId, request.directory)
  }
  if (request.operation === 'reveal-export') {
    const file = quickExportPath(request.sessionId)
    if (!file) throw new Error('视频文件已移动或删除')
    shell.showItemInFolder(file); return
  }
  if (request.operation === 'recover-session') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先关闭当前录制，再恢复会话')
    return recoverRecordingSession(request.sessionId, sessionDirectory(request.sessionId))
  }
  if (request.operation === 'close' && recordingControl.snapshot()?.sessionId === request.sessionId && !active) return closeRecordingControl()
  if (request.operation === 'recover') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先关闭采集会话，再恢复片段')
    return recoverCapture(sessionDirectory(request.sessionId))
  }
  if (request.operation === 'prepare') {
    if (active || preparing) throw new Error('请先关闭当前录制会话')
    preparing = request.sessionId
    try {
      mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
      const source = (await mediaPermissions.sources([], false, request.options.sourceId.startsWith('screen:') ? 'screen' : 'window')).find(item => item.id === request.options.sourceId)
      if (!source) throw new Error('录制来源已关闭，请重新选择')
      const wgc = process.platform === 'win32' && Number(release().split('.')[2]) >= 18362
      let backend: CaptureBackendKind = request.options.backend === 'chromium' || !wgc ? 'chromium' : 'gfxcapture'
      let nativeSource
      if (backend === 'gfxcapture') {
        try { nativeSource = await resolveNativeCaptureSource(source) } catch (error) {
          if (request.options.backend === 'gfxcapture') throw error
          backend = 'chromium'
          logger.warn('显示器原生定位失败，使用兼容采集', { event: 'recording.capture.source.fallback', error })
        }
      }
      if (request.options.backend === 'gfxcapture' && !wgc) throw new Error('当前系统不支持无光标采集，请使用兼容录制')
      const manifest: CaptureManifest = { version: 2, minReaderVersion: 1, sessionId: request.sessionId, options: request.options, backend, cursorEmbedded: backend === 'chromium' || request.cursor === 'embed', status: 'prepared', spans: [] }
      let document: RecordingSessionDocument | undefined
      const storage = new CaptureStorage(sessionDirectory(request.sessionId), manifest, async value => { await document?.capture(value) })
      await storage.prepare()
      const originUs = now()
      const hostSystemAudio = Boolean(request.session?.tracks.systemAudio) && nativeSystemAudioSupported(process.platform)
      const prepared: CapturePrepared = { sessionId: request.sessionId, originUs, backend, cursorEmbedded: manifest.cursorEmbedded, options: request.options, ...(request.session ? { directory: storage.directory } : {}), ...(hostSystemAudio ? { hostTracks: ['systemAudio' as const] } : {}) }
      const session: Active = { owner, storage, originUs, rpc: new Map(), backend: null!, tracksAttached: true, failed: false, prepared, ...(request.session ? { session: request.session } : {}), ...(request.followUp ? { followUp: request.followUp } : {}), ...(hostSystemAudio ? { systemAudio: {} } : {}) }
      const geometry = request.session ? createCaptureGeometry(source, request.options) : undefined
      geometry?.()
      if (request.session) {
        const bounds = createCaptureBounds(source, request.options)()
        const scale = bounds ? screen.getDisplayMatching({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }).scaleFactor : 1
        const cursor = bounds && manifest.cursorEmbedded === false ? await systemCursorLook(bounds.height * scale, scale).catch(() => undefined) : undefined
        document = await RecordingSessionDocument.create(request.sessionId, session.originUs, request.session, source.name, manifest, storage.directory, cursor)
        session.document = document
      }
      session.backend = backend === 'gfxcapture' ? new GfxCaptureBackend(request.options, nativeSource!, storage, {
        nowUs: () => now() - session.originUs,
        failed: error => { void fail(session, error).catch(failure => logger.error('录制失败清理未完成', { event: 'recording.capture.cleanup.failed', error: failure })) },
        restarted: info => notifyRecordingProblem(session.owner, info.encoder === 'cpu' ? '画面编码中断过一次，已改用软件编码自动接着录。' : '画面编码中断过一次，已自动接着录。'),
      }, request.cursor === 'embed') : {
        prepare: async () => undefined,
        start: () => remote(session, 'start'), pause: () => remote(session, 'pause'), resume: () => remote(session, 'resume'), stop: () => remote(session, 'stop'),
        cancel: async () => { for (const pending of session.rpc.values()) pending.reject(new Error('录制已取消')); session.rpc.clear(); if (!owner.isDestroyed()) await remote(session, 'cancel') },
      }
      active = session
      try {
        await session.backend.prepare()
        mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
        const transition = async (operation: Exclude<CaptureOperation, 'cancel'>, status: CaptureManifest['status'], signal: AbortSignal): Promise<void> => {
          try {
            // 界面重载期间页面的授权随导航撤掉；同一会话已经由用户确认过来源，接着录不再重新核对。
            if ((operation === 'start' || operation === 'resume') && session.tracksAttached) mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
            // Both capture paths cross the renderer barrier: native screen capture must also control audio/camera.
            const results = await Promise.allSettled([session.backend[operation](signal), ...(request.session && backend !== 'chromium' ? [remote(session, operation)] : []), systemAudioStep(session, operation, signal)])
            const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
            if (failure) throw failure.reason
            if (manifest.status !== 'failed') { manifest.status = status; await storage.save() }
          } catch (error) { await fail(session, error instanceof Error ? error : new Error(String(error))); throw error }
        }
        // 停止、暂停、恢复时存不进文档也会让这次命令失败：按采集失败收尾（停下后端、记为中断），不当成用户取消。
        const failing = <T>(work: Promise<T>): Promise<T> => work.catch(async (error: unknown) => { await fail(session, error instanceof Error ? error : new Error(String(error))); throw error })
        if (request.session && source.id !== BrowserWindow.fromWebContents(owner)?.getMediaSourceId()) minimizeOwnerWhileRecording(BrowserWindow.fromWebContents(owner))
        openRecordingControl(owner, request.sessionId, {
          start: signal => transition('start', 'recording', signal), pause: signal => transition('pause', 'paused', signal), resume: signal => transition('resume', 'recording', signal), stop: signal => transition('stop', 'stopped', signal),
          mark: async () => undefined, // Event/marker ownership is task 1.4; no duplicate event log here.
          ...(document ? {
            began: () => document!.range('startUs', now() - session.originUs), ending: () => failing(document!.range('endUs', now() - session.originUs)),
            pausing: () => failing(document!.pause(now() - session.originUs)), resumed: () => failing(document!.resume(now() - session.originUs)),
          } : {}),
          cancel: async () => {
            try {
              const results = await Promise.allSettled([session.backend.cancel(), ...(request.session && backend !== 'chromium' && !owner.isDestroyed() ? [remote(session, 'cancel')] : []), ...(session.systemAudio?.recorder ? [session.systemAudio.recorder.stop()] : [])])
              const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
              if (failure) throw failure.reason
            } finally {
              await storage.release()
              // 用户取消只是不导入：已录内容完整保留并当作正常结束；只有采集出错才记为中断。
              if (manifest.status !== 'failed') manifest.status = 'stopped'
              await storage.save(); if (active === session) active = null
            }
          },
        }, document && geometry ? {
          ownerRef: { kind: 'screen_recording.session', id: request.sessionId }, sourceDigest: `sha256:${createHash('sha256').update(JSON.stringify(request.options)).digest('hex')}`,
          directory: storage.directory, originUs: session.originUs, nowUs: now, geometry,
          onPage: (page, file, writeMs) => document!.page(page, file, writeMs),
          onFailure: error => { session.failed = true; session.storage.manifest.status = 'failed'; logger.error('录制事件失败', { event: 'recording.session.events.failed', error }) },
        } : undefined, document ? () => (session.finishing ??= finishSession(session, document!)) : undefined, createCaptureBounds(source, request.options), () => ownerLost(session))
      } catch (error) {
        try { if (backend === 'gfxcapture') await session.backend.cancel() } finally { await storage.release(); active = null }
        throw error
      }
      logger.info('屏幕采集准备完成', { event: 'recording.capture.prepare.completed', context: { backend, sessionId: request.sessionId, monoUs: now() - session.originUs, capturesApplication: source.id === BrowserWindow.fromWebContents(owner)?.getMediaSourceId() } })
      return prepared
    } finally { preparing = null }
  }
  const session = active
  if (!session || session.owner !== owner || session.storage.manifest.sessionId !== request.sessionId) throw new Error('录制会话不存在或不属于当前窗口')
  const { storage } = session
  switch (request.operation) {
    case 'script-call': {
      if (!session.document || recordingControl.snapshot()?.phase !== 'recording') throw new Error('仅录制期间可保存操作输入')
      return session.document.scriptCall(request.call, request.baselines)
    }
    case 'track': {
      if (!session.document) throw new Error('录制会话未创建')
      return session.document.track(request.record)
    }
    case 'attach': {
      if (!session.document || !session.session) throw new Error('这次录制不能接回')
      // 页面导航时授权随之撤销；同一会话、同一宿主重新登记，系统声音与摄像头才能接着取。
      mediaPermissions.grant(owner, request.sessionId, grantKinds(session.session), { sourceId: storage.manifest.options.sourceId, excludedSourceIds: [] })
      session.tracksAttached = true
      logger.info('界面已重新接上进行中的录制', { event: 'recording.host.attached', context: { sessionId: request.sessionId, phase: recordingControl.snapshot()?.phase } })
      return { prepared: session.prepared, session: session.session, ...(session.followUp ? { followUp: session.followUp } : {}) } satisfies CaptureAttachment
    }
    case 'encoding': storage.manifest.encoding = request.encoding; await storage.save(); return
    case 'read': return structuredClone(storage.manifest)
    case 'clock': return now() - session.originUs
    case 'close': await closeRecordingControl(); return
    case 'ack': {
      const pending = session.rpc.get(request.requestId); session.rpc.delete(request.requestId)
      if (request.error) pending?.reject(new Error(request.error)); else pending?.resolve()
      return
    }
    case 'failed': await fail(session, new Error(request.error)); return
    default: {
      if (storage.manifest.backend !== 'chromium' || storage.manifest.status === 'failed' || storage.manifest.status === 'stopped') throw new Error('当前会话不接受采集帧')
      if (request.operation === 'open-span') return storage.openSpan(now() - session.originUs)
      if (request.operation === 'anchor') {
        const span = storage.manifest.spans[request.index]
        if (!span || span.finalized) throw new Error('录制片段已关闭')
        span.monoUs = request.monoUs; return storage.save()
      }
      if (request.operation === 'write') return storage.write(request.index, request.position, request.data)
      if (request.operation === 'seal-span') return storage.seal(request.index, request.durationUs)
    }
  }
}

export async function revokeCaptureSession(owner: WebContents, sessionId: string): Promise<void> {
  if (active?.owner === owner && active.storage.manifest.sessionId === sessionId) await recordingControl.command('stop')
}
