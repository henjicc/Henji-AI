import type { ContentTrustReference } from '@/core/contentTrust'
import type { CodeWebReference } from '@/core/imaging/parameterTypes'
import { codeWebView, type CodeWebView } from '@/core/videoEdit/codeMaterial/webSource'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { WebSourceInfo } from '@/platform/contracts/videoFrames'
import type { AuthorWebFrame } from './videoEditAuthorModule'
import { assertAuthorTrust } from './videoEditAuthorTrust'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'

/** 网页画面：纹理之外带着这一刻的页面信息。离屏页面不透明。 */
export class VideoEditWebPicture extends VideoEditCodePicture {
  constructor(texture: GpuTexture, width: number, height: number, owner: GpuDevice, readonly web: AuthorWebFrame) { super(texture, width, height, owner, 'rgba8unorm', true) }
}

/** 把借来的帧拷进合成设备的纹理（给了 `target` 就原地覆盖），返回纹理与它所属的设备。 */
export type VideoEditWebFrameCopy = (frame: NativeVideoFrame, width: number, height: number, target?: GpuTexture) => Promise<{ texture: GpuTexture; owner: GpuDevice }>

/** 一棵渲染器树同时开着的网页页面数；超出时关掉最久没用的（每个页面是一个独立的渲染进程与一张大纹理）。 */
const WEB_SESSION_LIMIT = 4
/** 不再出现在画面里的页面留这么久，来回拖动、暂停再播放不必重新载入页面。 */
const WEB_SESSION_IDLE_MS = 60_000
/** 超出上限时也不关这么久之内用过的页面：同一帧里树上别处可能正要用它。 */
const WEB_SESSION_RECENT_MS = 2_000

interface WebSession {
  key: string
  opening: Promise<WebSourceInfo>
  info?: WebSourceInfo
  /** 取帧串行：页面同一时刻只能摆在一个时间上。 */
  tail: Promise<unknown>
  /** 进行中的取帧数：有取帧时不关。 */
  busy: number
  /** 这一帧（`frame` 标识）已用的纹理与可以覆盖的纹理：同一帧里同一来源的两个时刻各占一张，上一帧的到下一帧才能覆盖。 */
  frame?: object
  used: GpuTexture[]
  free: GpuTexture[]
  lastUsed: number
  waiting: Map<string, { resolve: (frame: NativeVideoFrame) => void; reject: (error: Error) => void }>
  unsubscribe?: () => void
  closed: boolean
}

let channelOf: () => VideoEditNativeFrameReceiver | undefined = () => undefined
/** 渲染 Worker 接入帧通道后登记；网页画面与原生解码帧走同一条通道。 */
export function installVideoEditWebChannel(provider: () => VideoEditNativeFrameReceiver | undefined): void { channelOf = provider }

/** 同一来源与取景的会话键（同一个页面）。 */
export function videoEditWebSourceKey(reference: CodeWebReference): string {
  const view = codeWebView(reference)
  return JSON.stringify([reference.path, view.width, view.height, view.region, view.scale])
}

/**
 * 渲染器树的网页来源：按来源与取景开离屏页面（主进程），按页面时间取画面，拷进合成设备的纹理。画面不跨帧复用：
 * 页面时间变了要重新取，网页文件改动后主进程重新载入页面。外来内容先过信任确认，确认之前不开页面。
 */
export class VideoEditWebInputs {
  private readonly sessions = new Map<string, WebSession>()
  /** 已确认可以运行的外来来源组合（这棵渲染器树的生命周期内）。 */
  private readonly trusted = new Set<string>()
  private nextTicket = 1
  private disposed = false

