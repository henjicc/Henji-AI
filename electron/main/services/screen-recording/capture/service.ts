import { recordingEncoderChoices } from '../../video/hwaccel'
import { BrowserWindow, screen, shell, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { release } from 'node:os'
import path from 'node:path'
import type { CaptureAttachment, CaptureBackendKind, ScreenCaptureOptions, CaptureCommand, CaptureFollowUp, CaptureManifest, CaptureOperation, CapturePrepared, CaptureRequest, RecordingCaptureFacts, RecoveredRecording, ScreenCaptureBackend } from '../../../../../src/core/screenRecording/capture'
import type { RecordingSessionOptions } from '../../../../../src/core/screenRecording/sessionOptions'
import type { CaptureKind } from '../../../../../src/core/screenRecording/contracts'
import { getUserFolderDir } from '../../appPaths'
import { getDocumentService } from '../../documents/runtime'
import { mediaPermissions } from '../../media-permissions'
import { createMainLogger } from '../../logging'
import { openRecordingControl, closeRecordingControl, minimizeOwnerWhileRecording, notifyRecordingProblem, recordingControl, recordingEventBacklog } from '../runtime'
import { CaptureStorage, recoverCapture } from './storage'
import { GfxCaptureBackend, type GfxCaptureStats } from './gfxcapture'
import { NativeCaptureBackend } from './native'
import { screenCaptureProcess } from './native-client'
import { systemCursorLook } from './cursor-look'
import { resolveNativeCaptureSource } from './source'
import { CAPTURE_PRESENCE_INTERVAL_MS, captureSourceGone, createCaptureBounds, createCaptureGeometry, createCaptureSourcePresence } from './geometry'
import { RecordingSessionDocument, readRecordingEvents, recoverRecordingSession } from '../session-document'
import { exportQuickRecording, quickExportPath } from '../quick-export'
import { combineRecording } from '../combine'
import { systemAudioCapture } from '../../audio-capture/system-audio'
import { microphoneCapture } from '../../audio-capture/service'
import type { NativeTrack, NativeTrackRecording } from '../../audio-capture/native-track'
import { nativeSystemAudioSupported } from '../../../../../src/platform/contracts/audioCapture'

const logger = createMainLogger('main.screen_recording.capture')
interface Active {
  owner: WebContents; storage: CaptureStorage; backend: ScreenCaptureBackend; originUs: number
  rpc: Map<string, { resolve(): void; reject(error: Error): void }>
  document?: RecordingSessionDocument
  /** 摄像头（与 macOS 的系统声）由界面写；界面进程重载或崩溃期间为 false，画面、事件与主进程录的声音照常录。 */
  tracksAttached: boolean
  /** 采集本身出错（区别于用户取消）。 */
  failed: boolean
  /** 出错的原因，读回长录事实时给出。 */
  failure?: string
  session?: RecordingSessionOptions
  followUp?: CaptureFollowUp
  prepared: CapturePrepared
  /** 停止与取消都会走到收尾（失败后关控制条还会再取消一次），只收一次。 */
  finishing?: Promise<void>
  /** 主进程让原生录音服务录的声音轨（麦克风；Windows 上还有系统声）：与画面、事件一样不依赖界面。开始后才有录制器。 */
  hosted: Partial<Record<HostTrackKind, { recorder?: NativeTrack }>>
  /** 被录的来源没了（窗口关闭、显示器断开）：录制按停止收尾，这是说明。 */
  ended?: { source: 'window' | 'display'; message: string }
  /** 定时检查来源还在不在；暂停中也查，收尾时停。 */
  presence?: ReturnType<typeof setInterval>
  /** 释放只做一次：采集失败时已经释放过，之后关控制条再释放就直接用那次的结果，不再对着已结束的会话等回执。 */
  released?: Promise<void>
  /** 画面实际由谁录：原生采集进程、FFmpeg 的 gfxcapture，或界面里的兼容采集；进日志，便于复盘每次录制走的哪条路。 */
  capturer: Capturer
}
type Capturer = 'native' | 'ffmpeg' | 'chromium'
const videoStats = (backend: ScreenCaptureBackend): GfxCaptureStats | undefined => backend instanceof GfxCaptureBackend || backend instanceof NativeCaptureBackend ? backend.stats() : undefined

/** 整屏录制默认先试原生画面采集进程，不支持就回到 FFmpeg 录法；排查时设 HENJI_NATIVE_SCREEN_CAPTURE=0 强制走 FFmpeg。 */
const nativeCaptureRequested = (): boolean => process.env.HENJI_NATIVE_SCREEN_CAPTURE !== '0'
/**
 * 原生采集第一版只录整块显示器、按显示器原尺寸、不录光标、只用 NVIDIA 编码：其余情况直接走现有录法。
 * 返回显示器中心的物理像素坐标（原生按物理像素找显示器，副屏起点是物理坐标，不是 DIP），或不走原生的原因。
 */
export function nativeCaptureTarget(source: { kind: string; displayId?: string }, options: ScreenCaptureOptions, cursor: 'redraw' | 'embed' | undefined, platform = process.platform): { point: [number, number] } | { skipped: string } {
  if (platform !== 'win32') return { skipped: '只支持 Windows' }
  if (source.kind !== 'screen') return { skipped: '只支持整块显示器' }
  if (options.region) return { skipped: '不支持区域录制' }
  if (cursor === 'embed') return { skipped: '不录光标' }
  if (options.encoder && !['auto', 'nvidia'].includes(options.encoder)) return { skipped: `指定了编码器 ${options.encoder}` }
  const display = screen.getAllDisplays().find(item => String(item.id) === source.displayId)
  if (!display) return { skipped: '找不到所选显示器' }
  if (Math.round(display.bounds.width * display.scaleFactor) !== options.width || Math.round(display.bounds.height * display.scaleFactor) !== options.height) return { skipped: '录制尺寸与显示器原尺寸不同' }
  const center = screen.dipToScreenPoint({ x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 })
  return { point: [center.x, center.y] }
}
type HostTrackKind = NonNullable<CapturePrepared['hostTracks']>[number]
let active: Active | null = null
/** 停止后的长录事实留到应用退出：停止后再读也能看到丢帧、续录与补静音；只留最近这些次。 */
const finishedFacts = new Map<string, RecordingCaptureFacts>()
const FINISHED_FACTS_LIMIT = 32
function captureFacts(session: Active, live: boolean): RecordingCaptureFacts {
  const video = videoStats(session.backend)
  const system = session.hosted.systemAudio?.recorder?.stats().health, systemReconnects = session.hosted.systemAudio?.recorder?.stats().reconnects ?? 0
  const microphone = session.hosted.microphone?.recorder?.stats()
  return {
    live, failure: session.failure ?? null, detaches: session.document?.ledger.detaches ?? 0,
    video: video ? { droppedFrames: video.droppedFrames, duplicatedFrames: video.duplicatedFrames, encoderRestarts: video.restarts, encoder: video.encoder } : null,
    systemAudio: system ? { silenceSeconds: system.silenceSeconds ?? 0, unavailableSeconds: system.unavailableSeconds ?? 0, droppedFrames: system.droppedFrames ?? 0, discontinuities: system.discontinuities ?? 0, deviceSwitches: system.deviceSwitches ?? 0, reconnects: systemReconnects } : null,
    microphone: microphone ? { device: microphone.device, inputOverflows: microphone.health.inputOverflows ?? 0, inputUnderflows: microphone.health.inputUnderflows ?? 0, droppedFrames: microphone.health.droppedFrames ?? 0, droppedPreviewBlocks: microphone.health.droppedPreviewBlocks ?? 0, reconnects: microphone.reconnects } : null,
    recovered: false,
    // 来源关闭后的停止本身失败了：按失败如实呈现，不再说是来源关闭。
    ...(session.ended && !session.failed ? { sourceEnded: session.ended.message } : {}),
    ...(live && session.document ? { tracks: session.document.ledger.state.tracks(session.prepared.sessionId, session.originUs) } : {}),
  }
}
function keepFacts(sessionId: string, facts: RecordingCaptureFacts): void {
  finishedFacts.delete(sessionId); finishedFacts.set(sessionId, facts)
  while (finishedFacts.size > FINISHED_FACTS_LIMIT) finishedFacts.delete(finishedFacts.keys().next().value!)
}
/** 正在准备的会话：文档已建、还没成为 active，启动恢复不能把它当成上次崩溃留下的。 */
let preparing: string | null = null
const now = (): number => Number(process.hrtime.bigint() / 1000n)
const sessionDirectory = (sessionId: string): string => path.join(getUserFolderDir('uploads'), 'screen-recordings', sessionId)

async function remote(session: Active, operation: CaptureOperation): Promise<void> {
  // 界面不在时它录的轨道已经断开，没有可以等的回执；重新接上的界面按当时的阶段自己开始。
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
  session.storage.manifest.status = 'failed'; session.failed = true; session.failure = error.message
  logger.error('屏幕录制失败', { event: 'recording.capture.failed', error })
  await recordingControl.captureFailed(session.storage.manifest.sessionId, error)
}
/**
 * 被录的窗口关闭、显示器断开：录制到此为止，按停止收尾（已录的画面、声音、事件照常封存，能导入剪辑、合并），
 * 不当成采集出错，也不对着已经不在的来源续录。
 */
function sourceEnded(session: Active, source: 'window' | 'display'): void {
  if (active !== session || session.ended || session.failed) return
  clearInterval(session.presence)
  // 用户已经按了停止（或已失败）：这次结束不是来源关闭造成的，不记原因、不提示。
  if (!recordingControl.sourceEnded(session.prepared.sessionId, source)) return
  session.ended = { source, message: source === 'window' ? '被录制的窗口已关闭' : '被录制的显示器已断开' }
  logger.info('录制来源已关闭，按停止收尾', { event: 'recording.capture.source.ended', context: { sessionId: session.prepared.sessionId, source } })
}

/**
 * 界面进程重载或崩溃：画面（原生采集）、事件和主进程录的声音轨照常录，只记下界面录的轨道（摄像头、macOS 的系统声）从这里断开，等界面回来重新接上。
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
  logger.warn('界面进程断开，画面与声音继续录制，摄像头等待界面重新接上', { event: 'recording.host.detached', context: { sessionId: session.prepared.sessionId } })
}

/**
 * 主进程录的声音轨（麦克风、Windows 的系统声）跟着画面开始、暂停、恢复、停止；轨道记录直接进录制文档的轨道记录，
 * 与界面写的摄像头同一份。两路同一个原点、同一个时钟，结束时一起拼接。
 */
async function hostTrackStep(session: Active, kind: HostTrackKind, operation: Exclude<CaptureOperation, 'cancel'>, signal: AbortSignal): Promise<void> {
  const host = session.hosted[kind], document = session.document
  if (!host || !document) return
  const sessionId = session.prepared.sessionId
  if (operation === 'start') {
    const options: NativeTrackRecording = {
      directory: session.storage.directory, originUs: session.originUs,
      record: record => { void document.track(record) },
      failed: error => { void fail(session, error).catch(failure => logger.error('声音轨失败后收尾失败', { event: 'recording.host_track.cleanup.failed', error: failure, context: { kind } })) },
      available: available => recordingControl.setHostTrackWarning(sessionId, kind, 'device-disconnected', !available),
      ...(kind === 'microphone' ? { level: (peak: number) => recordingControl.setMicrophoneLevel(sessionId, peak) } : {}),
    }
    let recorder: NativeTrack
    if (kind === 'microphone') {
      await mediaPermissions.requestAccess(['microphone'])
      recorder = await microphoneCapture().startTrack(options)
    } else recorder = await systemAudioCapture().start(options)
    // 开始途中录制已被取消：这一路随即收尾，不留在后台录。
    if (active !== session || signal.aborted) { await recorder.stop(); signal.throwIfAborted(); return }
    host.recorder = recorder
  } else if (operation === 'pause') await host.recorder?.pause()
  else if (operation === 'resume') await host.recorder?.resume()
  else await host.recorder?.stop(now() - session.originUs)
}
const hostTrackSteps = (session: Active, operation: Exclude<CaptureOperation, 'cancel'>, signal: AbortSignal): Promise<void>[] =>
  (Object.keys(session.hosted) as HostTrackKind[]).map(kind => hostTrackStep(session, kind, operation, signal))

function grantKinds(options: RecordingSessionOptions | undefined): CaptureKind[] {
  return ['screen', ...(options?.tracks.microphone ? ['microphone' as const] : []), ...(options?.tracks.systemAudio ? ['systemAudio' as const] : []), ...(options?.tracks.camera ? ['camera' as const] : [])]
}

/** 停止、取消、失败都走这里：一次写全文档，留一条汇总日志；意外停止时提醒用户。 */
async function finishSession(session: Active, document: RecordingSessionDocument): Promise<void> {
  const sessionId = session.prepared.sessionId
  clearInterval(session.presence)
  try {
    const summary = await document.finish(session.storage.manifest)
    const capture = videoStats(session.backend)
    keepFacts(sessionId, captureFacts(session, false))
    logger.info('录制结束汇总', { event: 'recording.capture.summary', context: { sessionId, backend: session.storage.manifest.backend, capturer: session.capturer, failed: session.failed, ...session.ended ? { sourceEnded: session.ended.source } : {}, ...summary, eventPageBacklog: recordingEventBacklog(), ...capture ? { droppedFrames: capture.droppedFrames, duplicatedFrames: capture.duplicatedFrames, encoderRestarts: capture.restarts, encoder: capture.encoder } : {} } })
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
      if (result.status === 'interrupted') {
        recovered.push({ documentId: document.id, name: result.name, durationUs: result.durationUs })
        keepFacts(document.id, { live: false, failure: '应用意外退出，录制没有正常停止', detaches: 0, video: null, systemAudio: null, microphone: null, recovered: true })
      }
    } catch (error) { logger.warn('上次中断的录制未能自动恢复', { event: 'recording.session.recover.failed', error, context: { sessionId: document.id } }) }
  }
  return recovered
}

