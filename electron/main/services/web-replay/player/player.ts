import crypto from 'node:crypto'
import { BrowserWindow, ipcMain, session as electronSession, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WebRecordingMatcher } from '../../../../../src/core/webReplay/matcher'
import type { WebRecordingBehaviorEvent, WebRecordingData, WebRecordingManifest, WireBodyValue } from '../../../../../src/core/webReplay/schema'
import type { WebReplayDirector } from '../../../../../src/core/webReplay/director'
import { planWebReplay } from '../../../../../src/core/webReplay/directorPlan'
import type { DirectorTimeline, WebReplayTimeMapFile } from '../../../../../src/core/webReplay/directorTimeline'
import type { ReplayBoot, ReplayFrameReport, ReplayHostResult, ReplayHttpRequest, ReplayHttpResult, ReplayReport } from '../../../../../packages/web-replay-probe/src/replay/types'
import { REPLAY_CONTROL } from '../../../../../packages/web-replay-probe/src/replay/types'
import { DEFAULT_LOCATOR_OPTIONS } from '../../../../../packages/web-replay-probe/src/shared/locatorOptions'
import { createMainLogger } from '../../logging'
import { digestBase64, WebRecordingStore } from '../store'
import { PaintFrameCapture, tokenIndex, tokenSidePx } from './capture'
import { FrameEncoder, prepareFrameEncoder } from './encoder'
import type { FrameSource, TakenFrame } from './frameSource'
import { GpuCaptureError, GpuFrameCapture, isReplayReader } from './gpuCapture'
import { DirectorInput, TakeTrack } from './directorInput'
import { InputDispatcher } from './input'
import { BOOTSTRAP_PATH, installReplaySite } from './site'
import { TEXT_SAMPLE_INTERVAL_US, TEXT_SAMPLE_SCRIPT, TextTrackWriter, type TextSample } from '../textTrack'
import { BOX_TRACK_FILE, boxSampleScript, BoxTrackWriter, type BoxSample } from '../boxTrack'
import { contentTrust } from '../../content-trust/runtime'

const logger = createMainLogger('main.web_replay.player')
const TAIL_MS = 1500
/** The offscreen capture rate cap: page time is driven frame by frame, so capture as fast as the GPU allows. */
const CAPTURE_FRAME_RATE = 240
/**
 * A frame's picture (with its token) normally arrives within this. When it does not, the browser dropped
 * the capture: the token is repainted (same token) to have it captured again, a few times; still nothing
 * means the token is hidden (e.g. a top-layer dialog over the corner).
 */
const TOKEN_WAIT_MS = 250
const TOKEN_REPAINTS = 4
/** Once the token has been hidden for a few frames in a row, wait only this long before taking the newest picture. */
const TOKEN_HIDDEN_WAIT_MS = 100
/** One page step (timers, a frame, sampling) must answer within this. */
const STEP_TIMEOUT_MS = 30_000
const PREVIEW_INTERVAL_MS = 200
/** A conflict this soon (page time) after a director step's input is put down to that step. */
const STEP_BLAME_US = 3_000_000
/** Pictures waiting for the encoder pipe at most (a 4K picture is 38 MB). */
const MAX_QUEUED_WRITES = 6

/** `t`: recording time (µs) the issue came up at. */
export interface ReplayIssue { t: number; kind: 'conflict' | 'warning'; message: string }
export interface ReplayResult {
  output: string
  frames: number
  width: number
  height: number
  /** Output length (with a director script: the take's length, not the recording's). */
  durationMs: number
  issues: ReplayIssue[]
  looseMatches: number
  unusedCalls: number
  locatorMisses: number
  /** With a director script: the take's pointer and input track on the output clock, and the time map. */
  takeTracks?: { behavior: WebRecordingBehaviorEvent[]; timeMap: WebReplayTimeMapFile; steps: string[] }
}
export interface ReplayOptions {
  output: string; fps?: number; show?: boolean; signal?: AbortSignal
  /** false renders a clean picture without the pointer (for the editor, which redraws it). Default true. */
  pointer?: boolean
  /** Output long edge in pixels (e.g. 3840); the page renders at that scale instead of the recorded device pixel ratio. */
  longEdge?: number
  /** Live preview: progress 0..1 and a small JPEG data URL, about five times a second. */
  onFrame?: (progress: number, frame: string) => void
  /** 同时写文字轨（画面上看得见的文字与位置）到这个文件。 */
  textTrack?: string
  /** 除 data-replay-id / data-act 外额外采样的 CSS 选择器。 */
  boxSelectors?: string[]
  /** false 只跑页面、不编码视频（只要文字轨时用）。默认 true。 */
  video?: boolean
  /** false renders and captures every frame even when nothing in the page changed (for verification). Default true. */
  quietFrames?: boolean
  /** How pictures are taken: 'gpu' (shared textures read with WebGPU, falls back to CPU when unavailable) or 'cpu' (paint images). Default 'gpu'. */
  capture?: 'gpu' | 'cpu'
  /** Where the element box track goes; default boxes.jsonl in the recording directory. */
  boxTrack?: string
  /** A director script: output time, typing and input follow it instead of the recording (a take). */
  director?: WebReplayDirector
}

