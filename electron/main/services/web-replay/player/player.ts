import crypto from 'node:crypto'
import { BrowserWindow, ipcMain, session as electronSession, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { WebRecordingMatcher } from '../../../../../src/core/webReplay/matcher'
import type { WebRecordingBehaviorEvent, WebRecordingData, WebRecordingManifest, WireBodyValue } from '../../../../../src/core/webReplay/schema'
import type { ReplayBoot, ReplayHostResult, ReplayHttpRequest, ReplayHttpResult, ReplayReport } from '../../../../../packages/web-replay-probe/src/replay/types'
import { REPLAY_CONTROL } from '../../../../../packages/web-replay-probe/src/replay/types'
import { DEFAULT_LOCATOR_OPTIONS } from '../../../../../packages/web-replay-probe/src/shared/locatorOptions'
import { createMainLogger } from '../../logging'
import { digestBase64, WebRecordingStore } from '../store'
import { FrameEncoder } from './encoder'
import { InputDispatcher } from './input'
import { BOOTSTRAP_PATH, installReplaySite } from './site'
import { TEXT_SAMPLE_INTERVAL_US, TEXT_SAMPLE_SCRIPT, TextTrackWriter, type TextSample } from '../textTrack'
import { BOX_TRACK_FILE, boxSampleEveryFrames, boxSampleScript, BoxTrackWriter, type BoxSample } from '../boxTrack'

const logger = createMainLogger('main.web_replay.player')
const TAIL_MS = 1500
/** Device pixels per second the offscreen capture sustains in realtime (the recorded 2240×1437 at 30 fps fits); above it the page runs slower. */
const REALTIME_PIXEL_RATE = 100_000_000

export interface ReplayIssue { t: number; kind: 'conflict' | 'warning'; message: string }
export interface ReplayResult {
  output: string
  frames: number
  width: number
  height: number
  durationMs: number
  issues: ReplayIssue[]
  looseMatches: number
  unusedCalls: number
  locatorMisses: number
}
export interface ReplayOptions {
  output: string; fps?: number; show?: boolean; signal?: AbortSignal
  /** false renders a clean picture without the pointer (for the editor, which redraws it). Default true. */
  pointer?: boolean
  /** Output long edge in pixels (e.g. 3840); the page renders at that scale instead of the recorded device pixel ratio. */
  longEdge?: number
  /** Page time runs this many times slower than the wall clock; the video keeps the recorded timing. Default 1. */
  timeScale?: number
  /** Live preview: progress 0..1 and a small JPEG data URL, about five times a second. */
  onFrame?: (progress: number, frame: string) => void
  /** 同时写文字轨（画面上看得见的文字与位置）到这个文件。 */
  textTrack?: string
  /** 除 data-replay-id / data-act 外额外采样的 CSS 选择器。 */
  boxSelectors?: string[]
  /** false 只跑页面、不编码视频（只要文字轨时用）。默认 true。 */
  video?: boolean
}

type BootReply = { phase: 'bootstrap'; storage: unknown } | { phase: 'app'; boot: ReplayBoot } | { phase: 'none' }

const players = new Map<number, WebRecordingPlayer>()
let ipcInstalled = false
function installIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  const route = (event: IpcMainEvent | IpcMainInvokeEvent): WebRecordingPlayer | undefined => players.get(event.sender.id)
  ipcMain.on('web-replay:boot', (event, url: unknown) => { event.returnValue = route(event)?.boot(String(url)) ?? { phase: 'none' } })
  ipcMain.on('web-replay:bootstrapped', event => route(event)?.bootstrapped())
  ipcMain.on('web-replay:report', (event, report: ReplayReport) => route(event)?.report(report))
  ipcMain.handle('web-replay:http', (event, request: ReplayHttpRequest) => { const p = route(event); if (!p) throw new Error('不是重演窗口'); return p.http(request) })
  ipcMain.handle('web-replay:invoke', (event, command: string, args: unknown) => { const p = route(event); if (!p) throw new Error('不是重演窗口'); return p.invoke(command, args) })
}

