import type { ContentTrustReference } from '@/core/contentTrust'
import type { WebTimeGrid } from '@/core/videoEdit/webTimeCache'
import type { CodeWebReference } from '@/core/imaging/parameterTypes'
import { codeWebPixelSize, codeWebView, type CodeWebView } from '@/core/videoEdit/codeMaterial/webSource'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { WebSourceCaptureRequest, WebSourceInfo } from '@/platform/contracts/videoFrames'
import type { AuthorWebFrame } from './videoEditAuthorModule'
import { assertAuthorTrust } from './videoEditAuthorTrust'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { freezeWebText, webTextUnavailableMessage, unavailableWebText, WEB_TEXT_SAMPLER_VERSION, webTextImageMapping, webTextSelectors, withWebTextCells } from '@/core/videoEdit/webTextGeometry'

export class VideoEditWebPicture extends VideoEditCodePicture {
  constructor(texture: GpuTexture, width: number, height: number, owner: GpuDevice, readonly web: AuthorWebFrame, opaqueBackground = true, display?: { width: number; height: number }) { super(texture, width, height, owner, 'rgba8unorm', opaqueBackground, display) }
}
export type VideoEditWebFrameCopy = (frame: NativeVideoFrame, width: number, height: number, target?: GpuTexture) => Promise<{ texture: GpuTexture; owner: GpuDevice }>

// 每个页面都有独立渲染进程与大纹理；保留少量近期会话，避免跨剪点反复冷启动。
const WEB_SESSION_LIMIT = 4
const WEB_SESSION_IDLE_MS = 60_000
const WEB_SESSION_RECENT_MS = 2_000
const WEB_PREOPEN_RETRY_MS = 3_000
const aborted = (): DOMException => new DOMException('网页取帧已取消。', 'AbortError')

export interface WebPictureOptions {
  precision?: WebSourceCaptureRequest['precision']
  cachePolicy?: WebSourceCaptureRequest['cachePolicy']
  cacheWrite?: boolean
  cacheGrid?: WebTimeGrid
  text?: readonly string[]
  outputScale?: number
  /** 播放与拖动预览共用一帧截止时间。 */
  deadline?: number
  signal?: AbortSignal
  ahead?: number[]
  approximate?: () => void
  availableBytes?: () => number
}
interface WebRead {
  key: string
  demand?: string
  abort: AbortController
  started: boolean
  preview: boolean
  promise: Promise<VideoEditWebPicture>
  picture?: VideoEditWebPicture
}
interface WebSession {
  key: string
  base: string
  time: number
  path: string
  channel: VideoEditNativeFrameReceiver
  opening: Promise<WebSourceInfo>
  info?: WebSourceInfo
  previewTail: Promise<unknown>
  /**
   * 排在播放队列里、还没发出取帧请求的最后一个读（发出或放弃后清空）。页面逐幅串行取帧，前视要排在它后面发，
   * 否则页面先跳到后面再倒回，当前帧反而最后取到。
   */
  queued?: Promise<void>
  reads: Map<string, WebRead>
  last?: VideoEditWebPicture
  frame?: object
  retired: Set<VideoEditWebPicture>
  pool: Set<VideoEditWebPicture>
  generation: number
  lastUsed: number
  waiting: Map<string, { resolve: (frame: NativeVideoFrame) => void; reject: (error: Error) => void }>
  unsubscribe?: () => void
  unsubscribeContent?: () => void
  closed: boolean
}
interface WebFrameState {
  slots: Map<string, Map<number, string>>
  kept: Map<WebSession, Set<string>>
  required: Map<WebRead, number>
  pinned: Set<VideoEditWebPicture>
  availableBytes: () => number
}
let channelOf: () => VideoEditNativeFrameReceiver | undefined = () => undefined
export function installVideoEditWebChannel(provider: () => VideoEditNativeFrameReceiver | undefined): void { channelOf = provider }
const WEB_DISPLAY_TIERS = [0.25, 0.5, 0.75, 1]
/**
 * 节目网页画面按屏幕上实际显示倍率选的离散档位（`ratio` 为显示物理像素相对序列尺寸）。档位变化会重排页面并换一套缓存，
 * 所以只在越过相邻档位约一成时换档：放大时最多容忍约 5% 的欠采样，缩小时要比下一档再小约一成才降。
 */