type BootReply = { phase: 'bootstrap'; storage: unknown } | { phase: 'app'; boot: ReplayBoot } | { phase: 'reader' } | { phase: 'none' }

const players = new Map<number, WebRecordingPlayer>()
let ipcInstalled = false
function installIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  const route = (event: IpcMainEvent | IpcMainInvokeEvent): WebRecordingPlayer | undefined => players.get(event.sender.id)
  ipcMain.on('web-replay:boot', (event, url: unknown) => { event.returnValue = isReplayReader(event.sender.id) ? { phase: 'reader' } : route(event)?.boot(String(url)) ?? { phase: 'none' } })
  ipcMain.on('web-replay:bootstrapped', event => route(event)?.bootstrapped())
  ipcMain.on('web-replay:report', (event, report: ReplayReport) => route(event)?.report(report))
  ipcMain.handle('web-replay:http', (event, request: ReplayHttpRequest) => { const p = route(event); if (!p) throw new Error('不是重演窗口'); return p.http(request) })
  ipcMain.handle('web-replay:invoke', (event, command: string, args: unknown, t: unknown) => { const p = route(event); if (!p) throw new Error('不是重演窗口'); return p.invoke(command, args, typeof t === 'number' ? t : undefined) })
}

/**
 * A recorded answer is timed from its call. Page time does not move while the page's own code runs, so
 * a call can come a little earlier than it did while recording (the recorded app spent real time getting
 * there). Its answer is then held back to the recorded moment, so data lands exactly when it landed in
 * the recording. Farther apart than this, the match is by order, not a slightly early call: no shift.
 */
const ANCHOR_LIMIT_US = 500_000
export function anchorShiftUs(pageUs: number | undefined, recordedUs: number): number {
  if (pageUs === undefined || !Number.isFinite(pageUs)) return 0
  const early = recordedUs - pageUs
  return early > 0 && early <= ANCHOR_LIMIT_US ? Math.round(early) : 0
}

/** How far page time at each recorded call was from the call's recorded time (ms). */
class CallSkew {
  private readonly skews: Array<{ ms: number; atMs: number }> = []
  add(pageUs: number | undefined, recordedUs: number): void {
    if (pageUs === undefined || !Number.isFinite(pageUs)) return
    this.skews.push({ ms: (pageUs - recordedUs) / 1000, atMs: recordedUs / 1000 })
  }
  /** Calls after the first second are the ones input and data drive; the app's own start-up comes before. */
  summary(): { calls: number; meanMs: number; maxAbsMs: number; afterStartup: { calls: number; meanMs: number; maxAbsMs: number } } {
    const stats = (list: Array<{ ms: number }>): { calls: number; meanMs: number; maxAbsMs: number } => ({
      calls: list.length,
      meanMs: list.length ? Math.round(list.reduce((sum, s) => sum + s.ms, 0) / list.length) : 0,
      maxAbsMs: Math.round(list.reduce((max, s) => Math.max(max, Math.abs(s.ms)), 0)),
    })
    return { ...stats(this.skews), afterStartup: stats(this.skews.filter(s => s.atMs >= 1000)) }
  }
}

/**
 * Replays one recording in an offscreen window, in lockstep: page time stands still unless the engine
 * moves it (see the probe's virtual clock). For every output frame the engine runs the page to that
 * frame's recorded time, dispatching recorded input at its own times, renders the frame, takes the
 * picture that carries the frame's capture token, and samples the text and element tracks from the same
 * state. Nothing in the page can run ahead of the frame being captured, so the replay may take any
 * amount of wall time: static stretches go much faster than realtime, heavy ones slower, with every
 * frame on its recorded moment.
 */
