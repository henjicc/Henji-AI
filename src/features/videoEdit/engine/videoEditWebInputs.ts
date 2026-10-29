import type { CodeWebReference } from '@/core/imaging/parameterTypes'
import { codeWebView, type CodeWebView } from '@/core/videoEdit/codeMaterial/webSource'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { WebSourceInfo } from '@/platform/contracts/videoFrames'
import type { AuthorWebFrame } from './videoEditAuthorModule'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'

/** 网页画面：纹理之外带着这一刻的页面信息。离屏页面不透明。 */
export class VideoEditWebPicture extends VideoEditCodePicture {
  constructor(texture: GpuTexture, width: number, height: number, owner: GpuDevice, readonly web: AuthorWebFrame) { super(texture, width, height, owner, 'rgba8unorm', true) }
}

/** 把借来的帧拷进合成设备的纹理（给了 `target` 就原地覆盖），返回纹理与它所属的设备。 */
export type VideoEditWebFrameCopy = (frame: NativeVideoFrame, width: number, height: number, target?: GpuTexture) => Promise<{ texture: GpuTexture; owner: GpuDevice }>

/** 一个渲染器同时开着的网页页面数；超出时关掉最久没用的（每个页面是一个独立的渲染进程与一张大纹理）。 */
const WEB_SESSION_LIMIT = 4
/** 不再出现在画面里的页面留这么久，来回拖动、暂停再播放不必重新载入页面。 */
const WEB_SESSION_IDLE_MS = 60_000

interface WebSession {
  key: string
  opening: Promise<WebSourceInfo>
  info?: WebSourceInfo
  /** 取帧串行：页面同一时刻只能摆在一个时间上。 */
  tail: Promise<unknown>
  /** 这一帧（`frame` 标识）已用的纹理与可以覆盖的纹理：同一帧里同一来源的两个时刻各占一张，上一帧的到下一帧才能覆盖。 */
  frame?: object
  used: GpuTexture[]
  free: GpuTexture[]
  lastUsed: number
  waiting: Map<string, (frame: NativeVideoFrame) => void>
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
 * 渲染器的网页来源：按来源与取景开离屏页面（主进程），按页面时间取画面，拷进合成设备的纹理。画面不跨帧复用：
 * 页面时间变了要重新取，网页文件改动后主进程重新载入页面。
 */
export class VideoEditWebInputs {
  private readonly sessions = new Map<string, WebSession>()
  private nextTicket = 1
  private disposed = false

  /**
   * 第 `time` 秒的网页画面。`frame` 标识这一帧（同一帧的多次取帧各用一张纹理）。帧通道不可用、页面打不开、
   * seek 失败或超时都抛出，由这一帧的渲染报告。
   */
  picture(reference: CodeWebReference, time: number, frame: object, copy: VideoEditWebFrameCopy): Promise<VideoEditWebPicture> {
    if (this.disposed) return Promise.reject(new DOMException('剪辑渲染已关闭。', 'AbortError'))
    const channel = channelOf()
    if (!channel) return Promise.reject(new Error('网页画面需要显卡帧通道，当前渲染会话没有接入。'))
    const view = codeWebView(reference)
    const session = this.session(channel, videoEditWebSourceKey(reference), reference.path, view)
    const run = session.tail.catch(() => undefined).then(async () => {
      const info = session.info ?? await session.opening
      if (session.closed) throw new DOMException('网页来源已关闭。', 'AbortError')
      const ticket = `web-${this.nextTicket++}`
      const arrived = new Promise<NativeVideoFrame>(resolve => { session.waiting.set(ticket, resolve) })
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
      const { texture, owner } = copied
      session.used.push(texture)
      return new VideoEditWebPicture(texture, info.pixelWidth, info.pixelHeight, owner, { time, width: view.width, height: view.height, region: [...view.region], scale: view.scale, duration: info.duration, boxes: result.boxes ?? {} })
    })
    session.tail = run
    session.lastUsed = performance.now()
    return run
  }

  private session(channel: VideoEditNativeFrameReceiver, key: string, path: string, view: CodeWebView): WebSession {
    const existing = this.sessions.get(key)
    if (existing) { this.sessions.delete(key); this.sessions.set(key, existing); return existing }
    const opening = channel.call('openWeb', { path, width: view.width, height: view.height, region: view.region, scale: view.scale })
    const session: WebSession = { key, opening, tail: Promise.resolve(), used: [], free: [], lastUsed: performance.now(), waiting: new Map(), closed: false }
    void opening.then(info => {
      session.info = info
      if (session.closed) { void channel.call('closeWeb', { streamId: info.streamId }).catch(() => undefined); return }
      session.unsubscribe = channel.subscribe(info.streamId, frame => {
        const ticket = frame.meta.request?.id
        const resolve = ticket ? session.waiting.get(ticket) : undefined
        if (!resolve) { frame.release(); return }
        session.waiting.delete(ticket!)
        resolve(frame)
      })
    }, () => { if (this.sessions.get(key) === session) this.sessions.delete(key) })
    this.sessions.set(key, session)
    return session
  }

  /** 关掉闲置太久、或超出上限时最久没用的页面；`keep` 是这一帧要用的会话键。 */
  trim(keep: ReadonlySet<string>): void {
    const now = performance.now()
    const live = [...this.sessions.values()]
    const excess = live.length - WEB_SESSION_LIMIT
    live.forEach((session, index) => {
      if (!keep.has(session.key) && (index < excess || now - session.lastUsed > WEB_SESSION_IDLE_MS)) this.close(session)
    })
  }

  private close(session: WebSession): void {
    if (session.closed) return
    session.closed = true
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
    session.unsubscribe?.()
    const channel = channelOf()
    void session.tail.catch(() => undefined).then(() => {
      // 关掉的会话不在这一帧里（`trim` 留下了这一帧要用的），它的纹理只被更早、已提交的帧读过。
      for (const texture of [...session.used.splice(0), ...session.free.splice(0)]) texture.destroy()
      if (session.info) void channel?.call('closeWeb', { streamId: session.info.streamId }).catch(() => undefined)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const session of [...this.sessions.values()]) this.close(session)
  }
}