  /**
   * 第 `time` 秒的网页画面。`frame` 标识这一帧（同一帧的多次取帧各用一张纹理）；`trust` 是所属代码版本与剪辑的外来来源，
   * 非空时先走同一道信任确认，不放行就不开页面。帧通道不可用、页面打不开、seek 失败或超时都抛出，由这一帧的渲染报告。
   */
  async picture(reference: CodeWebReference, time: number, frame: object, copy: VideoEditWebFrameCopy, trust: readonly ContentTrustReference[]): Promise<VideoEditWebPicture> {
    if (this.disposed) throw new DOMException('剪辑渲染已关闭。', 'AbortError')
    const channel = channelOf()
    if (!channel) throw new Error('网页画面需要显卡帧通道，当前渲染会话没有接入。')
    await this.assertTrusted(trust)
    if (this.disposed) throw new DOMException('剪辑渲染已关闭。', 'AbortError')
    const view = codeWebView(reference)
    const session = this.session(channel, videoEditWebSourceKey(reference), reference.path, view)
    session.busy++
    session.lastUsed = performance.now()
    const run = session.tail.catch(() => undefined).then(async () => {
      const info = session.info ?? await session.opening
      if (session.closed) throw new DOMException('网页来源已关闭。', 'AbortError')
      const ticket = `web-${this.nextTicket++}`
      const arrived = new Promise<NativeVideoFrame>((resolve, reject) => { session.waiting.set(ticket, { resolve, reject }) })
      void arrived.catch(() => undefined)
      let result
      try {
        result = await channel.call('captureWeb', { streamId: info.streamId, time, ticket, ...(reference.boxes ? { boxes: reference.boxes } : {}) })
      } catch (error) {
        session.waiting.delete(ticket)
        throw error
      }
      // 帧在回执之前经同一端口到达；仍按票据对上，不依赖次序。
      const borrowed = await arrived
      if (session.frame !== frame) { session.frame = frame; session.free.push(...session.used.splice(0)) }
      const target = session.free.pop()
      let copied
      try { copied = await copy(borrowed, info.pixelWidth, info.pixelHeight, target) } catch (error) { if (target) session.free.push(target); throw error }
      session.used.push(copied.texture)
      return new VideoEditWebPicture(copied.texture, info.pixelWidth, info.pixelHeight, copied.owner, { time, width: view.width, height: view.height, region: [...view.region], scale: view.scale, duration: result.duration, boxes: result.boxes ?? {} })
    }).finally(() => { session.busy--; session.lastUsed = performance.now() })
    session.tail = run
    return run
  }

  private async assertTrusted(trust: readonly ContentTrustReference[]): Promise<void> {
    if (!trust.length) return
    const key = JSON.stringify(trust.map(reference => reference.id).sort())
    if (this.trusted.has(key)) return
    await assertAuthorTrust({ context: [...trust] })
    this.trusted.add(key)
  }

  private session(channel: VideoEditNativeFrameReceiver, key: string, path: string, view: CodeWebView): WebSession {
    const existing = this.sessions.get(key)
    if (existing) { this.sessions.delete(key); this.sessions.set(key, existing); return existing }
    const opening = channel.call('openWeb', { path, width: view.width, height: view.height, region: view.region, scale: view.scale })
    const session: WebSession = { key, opening, tail: Promise.resolve(), busy: 0, used: [], free: [], lastUsed: performance.now(), waiting: new Map(), closed: false }
    void opening.then(info => {
      session.info = info
      if (session.closed) { void channel.call('closeWeb', { streamId: info.streamId }).catch(() => undefined); return }
      session.unsubscribe = channel.subscribe(info.streamId, frame => {
        const ticket = frame.meta.request?.id
        const waiter = ticket ? session.waiting.get(ticket) : undefined
        if (!waiter) { frame.release(); return }
        session.waiting.delete(ticket!)
        waiter.resolve(frame)
      })
    }, () => {
      // 打不开（文件夹不在、页面没实现约定）：下一帧重新尝试，不让失败的会话占着位置。
      session.closed = true
      if (this.sessions.get(key) === session) this.sessions.delete(key)
    })
    this.sessions.set(key, session)
    return session
  }

  /**
   * 关掉闲置太久、或超出上限时最久没用的页面。只由渲染器树的根在一帧结束后调用：树上任何一处这一帧在用、
   * 正在取帧或刚用过的都不关。
   */
  trim(): void {
    const now = performance.now()
    const live = [...this.sessions.values()]
    let excess = live.length - WEB_SESSION_LIMIT
    for (const session of live) {
      if (session.busy || now - session.lastUsed < WEB_SESSION_RECENT_MS) continue
      if (excess > 0 || now - session.lastUsed > WEB_SESSION_IDLE_MS) { this.close(session); excess-- }
    }
  }

  private close(session: WebSession): void {
    if (session.closed && !this.sessions.has(session.key)) return
    session.closed = true
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
    session.unsubscribe?.()
    // 还在等帧的取帧不会再等到了：让它们失败，这一帧按失败报告而不是一直挂着。
    for (const waiter of session.waiting.values()) waiter.reject(new DOMException('网页来源已关闭。', 'AbortError'))
    session.waiting.clear()
    const channel = channelOf()
    void session.tail.catch(() => undefined).then(() => {
      // 关掉的会话不在进行中的帧里（见 trim），它的纹理只被更早、已提交的帧读过。
      for (const texture of [...session.used.splice(0), ...session.free.splice(0)]) texture.destroy()
      if (session.info) void channel?.call('closeWeb', { streamId: session.info.streamId }).catch(() => undefined)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const session of [...this.sessions.values()]) this.close(session)
  }
}