export class WebRecordingPlayer {
  private manifest!: WebRecordingManifest
  private data!: WebRecordingData
  private behavior: WebRecordingBehaviorEvent[] = []
  private matcher!: WebRecordingMatcher
  private issues: ReplayIssue[] = []
  private loose = 0
  private ready: ((now: number) => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private bootstrappedResolve: (() => void) | null = null
  /** Page time (ms) the engine last moved the page to. */
  private pageMs = 0
  private readonly skew = new CallSkew()
  /** Recording ↔ page time (they differ after a director script's typing). */
  private timeline: DirectorTimeline | null = null
  /** The director step whose input went in last, for this long of page time after it (a conflict it caused names it). */
  private activeStep: { label: string; untilPageUs: number } | null = null

  constructor(private readonly store: WebRecordingStore) {}

  static open(directory: string): WebRecordingPlayer { return new WebRecordingPlayer(new WebRecordingStore(directory)) }

  private recOfPage(pageUs: number): number { return this.timeline ? Math.round(this.timeline.recOfPage(pageUs)) : pageUs }

  /**
   * `pageUs`: page time the issue came up at; kept as recording time. A conflict (a request or host call the recording
   * does not have) soon after a director step's input names that step; `step` names it outright.
   */
  private issue(kind: ReplayIssue['kind'], message: string, pageUs = Math.round(this.pageMs * 1000), step: string | null = kind === 'conflict' && this.activeStep && pageUs <= this.activeStep.untilPageUs ? this.activeStep.label : null): void {
    const text = step ? `导演稿 ${step}${kind === 'conflict' ? ' 引起' : ''}：${message}` : message
    if (this.issues.length < 500) this.issues.push({ t: this.recOfPage(pageUs), kind, message: text })
    logger.debug('网页重演发现问题', { event: 'web_replay.replay.issue', context: { kind, step, message: message.slice(0, 300) } })
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
    else if (report.kind === 'failed') this.rejectReady?.(new Error(report.message))
    else if (report.kind === 'conflict' || report.kind === 'warning') this.issue(report.kind, report.message, report.t)
  }

  async http(request: ReplayHttpRequest): Promise<ReplayHttpResult> {
    const match = this.matcher.http(request)
    if (!match) return { ok: false, conflict: `这一步会发出录制里没有的请求：${request.method} ${request.url}` }
    if (match.quality === 'loose') { this.loose += 1; this.issue('warning', `请求内容与录制不同，已按顺序对应：${request.method} ${request.url}`) }
    const call = match.call
    const recUs = request.t === undefined ? undefined : this.recOfPage(request.t)
    this.skew.add(recUs, call.t)
    const shift = anchorShiftUs(recUs, call.t)
    const error = call.error ? { ...call.error, at: call.error.at + shift } : undefined
    const chunks = await Promise.all(call.chunks.map(async c => ({ at: c.at + shift, body: await this.store.readBody(c.body) as WireBodyValue })))
    if (!call.response) return { ok: true, status: 200, statusText: '', url: call.url, headers: [], responseAt: (call.error?.at ?? 0) + shift, chunks: [], error: error ?? { at: shift, phase: 'request', name: 'TypeError', message: 'Failed to fetch' } }
    return { ok: true, status: call.response.status, statusText: call.response.statusText, url: call.response.url, headers: call.response.headers, responseAt: call.response.at + shift, chunks, endAt: call.endAt === undefined ? undefined : call.endAt + shift, error }
  }

  async invoke(command: string, args: unknown, t?: number): Promise<ReplayHostResult> {
    const match = this.matcher.host(command, args)
    if (!match) return { ok: false, conflict: `这一步会调用录制里没有的宿主命令：${command}` }
    if (match.quality === 'loose') { this.loose += 1; this.issue('warning', `宿主命令参数与录制不同，已按顺序对应：${command}`) }
    const recUs = t === undefined ? undefined : this.recOfPage(t)
    this.skew.add(recUs, match.call.t)
    const shift = anchorShiftUs(recUs, match.call.t)
    // Recorded callbacks are timed on the recording; page time may be ahead of it after typing.
    const offset = t !== undefined && recUs !== undefined && t - recUs > 0 ? { pageOffsetUs: Math.round(t - recUs) } : {}
    const result = match.call.result
    if (!result) return { ok: true, call: match.call.id, resolved: true, value: null, at: shift, ...offset }
    return result.ok ? { ok: true, call: match.call.id, resolved: true, value: result.value, at: result.at + shift, ...offset } : { ok: true, call: match.call.id, resolved: false, error: result.error, at: result.at + shift, ...offset }
  }

  private storage: unknown
  private pointer = true

  async render(options: ReplayOptions): Promise<ReplayResult> {
    const manifest = await this.store.readManifest()
    contentTrust().assert({ contents: manifest.foreign ? [manifest.foreign] : [] })
    try {
      return await this.renderOnce(options)
    } catch (error) {
      if (!(error instanceof GpuCaptureError) || options.signal?.aborted) throw error
      // Nothing was published; the same replay the CPU way gives the same frames, only slower.
      logger.warn('GPU 取帧中途失败，改用 CPU 画面重演', { event: 'web_replay.replay.capture_fallback', context: { recordingId: this.manifest?.id, midway: true }, error: String(error) })
      return new WebRecordingPlayer(this.store).renderOnce({ ...options, capture: 'cpu' })
    }
  }

  private async renderOnce(options: ReplayOptions): Promise<ReplayResult> {
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
    const site = installReplaySite(ses, { store: this.store, origin, resources, external: this.data.external, onMissing: (url, reason) => this.issue('conflict', `${reason}：${url}`) })
    const dpr = options.longEdge ? options.longEdge / Math.max(env.viewport.width, env.viewport.height) : env.viewport.dpr
    const fps = options.fps ?? 30
    const video = options.video !== false
    const side = tokenSidePx(dpr)
    // Pictures come through GPU shared textures when the reader window can use WebGPU, else through CPU paint images.
    let source: FrameSource | null = null
    let gpu = false
    if (video && options.capture !== 'cpu') {
      const reader = new GpuFrameCapture(side)
      try {
        await reader.open()
        source = reader
        gpu = true
      } catch (error) {
        await reader.dispose()
        logger.warn('重演取帧改用 CPU 画面（GPU 共享纹理不可用）', { event: 'web_replay.replay.capture_fallback', context: { recordingId: this.manifest.id }, error: String(error) })
      }
    }
    if (video && !source) source = new PaintFrameCapture(side)
    const win = new BrowserWindow({
      show: options.show ?? false, width: Math.round(env.viewport.width), height: Math.round(env.viewport.height), useContentSize: true, frame: false, resizable: true,
      webPreferences: {
        partition, preload: path.join(__dirname, '../preload/web-replay.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        offscreen: gpu ? { useSharedTexture: true, deviceScaleFactor: dpr } : { deviceScaleFactor: dpr }, backgroundThrottling: false, spellcheck: false,
      },
    })
    const contents = win.webContents
    let windowOpenReported = false
    contents.setWindowOpenHandler(() => {
      if (!windowOpenReported) this.issue('warning', '页面尝试打开新窗口，重演中已阻止')
      windowOpenReported = true
      return { action: 'deny' }
    })
    let injectionFailure: Error | null = null
    let rejectBootstrap: ((error: Error) => void) | null = null
    contents.on('preload-error', (_event, _preloadPath, error) => {
      injectionFailure = new Error(`重演运行时注入失败：${error.message}`)
      rejectBootstrap?.(injectionFailure)
      this.rejectReady?.(injectionFailure)
    })
    players.set(contents.id, this)
    // From the first paint on: shared textures must go back to the browser's small pool.
    source?.attach(contents)
    // Commands sent before the page has a renderer never answer, so every call is time-limited.
    const cdp = (method: string, params?: Record<string, unknown>): Promise<unknown> => withTimeout(contents.debugger.sendCommand(method, params), 10_000, `重演窗口没有响应 ${method}`)
    const input = new InputDispatcher(contents, cdp, this.store, REPLAY_CONTROL)
    // Started from the picture work (a closure), so not narrowed here.
    let encoder = null as FrameEncoder | null
    const encoderReady = video ? prepareFrameEncoder() : Promise.resolve()
    encoderReady.catch(() => undefined) // 开始出帧前再等它；先挂上处理，免得更早的失败变成未处理的拒绝
    const text = options.textTrack ? new TextTrackWriter(options.textTrack) : null
    const boxes = new BoxTrackWriter(options.boxTrack ?? path.join(this.store.directory, BOX_TRACK_FILE))
    const control = `window[${JSON.stringify(REPLAY_CONTROL)}]`
    // The last captured picture is copied and encoded while the page already works on the next step.
    let flushShot: () => Promise<void> = async () => {}
    const page = <T>(expression: string): Promise<T> => {
      const call = withTimeout(contents.executeJavaScript(expression, true) as Promise<T>, STEP_TIMEOUT_MS, '重演页面长时间没有响应（页面脚本可能卡住了）')
      call.catch(() => undefined) // awaited below, after the picture work
      return flushShot().then(() => call)
    }
    const startedAt = Date.now()
    const stats = { capture: video ? (gpu ? 'gpu' : 'cpu') : 'none', advances: 0, steps: 0, pageFrames: 0, quiet: 0, captured: 0, unchanged: 0, tokenMisses: 0, tokenRepaints: 0, sampleFailures: 0, pageMs: 0, captureMs: 0, encodeMs: 0, sampleMs: 0 }
    try {
      const stage = (name: string): void => logger.info('网页重演进度', { event: 'web_replay.replay.stage', context: { recordingId: this.manifest.id, stage: name } })
      stage('window')
      await withTimeout(contents.loadURL('about:blank'), 30_000, '重演窗口启动超时')
      if (injectionFailure) throw injectionFailure
      contents.debugger.attach('1.3')
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: env.colorScheme }, { name: 'prefers-reduced-motion', value: env.reducedMotion ? 'reduce' : 'no-preference' }] })
      await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
      await cdp('Emulation.setTimezoneOverride', { timezoneId: env.timeZone }).catch(() => undefined)
      await cdp('Emulation.setLocaleOverride', { locale: env.locale }).catch(() => undefined)
      await cdp('Emulation.setUserAgentOverride', { userAgent: env.userAgent, acceptLanguage: env.locale }).catch(() => undefined)
      contents.setFrameRate(CAPTURE_FRAME_RATE)