export function videoEditWebDisplayTier(ratio: number, current?: number): number {
  const tier = (value: number): number => WEB_DISPLAY_TIERS.find(candidate => candidate >= value) ?? 1
  if (current === undefined) return tier(ratio)
  const up = tier(ratio / 1.05), down = tier(ratio * 1.1)
  return current < up ? up : current > down ? down : current
}
export function videoEditWebSourceKey(reference: CodeWebReference): string {
  const view = codeWebView(reference)
  return JSON.stringify([reference.path, view.width, view.height, view.region, view.scale, ...(view.layer ? [view.layer] : [])])
}

/** 同一页面时刻的读取身份：精度、缓存网格与预览档（播放帧取预览档）不同的读不能互相顶替。 */
function webReadKey(at: number, view: CodeWebView, reference: CodeWebReference, precision: NonNullable<WebSourceCaptureRequest['precision']>, cacheGrid: WebTimeGrid | undefined, preview: boolean, cachePolicy?: WebSourceCaptureRequest['cachePolicy'], textSelectors?: readonly string[]): string {
  // 要文字几何的读还要区分预览档与所选文字，避免拿不带文字的画面顶替。
  return JSON.stringify([at, view.scale, reference.boxes ?? [], precision, precision === 'web-cache' ? [cacheGrid, preview, cachePolicy] : null, ...(textSelectors ? [preview, textSelectors] : [])])
}

/** 取消立即结束等待，迟到的共享帧仍由接收端归还。 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(aborted())
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => reject(aborted())
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/** 会话拥有页面时间、票据与最近画面；后台取帧不占有节目合成。 */
export class VideoEditWebInputs {
  private readonly sessions = new Map<string, WebSession>()
  private readonly trusted = new Set<string>()
  private readonly preopenFailures = new Map<string, number>()
  private nextTicket = 1
  private disposed = false
  private allocatedBytes = 0
  get bytes(): number { return this.allocatedBytes }
  private readonly frames = new Map<object, WebFrameState>()
  private nextSlot = 1

  private beginFrame(frame: object): WebFrameState {
    let state = this.frames.get(frame)
    if (!state) {
      state = { slots: new Map(), kept: new Map(), required: new Map(), pinned: new Set(), availableBytes: () => Infinity }
      this.frames.set(frame, state)
    }
    return state
  }

  private required(read: WebRead): boolean {
    return [...this.frames.values()].some(state => state.required.has(read))
  }

  private protectedPictures(): Set<VideoEditWebPicture> {
    const pictures = new Set<VideoEditWebPicture>()
    for (const state of this.frames.values()) {
      for (const picture of state.pinned) pictures.add(picture)
      for (const read of state.required.keys()) if (read.picture) pictures.add(read.picture)
    }
    return pictures
  }

  /** 本帧必需画面才是硬预算；历史、前视和闲置页在压力下让路。 */
  checkBudget(frame: object, availableBytes: number): void {
    this.beginFrame(frame)
    if (this.allocatedBytes > availableBytes) this.reclaim(availableBytes)

  }

  private reclaim(limit: number): void {
    const protectedPictures = this.protectedPictures()
    const discard = (session: WebSession, picture: VideoEditWebPicture): void => {
      if (protectedPictures.has(picture)) return
      for (const [key, read] of session.reads) if (read.picture === picture) { read.abort.abort(); session.reads.delete(key) }
      session.pool.delete(picture); session.retired.delete(picture)
      if (session.last === picture) session.last = undefined
      this.destroy(picture)
    }
    // 回收只作用于持有纹理的对象；取消无纹理的慢读不会释放显存，反而让它永远取不完。
    for (const session of this.sessions.values()) {
      for (const picture of new Set([...session.pool, ...session.retired])) {
        if (this.allocatedBytes <= limit) return
        if (picture !== session.last) discard(session, picture)
      }
    }
    for (const session of this.sessions.values()) {
      for (const read of session.reads.values()) {
        if (this.allocatedBytes <= limit) return
        if (read.picture && read.picture !== session.last) discard(session, read.picture)
      }
    }
    for (const session of this.sessions.values()) {
      if (this.allocatedBytes <= limit) return
      if (![...this.frames.values()].some(state => state.kept.has(session)) &&
        ![...session.reads.values()].some(read => !read.picture && !read.abort.signal.aborted) &&
        session.last && !protectedPictures.has(session.last)) this.close(session)
    }
    for (const session of this.sessions.values()) {
      if (this.allocatedBytes <= limit) return
      if (session.last) discard(session, session.last)
    }
  }

