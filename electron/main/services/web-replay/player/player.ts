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

const logger = createMainLogger('main.web_replay.player')
const TAIL_MS = 1500

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
  /** Live preview: progress 0..1 and a small JPEG data URL, about five times a second. */
  onFrame?: (progress: number, frame: string) => void
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

  private pageNowUs(): number { return Math.round((Date.now() - this.startedAtMs) * 1000) }
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

  async render(options: ReplayOptions): Promise<ReplayResult> {
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
    const dpr = env.viewport.dpr
    const fps = options.fps ?? 30
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
      contents.setFrameRate(fps)

      // 1) restore storage on the recorded origin, 2) load the recorded entry URL
      const bootstrapped = new Promise<void>(resolve => { this.bootstrappedResolve = resolve })
      stage('bootstrap')
      await withTimeout(contents.loadURL(`${origin}${BOOTSTRAP_PATH}`), 30_000, '重演引导页加载超时')
      stage('bootstrap-loaded')
      await withTimeout(bootstrapped, 30_000, '页面存储恢复超时')

      const painted: { latest: Electron.NativeImage | null } = { latest: null }
      let lastGood: Buffer | null = null
      contents.on('paint', (_event, _dirty, image) => { painted.latest = image })
      const readyAt = new Promise<number>(resolve => { this.ready = resolve })
      this.startedAtMs = Date.now()
      const loading = contents.loadURL(env.url)
      stage('app')
      const pageNow = await withTimeout(readyAt, 30_000, '重演页面没有加载探针运行时')
      stage('ready')
      // Page zero in Henji's wall clock; behavior times are relative to it.
      const zeroMs = Date.now() - pageNow
      this.startedAtMs = zeroMs
      await loading.catch(error => this.issue('warning', `入口页面加载报告：${String(error)}`))

      for (const event of this.behavior) {
        if (event.kind === 'resize') { timers.push(setTimeout(() => win.setContentSize(Math.round(event.width), Math.round(event.height)), Math.max(0, zeroMs + event.t / 1000 - Date.now()))); continue }
        timers.push(setTimeout(() => { void input.dispatch(event).catch(error => this.issue('warning', `输入派发失败：${String(error)}`, event.t)) }, Math.max(0, zeroMs + event.t / 1000 - Date.now())))
      }

      // Frame clock: one frame per tick from the most recent paint.
      const totalMs = this.manifest.durationUs / 1000 + TAIL_MS
      const frameCount = Math.ceil(totalMs / 1000 * fps)
      for (let i = 0; i < frameCount; i += 1) {
        if (options.signal?.aborted) throw new Error('已取消重演')
        const due = zeroMs + (i * 1000) / fps
        const wait = due - Date.now()
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
        const frame = painted.latest
        if (!frame) continue
        const bitmap = frame.toBitmap()
        // The paint image is already in device pixels at the offscreen deviceScaleFactor.
        const width = frame.getSize().width
        const height = Math.floor(bitmap.length / 4 / width)
        if (!encoder) {
          // The offscreen surface can be a pixel larger than the page; keep exactly the recorded viewport.
          encoder = new FrameEncoder(Math.min(width, Math.round(env.viewport.width * dpr)), Math.min(height, Math.round(env.viewport.height * dpr)), fps, options.output)
          await encoder.start(width, height)
          for (let k = 0; k < i; k += 1) await encoder.write(bitmap) // hold the first painted frame for the time before it
        }
        // A frame of another size (window resize in flight) repeats the last good one so timing stays exact.
        if (width === encoder.sourceWidth && height === encoder.sourceHeight) lastGood = bitmap
        if (lastGood) await encoder.write(lastGood)
        if (options.onFrame && i % Math.max(1, Math.round(fps / 5)) === 0) options.onFrame(i / frameCount, `data:image/jpeg;base64,${frame.resize({ width: Math.min(1280, width) }).toJPEG(80).toString('base64')}`)
      }
      if (!encoder) throw new Error('重演窗口没有产生任何画面')
      await encoder.finish()
      const unused = this.matcher.unused().length
      logger.info('网页重演完成', { event: 'web_replay.replay.completed', context: { recordingId: this.manifest.id, frames: encoder.frames, issues: this.issues.length, loose: this.loose, unused } })
      return { output: options.output, frames: encoder.frames, width: encoder.width, height: encoder.height, durationMs: totalMs, issues: this.issues, looseMatches: this.loose, unusedCalls: unused, locatorMisses: input.misses }
    } catch (error) {
      encoder?.abort()
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