      // 1) restore storage on the recorded origin, 2) load the recorded entry URL
      const bootstrapped = new Promise<void>((resolve, reject) => { this.bootstrappedResolve = resolve; rejectBootstrap = reject })
      stage('bootstrap')
      await Promise.all([
        withTimeout(contents.loadURL(`${origin}${BOOTSTRAP_PATH}`), 30_000, '重演引导页加载超时'),
        withTimeout(bootstrapped, 30_000, '页面存储恢复超时'),
      ])
      rejectBootstrap = null
      stage('bootstrap-loaded')
      await encoderReady

      const capture = source
      const readyAt = new Promise<number>((resolve, reject) => { this.ready = resolve; this.rejectReady = reject })
      const loading = contents.loadURL(env.url)
      // 页面加载可先于 ready 等待失败，提前接住拒绝，避免悬挂到运行时超时。
      void loading.catch(error => this.rejectReady?.(error))
      stage('app')
      this.pageMs = await withTimeout(readyAt, 30_000, '重演页面没有加载探针运行时')
      stage('ready')
      // Page time stands still while the app loads; its first frame is the loaded app at its first moment.
      // (A page whose load waits on its own timers would wait forever on held page time; it carries on after a while.)
      await withTimeout(loading, 20_000, '重演页面加载超时').catch(error => this.issue('warning', `入口页面加载报告：${String(error)}`))
      await page(`document.fonts ? document.fonts.ready.then(() => true) : true`).catch(() => undefined)
      await page(`(() => { const c = ${control}; c.defineSampler('boxes', () => ${boxesScript}); c.defineSampler('text', () => ${TEXT_SAMPLE_SCRIPT}); return true })()`)
      stage('lockstep')