/**
 * Realtime replay of one recording in an offscreen window (tier 1). The page runs the recorded
 * front-end; boundary calls are answered from the data track; behavior is dispatched as input
 * on the recorded schedule; frames are encoded as they paint.
 */
export class WebRecordingPlayer {
  private manifest!: WebRecordingManifest
  private data!: WebRecordingData
  private behavior: WebRecordingBehaviorEvent[] = []
  private matcher!: WebRecordingMatcher
  private window: BrowserWindow | null = null
  private issues: ReplayIssue[] = []
  private loose = 0
  private ready: ((now: number) => void) | null = null
  private bootstrappedResolve: (() => void) | null = null
  private startedAtMs = 0

  constructor(private readonly store: WebRecordingStore) {}

  static open(directory: string): WebRecordingPlayer { return new WebRecordingPlayer(new WebRecordingStore(directory)) }

  private pageNowUs(): number { return Math.round((Date.now() - this.startedAtMs) * 1000 / this.scale) }
  private issue(kind: ReplayIssue['kind'], message: string, t = this.pageNowUs()): void {
    if (this.issues.length < 500) this.issues.push({ t, kind, message })
    logger.debug('网页重演发现问题', { event: 'web_replay.replay.issue', context: { kind, message: message.slice(0, 300) } })
  }

  // ---- IPC from the replay page

  boot(url: string): BootReply {
    logger.info('网页重演页面请求启动数据', { event: 'web_replay.replay.boot', context: { url } })
    if (new URL(url).pathname === BOOTSTRAP_PATH) return { phase: 'bootstrap', storage: this.storage }
    return {
      phase: 'app',
      boot: {
        host: this.manifest.host, env: this.manifest.env, wallAtZeroMs: this.manifest.wallAtZeroMs, random: this.data.random,
        clipboard: this.data.clipboard.map(c => c.text), callbacks: this.data.callbacks, locator: DEFAULT_LOCATOR_OPTIONS,
        ...(this.pointer ? {} : { pointer: false }),
        ...(this.scale === 1 ? {} : { timeScale: this.scale }),
      },
    }
  }
  bootstrapped(): void { this.bootstrappedResolve?.() }
  report(report: ReplayReport): void {
    if (report.kind === 'ready') this.ready?.(report.now)
    else if (report.kind === 'conflict' || report.kind === 'warning') this.issue(report.kind, report.message, report.t)
  }

  async http(request: ReplayHttpRequest): Promise<ReplayHttpResult> {
    const match = this.matcher.http(request)
    if (!match) return { ok: false, conflict: `这一步会发出录制里没有的请求：${request.method} ${request.url}` }
    if (match.quality === 'loose') { this.loose += 1; this.issue('warning', `请求内容与录制不同，已按顺序对应：${request.method} ${request.url}`) }
    const call = match.call
    const chunks = await Promise.all(call.chunks.map(async c => ({ at: c.at, body: await this.store.readBody(c.body) as WireBodyValue })))
    if (!call.response) return { ok: true, status: 200, statusText: '', url: call.url, headers: [], responseAt: call.error?.at ?? 0, chunks: [], error: call.error ?? { at: 0, phase: 'request', name: 'TypeError', message: 'Failed to fetch' } }
    return { ok: true, status: call.response.status, statusText: call.response.statusText, url: call.response.url, headers: call.response.headers, responseAt: call.response.at, chunks, endAt: call.endAt, error: call.error }
  }

  async invoke(command: string, args: unknown): Promise<ReplayHostResult> {
    const match = this.matcher.host(command, args)
    if (!match) return { ok: false, conflict: `这一步会调用录制里没有的宿主命令：${command}` }
    if (match.quality === 'loose') { this.loose += 1; this.issue('warning', `宿主命令参数与录制不同，已按顺序对应：${command}`) }
    const result = match.call.result
    if (!result) return { ok: true, call: match.call.id, resolved: true, value: null, at: 0 }
    return result.ok ? { ok: true, call: match.call.id, resolved: true, value: result.value, at: result.at } : { ok: true, call: match.call.id, resolved: false, error: result.error, at: result.at }
  }