export async function handleCaptureRequest(owner: WebContents, request: CaptureRequest): Promise<unknown> {
  if (request.operation === 'encoders') return recordingEncoderChoices(request.codec)
  if (request.operation === 'application-source') return BrowserWindow.fromWebContents(owner)?.getMediaSourceId() ?? null
  if (request.operation === 'events') return readRecordingEvents(request.sessionId, request.offset, request.limit, request.markersOnly, active?.prepared.sessionId === request.sessionId ? active.document?.pageReferences() : undefined)
  if (request.operation === 'unfinished') return recoverUnfinished()
  if (request.operation === 'facts') return active?.prepared.sessionId === request.sessionId ? captureFacts(active, true) : finishedFacts.get(request.sessionId) ?? null
  if (request.operation === 'quick-export') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先结束当前录制，再保存视频')
    return exportQuickRecording(request.sessionId, request.directory)
  }
  if (request.operation === 'combine') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先结束当前录制，再导入剪辑')
    return combineRecording(request.sessionId)
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
      // 麦克风在所有平台都由原生录音服务录（PortAudio）；系统声只在 Windows 上由它录（WASAPI 回环），macOS 仍由界面采集。
      const hostTracks: HostTrackKind[] = [...(request.session?.tracks.microphone ? ['microphone' as const] : []), ...(request.session?.tracks.systemAudio && nativeSystemAudioSupported(process.platform) ? ['systemAudio' as const] : [])]
      const prepared: CapturePrepared = { sessionId: request.sessionId, originUs, backend, cursorEmbedded: manifest.cursorEmbedded, options: request.options, ...(request.session ? { directory: storage.directory } : {}), ...(hostTracks.length ? { hostTracks } : {}) }
      const session: Active = { owner, storage, originUs, rpc: new Map(), backend: null!, capturer: backend === 'chromium' ? 'chromium' : 'ffmpeg', tracksAttached: true, failed: false, prepared, ...(request.session ? { session: request.session } : {}), ...(request.followUp ? { followUp: request.followUp } : {}), hosted: Object.fromEntries(hostTracks.map(kind => [kind, {}])) }
      const presence = createCaptureSourcePresence(source), endedSource = source.kind === 'window' ? 'window' as const : 'display' as const
      const geometry = request.session ? createCaptureGeometry(source, request.options) : undefined
      geometry?.()
      if (request.session) {
        const bounds = createCaptureBounds(source, request.options)()
        const scale = bounds ? screen.getDisplayMatching({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }).scaleFactor : 1
        const cursor = bounds && manifest.cursorEmbedded === false ? await systemCursorLook(bounds.height * scale, scale).catch(() => undefined) : undefined
        document = await RecordingSessionDocument.create(request.sessionId, session.originUs, request.session, source.name, manifest, storage.directory, cursor)
        session.document = document
      }
      const gfxCapture = (): GfxCaptureBackend => new GfxCaptureBackend(request.options, nativeSource!, storage, {
        nowUs: () => now() - session.originUs,
        failed: error => { void fail(session, error).catch(failure => logger.error('录制失败清理未完成', { event: 'recording.capture.cleanup.failed', error: failure })) },
        restarted: info => notifyRecordingProblem(session.owner, info.encoder === 'cpu' ? '画面编码中断过一次，已改用软件编码自动接着录。' : '画面编码中断过一次，已自动接着录。'),
        sourceGone: () => captureSourceGone(presence), sourceEnded: () => sourceEnded(session, endedSource),
      }, request.cursor === 'embed')
      const native = backend === 'gfxcapture' && nativeCaptureRequested() ? nativeCaptureTarget(source, request.options, request.cursor) : undefined
      if (native && 'skipped' in native) logger.info('这次录制不走原生画面采集', { event: 'recording.capture.native.skipped', context: { sessionId: request.sessionId, reason: native.skipped } })
      session.backend = native && 'point' in native ? new NativeCaptureBackend(request.options, native.point, storage, {
        client: screenCaptureProcess(), originUs: session.originUs, nowUs: now,
        failed: error => { void fail(session, error).catch(failure => logger.error('录制失败清理未完成', { event: 'recording.capture.cleanup.failed', error: failure })) },
        sourceEnded: () => sourceEnded(session, endedSource),
      }) : backend === 'gfxcapture' ? gfxCapture() : {
        prepare: async () => undefined,
        start: () => remote(session, 'start'), pause: () => remote(session, 'pause'), resume: () => remote(session, 'resume'), stop: () => remote(session, 'stop'),
        cancel: async () => { for (const pending of session.rpc.values()) pending.reject(new Error('录制已取消')); session.rpc.clear(); if (!owner.isDestroyed()) await remote(session, 'cancel') },
      }
      active = session
      try {
        if (session.backend instanceof NativeCaptureBackend) {
          try { await session.backend.prepare(); session.capturer = 'native' } catch (error) {
            // 本机不支持（不是 NVIDIA、系统太旧）、程序起不来或版本不配套：这次照现有录法录，不向用户报错。
            logger.warn('原生画面采集不可用，改用现有录法', { event: 'recording.capture.native.fallback', error, context: { sessionId: request.sessionId, code: (error as { code?: unknown }).code ?? null } })
            session.backend = gfxCapture()
            await session.backend.prepare()
          }
        } else await session.backend.prepare()
        mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
        const transition = async (operation: Exclude<CaptureOperation, 'cancel'>, status: CaptureManifest['status'], signal: AbortSignal): Promise<void> => {
          try {
            // 界面重载期间页面的授权随导航撤掉；同一会话已经由用户确认过来源，接着录不再重新核对。
            if ((operation === 'start' || operation === 'resume') && session.tracksAttached) mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
            // Both capture paths cross the renderer barrier: native screen capture must also control audio/camera.
            const results = await Promise.allSettled([session.backend[operation](signal), ...(request.session && backend !== 'chromium' ? [remote(session, operation)] : []), ...hostTrackSteps(session, operation, signal)])
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
          capturingSinceUs: () => {
            if (session.backend instanceof NativeCaptureBackend) return session.backend.capturingSinceUs()
            const span = manifest.spans.at(-1)
            return backend === 'gfxcapture' && span && !span.finalized ? session.originUs + span.monoUs : undefined
          },
          mark: async () => undefined, // Event/marker ownership is task 1.4; no duplicate event log here.
          ...(document ? {
            began: () => document!.range('startUs', now() - session.originUs), ending: () => failing(document!.range('endUs', now() - session.originUs)),
            pausing: () => {
              if (session.backend instanceof NativeCaptureBackend) session.backend.pressed(now())
              return failing(document!.pause(now() - session.originUs))
            }, resumed: () => failing(document!.resume(now() - session.originUs)),
          } : {}),
          cancel: () => {
            // 第二次（采集失败释放过后再关控制条）这时会话已不是 active，界面的回执路由不到这里，再发命令只会白等超时；
            // 那次的失败已经报过，这里只等它结束。
            if (session.released) return session.released.catch(() => undefined)
            clearInterval(session.presence)
            session.released = (async () => {
              try {
                const results = await Promise.allSettled([session.backend.cancel(), ...(request.session && backend !== 'chromium' && !owner.isDestroyed() ? [remote(session, 'cancel')] : []), ...Object.values(session.hosted).flatMap(host => host.recorder ? [host.recorder.stop()] : [])])
                const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
                if (failure) throw failure.reason
              } finally {
                await storage.release()
                // 用户取消只是不导入：已录内容完整保留并当作正常结束；只有采集出错才记为中断。
                if (manifest.status !== 'failed') manifest.status = 'stopped'
                await storage.save(); if (active === session) active = null
              }
            })()
            return session.released
          },
        }, document && geometry ? {
          ownerRef: { kind: 'screen_recording.session', id: request.sessionId }, sourceDigest: `sha256:${createHash('sha256').update(JSON.stringify(request.options)).digest('hex')}`,
          directory: storage.directory, originUs: session.originUs, nowUs: now, geometry,
          onPage: (page, file, writeMs) => document!.page(page, file, writeMs),
          onFailure: error => { session.failed = true; session.failure ??= `录制事件采集失败：${error instanceof Error ? error.message : String(error)}`; session.storage.manifest.status = 'failed'; logger.error('录制事件失败', { event: 'recording.session.events.failed', error }) },
        } : undefined, document ? () => (session.finishing ??= finishSession(session, document!)) : undefined, createCaptureBounds(source, request.options), () => ownerLost(session))
        let misses = 0
        session.presence = setInterval(() => {
          misses = presence.present() ? 0 : misses + 1
          if (misses >= presence.misses) sourceEnded(session, endedSource)
        }, CAPTURE_PRESENCE_INTERVAL_MS)
        session.presence.unref?.()
      } catch (error) {
        try { if (backend === 'gfxcapture') await session.backend.cancel() } finally { await storage.release(); active = null }
        throw error
      }
      logger.info('屏幕采集准备完成', { event: 'recording.capture.prepare.completed', context: { backend, capturer: session.capturer, sessionId: request.sessionId, monoUs: now() - session.originUs, capturesApplication: source.id === BrowserWindow.fromWebContents(owner)?.getMediaSourceId() } })
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
      // 页面导航时授权随之撤销；同一会话、同一宿主重新登记，界面录的轨道（摄像头、macOS 的系统声）才能接着取。
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