      // A file the page asked for (a lazy module, an image) is answered before page time moves on.
      const loaded = (): Promise<void> => withTimeout(site.idle(), STEP_TIMEOUT_MS, '重演页面要的文件长时间没有读完')
      const advance = async (ms: number): Promise<{ now: number; nextDue: number }> => {
        const started = Date.now()
        if (site.inFlight()) await loaded()
        const result = await page<{ now: number; timers: number; nextDue: number }>(`${control}.advance(${ms})`)
        stats.advances += 1
        stats.pageMs += Date.now() - started
        this.pageMs = result.now
        return result
      }
      const waitViewport = async (width: number, height: number): Promise<void> => {
        const deadline = Date.now() + 3_000
        while (Date.now() < deadline) {
          const size = await page<{ width: number; height: number }>(`${control}.realFrame().then(() => ${control}.viewport())`)
          if (Math.abs(size.width - width) < 1 && Math.abs(size.height - height) < 1) return
        }
        this.issue('warning', `窗口尺寸没有按录制改到 ${width}×${height}`)
      }

      // What runs when: the recording as it was, or as the director script retimes and rewrites it.
      const plan = planWebReplay({ director: options.director ?? null, events: this.behavior, totalRecUs: this.manifest.durationUs + TAIL_MS * 1000, fps, viewport: env.viewport })
      this.timeline = plan.timeline
      for (const note of plan.notes) this.issue('warning', `导演稿 ${note}`, 0)
      const frameCount = plan.timeline.frames
      const totalMs = plan.timeline.durationUs / 1000
      const textEvery = Math.max(1, Math.round(TEXT_SAMPLE_INTERVAL_US / 1e6 * fps))
      const director = new DirectorInput(plan, input, target => page<{ x: number; y: number } | null>(`${control}.resolveTarget(${JSON.stringify(target)})`), (message, pageUs, step) => this.issue('warning', message, pageUs, step ?? null))
      const take = options.director ? new TakeTrack(input) : null
      // Pointer moves and wheel reach the page with its next rendering update; hold timers until then.
      let heldInput = false
      // Input dispatched since the last rendered frame: the next frame must render.
      let inputSinceFrame = true
      // A cut was rendered through since the last captured picture: the next frame must be captured.
      let renderedSinceCapture = false
      const quietFrames = options.quietFrames !== false
      let lastGood: Buffer | null = null
      // The pipe drains pictures in order while the replay goes on; a few may wait their turn (each a whole frame in memory).
      let writing: Promise<void> = Promise.resolve()
      const queued: Array<Promise<void>> = []
      let lastPreview = 0
      let previewUrl = ''
      let tokenHidden = 0
      let pendingShot: { shot: TakenFrame; index: number } | null = null
      flushShot = async () => {
        if (!pendingShot) return
        const { shot, index } = pendingShot
        pendingShot = null
        const encodeStarted = Date.now()
        if (!lastGood || shot.changed) {
          const bitmap = shot.bitmap()
          const { width, height } = shot
          if (!encoder) {
            // The offscreen surface can be a pixel larger than the page; keep exactly the recorded viewport.
            encoder = new FrameEncoder(Math.min(width, Math.round(env.viewport.width * dpr)), Math.min(height, Math.round(env.viewport.height * dpr)), fps, options.output, shot.format)
            await encoder.start(width, height)
          }
          // A frame of another size (window resize in flight) keeps the last good picture, so timing stays exact.
          if (width === encoder.sourceWidth && height === encoder.sourceHeight) {
            const target = encoder
            // The first picture also stands for the frames before it.
            const at = lastGood ? index : 0
            writing = writing.then(() => target.write(bitmap, at))
            writing.catch(() => undefined) // awaited below and at the end; a failure surfaces there
            queued.push(writing)
            if (queued.length > MAX_QUEUED_WRITES) await queued.shift()
            lastGood = bitmap
            stats.captured += 1
          }
          if (options.onFrame && Date.now() - lastPreview >= PREVIEW_INTERVAL_MS) { lastPreview = Date.now(); previewUrl = shot.previewJpeg(); options.onFrame(index / frameCount, previewUrl) }
        } else {
          stats.unchanged += 1
          if (options.onFrame && Date.now() - lastPreview >= PREVIEW_INTERVAL_MS) { lastPreview = Date.now(); options.onFrame(index / frameCount, previewUrl) }
        }
        stats.encodeMs += Date.now() - encodeStarted
      }
      logger.info('开始逐帧重演', { event: 'web_replay.replay.lockstep_start', context: { recordingId: this.manifest.id, fps, frames: frameCount, dpr, video, events: this.behavior.length, ops: plan.ops.length, cuts: plan.timeline.cuts.length, director: plan.steps, selectors: options.boxSelectors?.length ?? 0 } })