  private storage: unknown
  private pointer = true
  private scale = 1

  async render(options: ReplayOptions): Promise<ReplayResult> {
    const boxesScript = boxSampleScript(options.boxSelectors)
    installIpc()
    this.pointer = options.pointer !== false
    this.manifest = await this.store.readManifest()
    if (this.manifest.status === 'recording') throw new Error('这段网页录制尚未结束')
    ;[this.data, this.behavior, this.storage] = await Promise.all([this.store.readData(), this.store.readBehavior(), this.store.readStorage().catch(() => ({ local: [], session: [], indexedDB: [] }))])
    const resources = await this.store.readResources()
    this.matcher = new WebRecordingMatcher(this.data.calls, digestBase64)
    const env = this.manifest.env
    const origin = new URL(env.url).origin
    const partition = `web-replay-${crypto.randomUUID()}`
    const ses = electronSession.fromPartition(partition)
    installReplaySite(ses, { store: this.store, origin, resources, external: this.data.external, onMissing: (url, reason) => this.issue('conflict', `${reason}：${url}`) })
    const dpr = options.longEdge ? options.longEdge / Math.max(env.viewport.width, env.viewport.height) : env.viewport.dpr
    const fps = options.fps ?? 30
    // Large or fast outputs slow the page down rather than drop frames; the video keeps the recorded timing.
    this.scale = options.timeScale ?? Math.max(1, Math.ceil((env.viewport.width * dpr) * (env.viewport.height * dpr) * fps / REALTIME_PIXEL_RATE))
    const scale = this.scale
    const win = new BrowserWindow({
      show: options.show ?? false, width: Math.round(env.viewport.width), height: Math.round(env.viewport.height), useContentSize: true, frame: false, resizable: true,
      webPreferences: {
        partition, preload: path.join(__dirname, '../preload/web-replay.cjs'), contextIsolation: false, sandbox: true, nodeIntegration: false,
        offscreen: { deviceScaleFactor: dpr }, backgroundThrottling: false, spellcheck: false,
      },
    })
    this.window = win
    const contents = win.webContents
    players.set(contents.id, this)
    // Commands sent before the page has a renderer never answer, so every call is time-limited.
    const cdp = (method: string, params?: Record<string, unknown>): Promise<unknown> => withTimeout(contents.debugger.sendCommand(method, params), 10_000, `重演窗口没有响应 ${method}`)
    const input = new InputDispatcher(contents, cdp, this.store, REPLAY_CONTROL)
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let encoder: FrameEncoder | null = null
    let lateFrames = 0
    const video = options.video !== false
    const text = options.textTrack ? new TextTrackWriter(options.textTrack) : null
    const boxes = new BoxTrackWriter(path.join(this.store.directory, BOX_TRACK_FILE))
    let boxSamples = 0, boxSampleMs = 0, boxSampleMaxMs = 0
    let textFailures = 0
    try {
      const stage = (name: string): void => logger.info('网页重演进度', { event: 'web_replay.replay.stage', context: { recordingId: this.manifest.id, stage: name } })
      stage('window')
      await withTimeout(contents.loadURL('about:blank'), 30_000, '重演窗口启动超时')
      contents.debugger.attach('1.3')
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: env.colorScheme }, { name: 'prefers-reduced-motion', value: env.reducedMotion ? 'reduce' : 'no-preference' }] })
      await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
      await cdp('Emulation.setTimezoneOverride', { timezoneId: env.timeZone }).catch(() => undefined)
      await cdp('Emulation.setLocaleOverride', { locale: env.locale }).catch(() => undefined)
      await cdp('Emulation.setUserAgentOverride', { userAgent: env.userAgent, acceptLanguage: env.locale }).catch(() => undefined)
      contents.setFrameRate(Math.max(1, Math.round(fps / scale)))
      const slowAnimations = async (): Promise<void> => {
        if (scale === 1) return
        await cdp('Animation.enable')
        await cdp('Animation.setPlaybackRate', { playbackRate: 1 / scale })
      }
      await slowAnimations()

      // 1) restore storage on the recorded origin, 2) load the recorded entry URL
      const bootstrapped = new Promise<void>(resolve => { this.bootstrappedResolve = resolve })
      stage('bootstrap')
      await withTimeout(contents.loadURL(`${origin}${BOOTSTRAP_PATH}`), 30_000, '重演引导页加载超时')
      stage('bootstrap-loaded')
      await withTimeout(bootstrapped, 30_000, '页面存储恢复超时')

      const painted: { latest: Electron.NativeImage | null } = { latest: null }
      let lastGood: Buffer | null = null
      let fresh = false
      contents.on('paint', (_event, _dirty, image) => { painted.latest = image; fresh = true })
      const readyAt = new Promise<number>(resolve => { this.ready = resolve })
      this.startedAtMs = Date.now()
      const loading = contents.loadURL(env.url)
      stage('app')
      const pageNow = await withTimeout(readyAt, 30_000, '重演页面没有加载探针运行时')
      stage('ready')
      // Page zero in Henji's wall clock; behavior times are relative to it.
      await slowAnimations()
      const zeroMs = Date.now() - pageNow * scale
      this.startedAtMs = zeroMs
      await loading.catch(error => this.issue('warning', `入口页面加载报告：${String(error)}`))

      for (const event of this.behavior) {
        if (event.kind === 'resize') { timers.push(setTimeout(() => win.setContentSize(Math.round(event.width), Math.round(event.height)), Math.max(0, zeroMs + event.t / 1000 * scale - Date.now()))); continue }
        timers.push(setTimeout(() => { void input.dispatch(event).catch(error => this.issue('warning', `输入派发失败：${String(error)}`, event.t)) }, Math.max(0, zeroMs + event.t / 1000 * scale - Date.now())))
      }

      // Frame clock: one frame per tick from the most recent paint.
      const totalMs = this.manifest.durationUs / 1000 + TAIL_MS
      const frameCount = Math.ceil(totalMs / 1000 * fps)
      const sampleEvery = Math.max(1, Math.round(TEXT_SAMPLE_INTERVAL_US / 1e6 * fps))
      const boxEvery = boxSampleEveryFrames(scale)
      logger.info('开始采样界面元素位置轨', { event: 'web_replay.boxes.start', context: { recordingId: this.manifest.id, fps, scale, everyFrames: boxEvery, selectors: options.boxSelectors?.length ?? 0 } })
      for (let i = 0; i < frameCount; i += 1) {
        if (options.signal?.aborted) throw new Error('已取消重演')
        const due = zeroMs + (i * 1000 * scale) / fps
        const wait = due - Date.now()
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
        else if (wait < -500 * scale / fps) lateFrames += 1
        if (i % boxEvery === 0) {
          const started = performance.now()
          const sample = await withTimeout(contents.executeJavaScript(boxesScript, true) as Promise<BoxSample>, 2_000, '读取界面元素位置超时')
          await boxes.write(Math.round(i * 1e6 / fps), sample)
          const elapsed = performance.now() - started
          boxSamples += 1; boxSampleMs += elapsed; boxSampleMaxMs = Math.max(boxSampleMaxMs, elapsed)
        }
        if (text && i % sampleEvery === 0) {
          try { text.write(Math.round(i * 1e6 / fps), await withTimeout(contents.executeJavaScript(TEXT_SAMPLE_SCRIPT, true) as Promise<TextSample>, 2_000, '读取画面文字超时')) } catch (error) {
            if (textFailures++ === 0) this.issue('warning', `文字轨有时刻没取到：${String(error)}`)
          }
        }
        if (!video) { if (options.onFrame && i % Math.max(1, Math.round(fps / 5)) === 0) options.onFrame(i / frameCount, ''); continue }
        const frame = painted.latest
        if (!frame) continue
        // Most frames of an interface repeat the last paint; copying 4K pixels only when the page painted keeps up with realtime.
        const bitmap: Buffer = fresh || !lastGood ? frame.toBitmap() : lastGood
        fresh = false
        // The paint image is already in device pixels at the offscreen deviceScaleFactor.
        const width = frame.getSize().width
        const height = Math.floor(bitmap.length / 4 / width)
        if (!encoder) {
          // The offscreen surface can be a pixel larger than the page; keep exactly the recorded viewport.
          encoder = new FrameEncoder(Math.min(width, Math.round(env.viewport.width * dpr)), Math.min(height, Math.round(env.viewport.height * dpr)), fps, options.output)
          await encoder.start(width, height)
          for (let k = 0; k < i; k += 1) await encoder.write(bitmap) // hold the first painted frame for the time before it
          lateFrames = 0 // catching up after that hold only repeats the still first screen
        }
        // A frame of another size (window resize in flight) repeats the last good one so timing stays exact.
        if (width === encoder.sourceWidth && height === encoder.sourceHeight) lastGood = bitmap
        if (lastGood) await encoder.write(lastGood)
        if (options.onFrame && i % Math.max(1, Math.round(fps / 5)) === 0) options.onFrame(i / frameCount, `data:image/jpeg;base64,${frame.resize({ width: Math.min(1280, width) }).toJPEG(80).toString('base64')}`)
      }
      await text?.close(Math.round(frameCount * 1e6 / fps))
      await boxes.close(Math.round(frameCount * 1e6 / fps))
      logger.info('界面元素位置轨已保存', { event: 'web_replay.boxes.completed', context: { recordingId: this.manifest.id, everyFrames: boxEvery, samples: boxSamples, sampleMs: boxSampleMs, sampleMaxMs: boxSampleMaxMs, lateFrames } })
      if (!video) {
        logger.info('网页重演文字轨完成', { event: 'web_replay.replay.text_completed', context: { recordingId: this.manifest.id, issues: this.issues.length } })
        return { output: options.textTrack ?? '', frames: frameCount, width: Math.round(env.viewport.width), height: Math.round(env.viewport.height), durationMs: totalMs, issues: this.issues, looseMatches: this.loose, unusedCalls: this.matcher.unused().length, locatorMisses: input.misses }
      }
      if (!encoder) throw new Error('重演窗口没有产生任何画面')
      await encoder.finish()
      if (lateFrames > 0) this.issue('warning', `有 ${lateFrames} 帧没赶上实时，画面可能有轻微卡顿`)
      const unused = this.matcher.unused().length
      logger.info('网页重演完成', { event: 'web_replay.replay.completed', context: { recordingId: this.manifest.id, frames: encoder.frames, issues: this.issues.length, loose: this.loose, unused } })
      return { output: options.output, frames: encoder.frames, width: encoder.width, height: encoder.height, durationMs: totalMs, issues: this.issues, looseMatches: this.loose, unusedCalls: unused, locatorMisses: input.misses }
    } catch (error) {
      encoder?.abort()
      text?.abort()
      await boxes.abort().catch(cleanupError => logger.warn('位置轨暂存清理失败', { event: 'web_replay.boxes.cleanup_failed', error: String(cleanupError) }))
      logger.error('网页重演失败', { event: 'web_replay.replay.failed', context: { recordingId: this.manifest?.id }, error: String(error) })
      throw error
    } finally {
      timers.forEach(clearTimeout)
      players.delete(contents.id)
      await input.dispose()
      if (!win.isDestroyed()) win.destroy()
      await ses.clearStorageData().catch(() => undefined)
      ses.protocol.unhandle('http')
      ses.protocol.unhandle('https')
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}