  async picture(reference: CodeWebReference, time: number, frame: object, copy: VideoEditWebFrameCopy, trust: readonly ContentTrustReference[], options: WebPictureOptions = {}): Promise<VideoEditWebPicture | undefined> {
    if (this.disposed) throw aborted()
    const channel = channelOf()
    if (!channel) throw new Error('网页画面需要显卡帧通道，当前渲染会话没有接入。')
    // 信任确认先于预算与开页，超时不能绕过外来内容的首次执行确认。
    await abortable(this.assertTrusted(trust), options.signal)
    if (this.disposed || options.signal?.aborted) throw aborted()
    const state = this.beginFrame(frame)
    if (options.availableBytes) state.availableBytes = options.availableBytes
    const view = codeWebView(reference)
    const textSelectors = options.text?.length ? webTextSelectors(options.text) : undefined
    view.scale *= Math.min(1, options.outputScale ?? 1)
    const base = JSON.stringify([videoEditWebSourceKey(reference), trust.map(value => value.id).sort()])
    const slots = state.slots
    const timesInFrame = slots.get(base) ?? new Map<number, string>()
    slots.set(base, timesInFrame)
    let key = timesInFrame.get(time)
    if (!key) {
      const occupied = new Set(timesInFrame.values())
      const nearest = [...this.sessions.values()].filter(session => session.base === base && !occupied.has(session.key))
        .sort((left, right) => Math.abs(left.time - time) - Math.abs(right.time - time))[0]
      key = nearest?.key ?? JSON.stringify([base, this.nextSlot++])
      timesInFrame.set(time, key)
    }
    const session = this.session(channel, key, base, time, reference.path, view, trust)
    session.time = time
    if (session.frame !== frame) {
      session.frame = frame
      const protectedPictures = this.protectedPictures()
      for (const picture of session.retired) if (!protectedPictures.has(picture)) {
        session.pool.add(picture); session.retired.delete(picture)
      }
    }
    session.lastUsed = performance.now()
    // 与当前帧同一时刻的前视（固定时刻、停住的段）没有用处，还会把当前读改成非 latest。
    const times = [...new Set([time, ...options.ahead ?? []])]
    const precision = options.precision ?? 'exact'
    const readKey = (at: number): string => webReadKey(at, view, reference, precision, options.cacheGrid, options.deadline !== undefined, options.cachePolicy, textSelectors)
    const keep = new Set(times.map(readKey))
    const kept = state.kept.get(session) ?? new Set<string>()
    state.kept.set(session, kept)
    for (const key of keep) kept.add(key)
    for (const [key, read] of session.reads) {
      // 同帧树上别处或另一尚未提交的帧可能正要用，不能由当前调用删掉它们的读。
      if ([...this.frames.values()].some(state => state.kept.get(session)?.has(key))) continue
      // 慢来源也要持续产出；播放仅替换尚未开始的目标。
      if (options.deadline !== undefined && read.started && !read.picture && !read.abort.signal.aborted) continue
      read.abort.abort(); session.reads.delete(key)
      if (read.picture && read.picture !== session.last) session.retired.add(read.picture)
    }
    const read = this.read(session, readKey(time), reference, view, time, copy, options.deadline !== undefined, state, precision, options.cacheGrid, options.cachePolicy, options.cacheWrite, textSelectors)
    // 精确导出已把可靠帧交给段发布器，不再为同一段登记另一份后台录制需求。
    if (options.cacheGrid && (!options.cacheWrite || precision === 'web-cache')) this.demand(session, read, reference, view, time, options.cacheGrid, options.deadline !== undefined)
    const size = codeWebPixelSize(view)
    state.required.set(read, size.width * size.height * 4)
    const cancel = (): void => {
      state.required.delete(read)
      if (this.required(read)) return
      read.abort.abort(); session.reads.delete(read.key)
      if (read.picture && read.picture !== session.last) session.retired.add(read.picture)
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      this.checkBudget(frame, state.availableBytes())
      // 前视与当前帧共用读键，但不更新最近显示画面，也不以 latest 语义取消当前目标。
      for (const at of times.slice(1)) this.read(session, readKey(at), reference, view, at, copy, false, state, precision, options.cacheGrid, options.cachePolicy, options.cacheWrite, textSelectors, true)
      if (options.deadline === undefined) {
        const picture = await abortable(read.promise, options.signal)
        this.remember(session, picture)
        state.pinned.add(picture)
        return this.withSelectors(picture, reference.boxes, textSelectors)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const picture = await abortable(Promise.race([
        read.promise,
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), Math.max(0, options.deadline! - performance.now())) }),
      ]).finally(() => clearTimeout(timer)), options.signal)
      if (picture) { this.remember(session, picture); state.pinned.add(picture); return this.withSelectors(picture, reference.boxes, textSelectors) }
      state.required.delete(read)
      options.approximate?.()
      const fallback = precision === 'web-cache' || session.last?.provenance !== 'web-cache' ? session.last : undefined
      if (fallback) state.pinned.add(fallback)
      this.checkBudget(frame, state.availableBytes())
      return fallback && this.withSelectors(fallback, reference.boxes, textSelectors)
    } catch (error) { state.required.delete(read); cancel(); throw error }
    finally { options.signal?.removeEventListener('abort', cancel) }
  }

  /**
   * 硬剪点前预开即将出现的网页并预取它的第一幅：只开本会话已确认过的来源（后台不弹确认），不计入任何一帧的必需额度。
   * 剪点那一帧按最近的页面时刻选中这个页面，同源跳转的另一段也得到自己的页面；读取键与播放帧相同，第一幅直接复用。
   */
  preopen(reference: CodeWebReference, time: number, frame: object, copy: VideoEditWebFrameCopy, trust: readonly ContentTrustReference[], options: Pick<WebPictureOptions, 'precision' | 'cachePolicy' | 'cacheGrid' | 'outputScale' | 'availableBytes'> = {}): void {
    const channel = channelOf()
    if (this.disposed || !channel || trust.length && !this.trusted.has(JSON.stringify(trust.map(value => value.id).sort()))) return
    const view = codeWebView(reference)
    view.scale *= Math.min(1, options.outputScale ?? 1)
    const base = JSON.stringify([videoEditWebSourceKey(reference), trust.map(value => value.id).sort()])
    const prepared = [...this.sessions.values()].find(session => session.base === base && Math.abs(session.time - time) < 1e-6)
    // 已预开的页面在剪点前保持最近使用，不被空闲回收；页面总数到上限或刚打开失败时不再预开。
    if (prepared) { prepared.lastUsed = performance.now(); return }
    if (performance.now() - (this.preopenFailures.get(base) ?? -Infinity) < WEB_PREOPEN_RETRY_MS) return
    if (this.sessions.size >= WEB_SESSION_LIMIT) {
      // 页面满额时让最久没用、已空闲的页面让位；在用、在读或刚用过的页面都不动。
      const now = performance.now()
      const idle = [...this.sessions.values()].filter(session => now - session.lastUsed >= WEB_SESSION_RECENT_MS && ![...this.frames.values()].some(state => state.kept.has(session))
        && ![...session.reads.values()].some(read => !read.picture && !read.abort.signal.aborted)).sort((left, right) => left.lastUsed - right.lastUsed)[0]
      if (!idle) return
      this.close(idle)
    }
    const state = this.beginFrame(frame)
    if (options.availableBytes) state.availableBytes = options.availableBytes
    const session = this.session(channel, JSON.stringify([base, this.nextSlot++]), base, time, reference.path, view, trust)
    session.opening.catch(() => this.preopenFailures.set(base, performance.now()))
    const precision = options.precision ?? 'exact'
    const read = this.read(session, webReadKey(time, view, reference, precision, options.cacheGrid, true, options.cachePolicy), reference, view, time, copy, true, state, precision, options.cacheGrid, options.cachePolicy)
    if (options.cacheGrid) this.demand(session, read, reference, view, time, options.cacheGrid, true)
  }

  private demand(session: WebSession, read: WebRead, reference: CodeWebReference, view: CodeWebView, time: number, cacheGrid: WebTimeGrid, latest: boolean): void {
    const request = { time, scale: view.scale, latest, cacheGrid, ...(reference.boxes ? { boxes: reference.boxes } : {}) }
    const demand = JSON.stringify(request)
    if (read.demand === demand) return
    read.demand = demand
    void session.opening.then(info => {
      if (!session.closed && !read.abort.signal.aborted) return session.channel.call('cacheWeb', { streamId: info.streamId, ...request })
    }).catch(() => { if (read.demand === demand) read.demand = undefined })
  }

  private withSelectors(picture: VideoEditWebPicture, selectors: readonly string[] = [], textSelectors?: readonly string[]): VideoEditWebPicture {
    if (selectors.every(selector => Object.hasOwn(picture.web.boxes, selector)) && (!textSelectors || textSelectors.every(selector => Object.hasOwn(picture.web.text ?? {}, selector)))) return picture
    const selected = new VideoEditWebPicture(picture.texture, picture.width, picture.height, picture.owner,
      { ...picture.web, boxes: { ...Object.fromEntries(selectors.map(selector => [selector, null])), ...picture.web.boxes }, ...(textSelectors ? { text: freezeWebText({ ...unavailableWebText(textSelectors, 'previous-picture-coverage'), ...picture.web.text }) } : {}) }, picture.opaqueBackground, { width: picture.displayWidth, height: picture.displayHeight })
    selected.provenance = picture.provenance
    return selected
  }

  private remember(session: WebSession, picture: VideoEditWebPicture): void {
    if (session.last && session.last !== picture && ![...session.reads.values()].some(read => read.picture === session.last)) session.retired.add(session.last)
    session.last = picture
  }

  private read(session: WebSession, key: string, reference: CodeWebReference, view: CodeWebView, time: number, copy: VideoEditWebFrameCopy, preview: boolean, state: WebFrameState, precision: NonNullable<WebSourceCaptureRequest['precision']>, cacheGrid?: WebTimeGrid, cachePolicy?: WebSourceCaptureRequest['cachePolicy'], cacheWrite?: boolean, textSelectors?: string[], ahead = false): WebRead {
    const existing = session.reads.get(key)
    if (existing) {
      // 无文本的旧捕获可继续接管；文本读键分开，预览的覆盖状态不能作为精确结果。
      if (!preview) existing.preview = false
      return existing
    }
    const controller = new AbortController()
    const read: WebRead = { key, abort: controller, started: false, preview, promise: Promise.resolve(undefined as never) }
    // 播放读（latest）经 previewTail 排队；前视只在前面还有没发出的播放读或前视时排在它后面，其余读按调用顺序直接发出。
    const previous = ahead ? session.queued : undefined
    let issue = (): void => undefined, release = (): void => undefined
    if (preview || previous) {
      const queued: Promise<void> = new Promise<void>(resolve => { issue = () => { if (session.queued === queued) session.queued = undefined; resolve() } })
      session.queued = queued
      // 没发出就结束（取消、失败）时等前面的读发出再让位：后面的读不越过前面的，取消也不会把整条队列挂在一个永远轮不到的读上。
      release = () => { if (previous) void previous.then(issue); else issue() }
      controller.signal.addEventListener('abort', release, { once: true })
    }
    const run = async (): Promise<VideoEditWebPicture> => {
      const info = await abortable(session.info ? Promise.resolve(session.info) : session.opening, controller.signal)
      if (previous) await abortable(previous, controller.signal)
      if (session.closed || controller.signal.aborted) throw aborted()
      read.started = true
      for (;;) {
        const ticket = 'web-' + this.nextTicket++, generation = session.generation
        let borrowed: NativeVideoFrame | undefined
        const arrived = new Promise<NativeVideoFrame>((resolve, reject) => { session.waiting.set(ticket, { resolve: value => { borrowed = value; resolve(value) }, reject }) })
        void arrived.catch(() => undefined)
        const cancel = (): void => {
          session.waiting.get(ticket)?.reject(aborted()); session.waiting.delete(ticket)
          void session.channel.call('cancelWeb', { streamId: info.streamId, ticket }).catch(() => undefined)
        }
        controller.signal.addEventListener('abort', cancel, { once: true })
        try {
          const request = session.channel.call('captureWeb', { streamId: info.streamId, time, ticket, scale: view.scale, latest: read.preview, precision, ...(cacheWrite ? { cacheWrite } : {}), ...(cachePolicy ? { cachePolicy } : {}), ...(cacheGrid ? { cacheGrid } : {}), ...(reference.boxes ? { boxes: reference.boxes } : {}), ...(textSelectors ? { text: textSelectors } : {}) })
          issue()
          const result = await abortable(request, controller.signal)
          if (result.dropped || generation !== session.generation) {
            if (!read.preview && !session.closed && !controller.signal.aborted) continue
            throw aborted()
          }
          await abortable(arrived, controller.signal)
          if (session.closed || controller.signal.aborted) throw aborted()
          const native = borrowed!
          if (textSelectors) {
            const text = result.text
            if (!text || text.ticket !== ticket || text.time !== time || text.contentHash !== result.contentHash || text.samplerVersion !== WEB_TEXT_SAMPLER_VERSION || native.meta.timestampUs !== Math.round(time * 1e6) || textSelectors.some(selector => !Object.hasOwn(text.results, selector))) throw new Error('网页文字位置与当前画面不匹配，请重新取帧后重试。')
            const unavailable = textSelectors.find(selector => text.results[selector].status === 'unavailable')
            if (unavailable && !read.preview) {
              const status = text.results[unavailable]
              throw new Error(webTextUnavailableMessage(status.status === 'unavailable' ? status.reason : ''))
            }
          }
          const dimensions = { width: result.pixelWidth, height: result.pixelHeight }
          const protectedPictures = this.protectedPictures()
          const reuse = [...session.pool].find(picture => !protectedPictures.has(picture) && picture.width === dimensions.width && picture.height === dimensions.height)
          // 取出的纹理由本次复制持有；池里其他尺寸只在显存压力下回收。
          if (reuse) session.pool.delete(reuse)
          const bytes = dimensions.width * dimensions.height * 4
          for (const frame of this.frames.values()) if (frame.required.has(read)) frame.required.set(read, bytes)
          const available = state.availableBytes()
          if (this.allocatedBytes + (reuse ? 0 : bytes) > available) this.reclaim(available - (reuse ? 0 : bytes))
          // 预取和已超时的后台结果不能挤掉尚未提交的合成帧；必需画面由各帧硬预算检查。
          if (controller.signal.aborted || !this.required(read) && this.allocatedBytes + (reuse ? 0 : bytes) > available) {
            if (reuse) this.destroy(reuse)
            throw aborted()
          }
          if (!reuse) {
            this.allocatedBytes += bytes
          }
          let copied: Awaited<ReturnType<VideoEditWebFrameCopy>>
          borrowed = undefined
          try { copied = await copy(native, dimensions.width, dimensions.height, reuse?.texture) }
          catch (error) { if (reuse) reuse.texture.destroy(); this.allocatedBytes -= bytes; throw error }
          if (session.closed || controller.signal.aborted || generation !== session.generation) {
            copied.texture.destroy(); this.allocatedBytes -= bytes
            if (!read.preview && !session.closed && !controller.signal.aborted) continue
            throw aborted()
          }
          const picture = new VideoEditWebPicture(copied.texture, result.pixelWidth, result.pixelHeight, copied.owner, { time, width: view.width, height: view.height, region: [...view.region], scale: view.scale, duration: result.duration, boxes: result.boxes ?? {}, ...(textSelectors ? { text: freezeWebText(withWebTextCells(result.text!.results, webTextImageMapping(view.region, result.pixelWidth, result.pixelHeight))), imageMapping: freezeWebText(webTextImageMapping(view.region, result.pixelWidth, result.pixelHeight)) } : {}) }, !view.layer?.only)
          picture.provenance = result.provenance ?? 'live'
          read.picture = picture
          // 前视不能把未来帧当作当前播放的回退画面。
          if (preview) this.remember(session, picture)
          return picture
        } finally {
          controller.signal.removeEventListener('abort', cancel)
          session.waiting.delete(ticket)
          borrowed?.release()
        }
      }
    }
    read.promise = (preview ? session.previewTail.catch(() => undefined).then(run) : run()).finally(release).catch(error => {
      if (session.reads.get(key) === read) session.reads.delete(key)
      throw error
    })
    // 后台失败由主进程正式日志报告；精确消费者仍收到错误。
    void read.promise.catch(() => undefined)
    if (preview) session.previewTail = read.promise
    session.reads.set(key, read)
    return read
  }

  private async assertTrusted(trust: readonly ContentTrustReference[]): Promise<void> {
    if (!trust.length) return
    const key = JSON.stringify(trust.map(reference => reference.id).sort())
    if (this.trusted.has(key)) return
    await assertAuthorTrust({ context: [...trust] }); this.trusted.add(key)
  }

  private session(channel: VideoEditNativeFrameReceiver, key: string, base: string, time: number, path: string, view: CodeWebView, trust: readonly ContentTrustReference[]): WebSession {
    const existing = this.sessions.get(key)
    if (existing) { this.sessions.delete(key); this.sessions.set(key, existing); return existing }
    const opening = channel.call('openWeb', { path, ...view, trust: [...trust] })
    const session: WebSession = { key, base, time, path, channel, opening, previewTail: Promise.resolve(), reads: new Map(), retired: new Set(), pool: new Set(), generation: 0, lastUsed: performance.now(), waiting: new Map(), closed: false }
    session.unsubscribeContent = channel.subscribeWebContent(change => { if (change.path === path) this.invalidateSession(session, true) })
    void opening.then(info => {
      session.info = info
      if (session.closed) { void channel.call('closeWeb', { streamId: info.streamId }).catch(() => undefined); return }
      session.unsubscribe = channel.subscribe(info.streamId, frame => {
        const ticket = frame.meta.request?.id
        const waiter = ticket ? session.waiting.get(ticket) : undefined
        if (!waiter) { frame.release(); return }
        session.waiting.delete(ticket!); waiter.resolve(frame)
      })
    }, () => { session.closed = true; session.unsubscribeContent?.(); if (this.sessions.get(key) === session) this.sessions.delete(key) })
    this.sessions.set(key, session)
    return session
  }

  trim(frame: object): void {
    this.frames.delete(frame)
    const now = performance.now()
    let excess = this.sessions.size - WEB_SESSION_LIMIT
    for (const session of this.sessions.values()) {
      if (session.frame === frame || [...this.frames.values()].some(state => state.kept.has(session)) || [...session.reads.values()].some(read => !read.picture && !read.abort.signal.aborted)) continue
      if (now - session.lastUsed < WEB_SESSION_RECENT_MS) continue
      if (excess > 0 || now - session.lastUsed > WEB_SESSION_IDLE_MS) { this.close(session); excess-- }
    }
  }

  invalidate(): void {
    for (const session of this.sessions.values()) this.invalidateSession(session)
  }

  private invalidateSession(session: WebSession, contentChanged = false): void {
    session.generation++
    for (const [key, read] of session.reads) {
      // 文件更新由主进程重载；仍在等待的精确消费者在新内容上重新排队，不能收到伪取消。
      if (contentChanged && !read.preview && !read.picture) continue
      read.abort.abort()
      if (read.picture && read.picture !== session.last) session.retired.add(read.picture)
      session.reads.delete(key)
    }
  }

  private destroy(picture: VideoEditWebPicture): void {
    picture.texture.destroy()
    this.allocatedBytes -= picture.width * picture.height * 4
  }

  private close(session: WebSession): void {
    session.closed = true; this.sessions.delete(session.key); session.unsubscribe?.(); session.unsubscribeContent?.()
    for (const read of session.reads.values()) { read.abort.abort(); if (read.picture) session.retired.add(read.picture) }
    if (session.last) session.retired.add(session.last)
    for (const picture of session.pool) session.retired.add(picture)
    for (const picture of session.retired) this.destroy(picture)
    session.reads.clear(); session.retired.clear(); session.pool.clear(); session.last = undefined
    for (const waiter of session.waiting.values()) waiter.reject(aborted())
    session.waiting.clear()
    if (session.info) void session.channel.call('closeWeb', { streamId: session.info.streamId }).catch(() => undefined)
  }
  dispose(): void { this.disposed = true; this.frames.clear(); for (const session of [...this.sessions.values()]) this.close(session) }
}