      // Held input reaches the page before a timer due after it (the order it had while recording).
      const flushHeld = async (): Promise<void> => {
        // 浏览器可能攒着 move/wheel 等下一次绘制才派发；必须在输入原时刻交付，避免被输出帧或倍速改变合并方式。
        if (heldInput) await page(`${control}.realFrame()`)
        heldInput = false
      }
      for (const op of plan.ops) {
        if (options.signal?.aborted) throw new Error('已取消重演')
        const atMs = op.pageUs / 1000
        // A conflict soon after a director step's input is put down to it; recorded clicks and keys take that over again.
        if (op.step) this.activeStep = { label: op.step, untilPageUs: op.pageUs + STEP_BLAME_US }
        else if (op.kind === 'event' && op.event.kind !== 'resize' && op.event.kind !== 'focus' && op.event.kind !== 'action' && !(op.event.kind === 'pointer' && op.event.type === 'move')) this.activeStep = null
        if (op.kind === 'advance') {
          await flushHeld()
          if (site.inFlight()) await loaded()
          const report = await page<ReplayFrameReport>(`${control}.tick(${atMs})`)
          stats.pageFrames += 1
          this.pageMs = report.now
          if (!report.quiet) renderedSinceCapture = true
          continue
        }
        if (op.kind !== 'frame') {
          if (op.kind === 'event' && (op.event.kind === 'focus' || op.event.kind === 'action')) { take?.record(op, null); continue }
          await flushHeld()
          await advance(atMs)
          if (op.kind === 'event' && op.event.kind === 'resize') {
            win.setContentSize(Math.round(op.event.width), Math.round(op.event.height))
            await waitViewport(Math.round(op.event.width), Math.round(op.event.height))
            take?.record(op, null)
            continue
          }
          let landed: { x: number; y: number } | null | undefined
          try {
            landed = await director.dispatch(op)
          } catch (error) {
            this.issue('warning', `输入派发失败：${String(error)}`, op.pageUs)
            inputSinceFrame = true
            continue
          }
          // undefined: an injected step whose target is not in the page (warned once), nothing reached the page
          if (landed === undefined) continue
          take?.record(op, landed)
          inputSinceFrame = true
          if (op.kind === 'move' || (op.kind === 'event' && ((op.event.kind === 'pointer' && op.event.type === 'move') || op.event.kind === 'wheel'))) heldInput = true
          continue
        }
        const i = op.index
        const tUs = Math.round(op.outUs)
        await flushHeld()
        take?.frame(op)

        const samples = text && i % textEvery === 0 ? ['boxes', 'text'] : ['boxes']
        const frameStarted = Date.now()
        if (site.inFlight()) await loaded()
        const report = await page<ReplayFrameReport>(`${control}.frame(${atMs}, ${JSON.stringify({ token: video ? tokenIndex(i) : undefined, samples, tick: op.tick, allowQuiet: quietFrames && !inputSinceFrame && !renderedSinceCapture && i > 0 })})`)
        stats.steps += 1
        stats.pageMs += Date.now() - frameStarted
        this.pageMs = report.now
        if (report.quiet) {
          // Nothing in the page could have changed: the picture and the tracks stay as they were.
          stats.quiet += 1
          if (options.onFrame && Date.now() - lastPreview >= PREVIEW_INTERVAL_MS) { lastPreview = Date.now(); options.onFrame(i / frameCount, previewUrl) }
          continue
        }
        inputSinceFrame = false
        renderedSinceCapture = false
        const sampleStarted = Date.now()
        for (const [name, sample] of Object.entries(report.samples)) {
          if (!sample.ok) {
            stats.sampleFailures += 1
            if (stats.sampleFailures === 1) this.issue('warning', `${name === 'text' ? '文字轨' : '界面元素位置轨'}有时刻没取到：${sample.error}`)
            continue
          }
          if (name === 'boxes') await boxes.write(tUs, sample.value as BoxSample)
          else text?.write(tUs, sample.value as TextSample)
        }
        stats.sampleMs += Date.now() - sampleStarted

        if (!video || !capture) {
          if (options.onFrame && Date.now() - lastPreview >= PREVIEW_INTERVAL_MS) { lastPreview = Date.now(); options.onFrame(i / frameCount, '') }
          continue
        }
        const captureStarted = Date.now()
        let shot: TakenFrame | null = await capture.take(tokenIndex(i), tokenHidden >= 3 ? TOKEN_HIDDEN_WAIT_MS : TOKEN_WAIT_MS)
        for (let k = 0; !shot && tokenHidden < 3 && k < TOKEN_REPAINTS; k += 1) {
          stats.tokenRepaints += 1
          await page(`${control}.repaintToken()`)
          shot = await capture.take(tokenIndex(i), TOKEN_WAIT_MS)
        }
        tokenHidden = shot ? 0 : tokenHidden + 1
        if (!shot) {
          // The token is hidden (a top-layer dialog over the corner?): take the newest picture instead.
          stats.tokenMisses += 1
          if (stats.tokenMisses === 1) this.issue('warning', '有画面没能确认帧标记（左上角可能被弹窗盖住），这几帧按最新画面采集')
          shot = await capture.takeLatest()
        }
        stats.captureMs += Date.now() - captureStarted
        if (shot) pendingShot = { shot, index: i }
      }
      await flushShot()

