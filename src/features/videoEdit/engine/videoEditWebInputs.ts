import type { ContentTrustReference } from '@/core/contentTrust'
import type { CodeWebReference } from '@/core/imaging/parameterTypes'
import { codeWebPixelSize, codeWebView, type CodeWebView } from '@/core/videoEdit/codeMaterial/webSource'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { WebSourceInfo } from '@/platform/contracts/videoFrames'
import type { AuthorWebFrame } from './videoEditAuthorModule'
import { assertAuthorTrust } from './videoEditAuthorTrust'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'

export class VideoEditWebPicture extends VideoEditCodePicture {
  constructor(texture: GpuTexture, width: number, height: number, owner: GpuDevice, readonly web: AuthorWebFrame, opaqueBackground = true, display?: { width: number; height: number }) { super(texture, width, height, owner, 'rgba8unorm', opaqueBackground, display) }
}
export type VideoEditWebFrameCopy = (frame: NativeVideoFrame, width: number, height: number, target?: GpuTexture) => Promise<{ texture: GpuTexture; owner: GpuDevice }>

// 每个页面都有独立渲染进程与大纹理；保留少量近期会话，避免跨剪点反复冷启动。
const WEB_SESSION_LIMIT = 4
const WEB_SESSION_IDLE_MS = 60_000
const WEB_SESSION_RECENT_MS = 2_000
const aborted = (): DOMException => new DOMException('网页取帧已取消。', 'AbortError')

export interface WebPictureOptions {
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
export function videoEditWebSourceKey(reference: CodeWebReference): string {
  const view = codeWebView(reference)
  return JSON.stringify([reference.path, view.width, view.height, view.region, view.scale])
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
    const state = this.beginFrame(frame)
    if (this.allocatedBytes > availableBytes) this.reclaim(availableBytes)
    const pictures = new Set(state.pinned)
    let bytes = 0
    for (const [read, size] of state.required) {
      if (read.picture) pictures.add(read.picture)
      else bytes += size
    }
    for (const picture of pictures) bytes += picture.width * picture.height * 4
    if (bytes > availableBytes) throw new Error('当前网页画面、视频输入与嵌套画面超过显存预算，请缩小网页取景或倍率。')
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
    const session = this.session(channel, key, base, time, reference.path, view)
    session.time = time
    if (session.frame !== frame) {
      session.frame = frame
      const protectedPictures = this.protectedPictures()
      for (const picture of session.retired) if (!protectedPictures.has(picture)) {
        session.pool.add(picture); session.retired.delete(picture)
      }
    }
    session.lastUsed = performance.now()
    const times = [time, ...(options.deadline === undefined ? options.ahead ?? [] : [])]
    const readKey = (at: number): string => JSON.stringify([at, view.scale, reference.boxes ?? []])
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
    const read = this.read(session, readKey(time), reference, view, time, copy, options.deadline !== undefined, state)
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
      if (options.deadline === undefined) {
        for (const at of times.slice(1)) this.read(session, readKey(at), reference, view, at, copy, false, state)
        const picture = await abortable(read.promise, options.signal)
        this.remember(session, picture)
        state.pinned.add(picture)
        return this.withSelectors(picture, reference.boxes)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const picture = await abortable(Promise.race([
        read.promise,
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), Math.max(0, options.deadline! - performance.now())) }),
      ]).finally(() => clearTimeout(timer)), options.signal)
      if (picture) { state.pinned.add(picture); return this.withSelectors(picture, reference.boxes) }
      state.required.delete(read)
      options.approximate?.()
      if (session.last) state.pinned.add(session.last)
      this.checkBudget(frame, state.availableBytes())
      return session.last && this.withSelectors(session.last, reference.boxes)
    } catch (error) { state.required.delete(read); cancel(); throw error }
    finally { options.signal?.removeEventListener('abort', cancel) }
  }

  private withSelectors(picture: VideoEditWebPicture, selectors: readonly string[] = []): VideoEditWebPicture {
    if (selectors.every(selector => Object.hasOwn(picture.web.boxes, selector))) return picture
    return new VideoEditWebPicture(picture.texture, picture.width, picture.height, picture.owner,
      { ...picture.web, boxes: { ...Object.fromEntries(selectors.map(selector => [selector, null])), ...picture.web.boxes } }, picture.opaqueBackground, { width: picture.displayWidth, height: picture.displayHeight })
  }

  private remember(session: WebSession, picture: VideoEditWebPicture): void {
    if (session.last && session.last !== picture && ![...session.reads.values()].some(read => read.picture === session.last)) session.retired.add(session.last)
    session.last = picture
  }

  private read(session: WebSession, key: string, reference: CodeWebReference, view: CodeWebView, time: number, copy: VideoEditWebFrameCopy, preview: boolean, state: WebFrameState): WebRead {
    const existing = session.reads.get(key)
    if (existing) {
      // 松手可接着等待同一目标的在途预览；接管后也必须享有内容更新时的精确重排语义。
      if (!preview) existing.preview = false
      return existing
    }
    const controller = new AbortController()
    const read: WebRead = { key, abort: controller, started: false, preview, promise: Promise.resolve(undefined as never) }
    const run = async (): Promise<VideoEditWebPicture> => {
      const info = await abortable(session.info ? Promise.resolve(session.info) : session.opening, controller.signal)
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
          const result = await abortable(session.channel.call('captureWeb', { streamId: info.streamId, time, ticket, scale: view.scale, latest: read.preview, ...(reference.boxes ? { boxes: reference.boxes } : {}) }), controller.signal)
          if (result.dropped || generation !== session.generation) {
            if (!read.preview && !session.closed && !controller.signal.aborted) continue
            throw aborted()
          }
          await abortable(arrived, controller.signal)
          if (session.closed || controller.signal.aborted) throw aborted()
          const native = borrowed!
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
          const picture = new VideoEditWebPicture(copied.texture, result.pixelWidth, result.pixelHeight, copied.owner, { time, width: view.width, height: view.height, region: [...view.region], scale: view.scale, duration: result.duration, boxes: result.boxes ?? {} })
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
    read.promise = (preview ? session.previewTail.catch(() => undefined).then(run) : run()).catch(error => {
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

  private session(channel: VideoEditNativeFrameReceiver, key: string, base: string, time: number, path: string, view: CodeWebView): WebSession {
    const existing = this.sessions.get(key)
    if (existing) { this.sessions.delete(key); this.sessions.set(key, existing); return existing }
    const opening = channel.call('openWeb', { path, ...view })
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