      await text?.close(Math.round(frameCount * 1e6 / fps))
      await boxes.close(Math.round(frameCount * 1e6 / fps))
      const wallMs = Date.now() - startedAt
      const summary = { recordingId: this.manifest.id, fps, frames: frameCount, video, wallMs, speed: +(totalMs / Math.max(1, wallMs)).toFixed(2), ...stats, ...source?.stats(), skew: this.skew.summary(), targetMisses: director.misses }
      logger.info('界面元素位置轨已保存', { event: 'web_replay.boxes.completed', context: { recordingId: this.manifest.id, frames: frameCount, sampleFailures: stats.sampleFailures } })
      const takeResult = take ? { takeTracks: { behavior: take.events(Math.round(plan.timeline.durationUs)), timeMap: plan.timeline.toFile(plan.ops.flatMap(op => (op.kind === 'frame' ? [op.recUs] : []))), steps: plan.steps } } : {}
      if (!video) {
        logger.info('网页重演文字轨完成', { event: 'web_replay.replay.text_completed', context: { ...summary, issues: this.issues.length } })
        return { output: options.textTrack ?? '', frames: frameCount, width: Math.round(env.viewport.width), height: Math.round(env.viewport.height), durationMs: totalMs, issues: this.issues, looseMatches: this.loose, unusedCalls: this.matcher.unused().length, locatorMisses: input.misses, ...takeResult }
      }
      if (!encoder) throw new Error('重演窗口没有产生任何画面')
      await writing
      await encoder.finish(frameCount - 1)
      const unused = this.matcher.unused().length
      logger.info('网页重演完成', { event: 'web_replay.replay.completed', context: { ...summary, sent: encoder.sent, issues: this.issues.length, loose: this.loose, unused } })
      return { output: options.output, frames: encoder.frames, width: encoder.width, height: encoder.height, durationMs: totalMs, issues: this.issues, looseMatches: this.loose, unusedCalls: unused, locatorMisses: input.misses, ...takeResult }
    } catch (error) {
      // 写了一半的视频会被当成最新的重演视频拿去用，删掉
      if (await encoder?.abort()) await fs.rm(options.output, { force: true }).catch(cleanupError => logger.warn('写了一半的重演视频没能删除', { event: 'web_replay.replay.cleanup_failed', context: { output: options.output }, error: String(cleanupError) }))
      await text?.abort().catch(cleanupError => logger.warn('文字轨暂存清理失败', { event: 'web_replay.text.cleanup_failed', error: String(cleanupError) }))
      await boxes.abort().catch(cleanupError => logger.warn('位置轨暂存清理失败', { event: 'web_replay.boxes.cleanup_failed', error: String(cleanupError) }))
      logger.error('网页重演失败', { event: 'web_replay.replay.failed', context: { recordingId: this.manifest?.id, pageAtMs: Math.round(this.pageMs), ...stats }, error: String(error) })
      throw error
    } finally {
      this.ready = null
      this.rejectReady = null
      players.delete(contents.id)
      await input.dispose()
      if (!win.isDestroyed()) win.destroy()
      await ses.clearStorageData().catch(() => undefined)
      ses.protocol.unhandle('http')
      ses.protocol.unhandle('https')
      await source?.dispose()
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}
