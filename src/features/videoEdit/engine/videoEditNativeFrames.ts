import type { VideoFrameMeta, VideoFramePortCall, VideoFramePortEndedMessage, VideoFrameStreamEndedPayload, VideoFramePortCallResults, VideoFramePortFrameMessage, VideoFramePortReleaseMessage, VideoFramePortRequestMessage, VideoFramePortResponseMessage, VideoFramePortScheduleMessage, VideoFrameScheduleEvent } from '@/platform/contracts/videoFrames'

/** 只需要设备队列的“已提交工作完成”通知。 */
export interface NativeFrameReleaseDevice {
  queue: { onSubmittedWorkDone(): Promise<void> }
}

/**
 * 剪辑渲染 Worker 的原生帧接收端：从 preload 交来的 MessagePort 接收显卡共享纹理 VideoFrame。
 *
 * 帧只能借用：用完调用 `release()` 把帧交回 preload，由渲染进程主线程关闭。**禁止在 Worker 里
 * `frame.close()` 或丢弃不还**——Worker 线程上释放共享纹理帧会让整个渲染进程崩溃（Electron 释放回调
 * 的线程检查），丢弃不还则原生纹理池槽位永远收不回。`release()` 默认推迟到下一个任务再交回，
 * 保证本任务里 `importExternalTexture` 得到的外部纹理已过期、不会在主线程关闭后才由 Worker 放掉最后一个引用；
 * 传入 GPU 设备时等该设备已提交的工作完成后再交回。
 */
export interface NativeVideoFrame {
  readonly frame: VideoFrame
  readonly meta: VideoFrameMeta
  /** 到达 Worker 的时刻（performance.now）。 */
  readonly receivedAt: number
  release(device?: NativeFrameReleaseDevice): void
}

export interface NativeFrameReceiverStats {
  received: number
  released: number
  /** 没有订阅者、到达即交回的帧。 */
  unclaimed: number
  outstanding: number
}

type FrameHandler = (frame: NativeVideoFrame) => void
type ScheduleHandler = (event: VideoFrameScheduleEvent) => void
type PortMessage = VideoFramePortFrameMessage | VideoFramePortScheduleMessage | VideoFramePortResponseMessage | VideoFramePortEndedMessage
type EndedHandler = (payload: VideoFrameStreamEndedPayload) => void
/** 一次端口请求的参数（按方法区分）。 */
export type NativeFrameCallParams<M extends VideoFramePortCall['method']> = Extract<VideoFramePortCall, { method: M }>['params']

export class VideoEditNativeFrameReceiver {
  private readonly handlers = new Map<string, FrameHandler>()
  private readonly scheduleHandlers = new Map<string, ScheduleHandler>()
  private readonly endedHandlers = new Map<string, EndedHandler>()
  private readonly outstanding = new Set<NativeVideoFrame>()
  private readonly counters = { received: 0, released: 0, unclaimed: 0 }
  /** 已决定交回、尚未发出的帧（等 GPU 工作完成或下一个任务）。 */
  private readonly sending = new Set<Promise<void>>()
  private readonly calls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private nextCall = 0
  private disposed = false
  private closed?: Promise<void>

  constructor(private readonly port: MessagePort, private readonly now: () => number = () => performance.now()) {
    port.onmessage = (event: MessageEvent<PortMessage>) => {
      const message = event.data
      if (message?.type === 'schedule') this.scheduleHandlers.get(message.event.streamId)?.(message.event)
      else if (message?.type === 'response') this.answer(message)
      else if (message?.type === 'ended') this.endedHandlers.get(message.payload.streamId)?.(message.payload)
      else this.receive(message)
    }
    port.start?.()
  }

  /**
   * 经同一端口请求解码会话操作（preload 转为 IPC，不经页面主线程）。打开的会话归属本通道；
   * 失败原因是主进程或原生服务的说明，调用方负责转为用户语言。
   */
  call<M extends VideoFramePortCall['method']>(method: M, params: NativeFrameCallParams<M>): Promise<VideoFramePortCallResults[M]> {
    if (this.disposed) return Promise.reject(new Error('原生帧通道已关闭。'))
    const id = ++this.nextCall
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const request: VideoFramePortRequestMessage = { type: 'request', id, call: { method, params } as VideoFramePortCall }
      try { this.port.postMessage(request, []) } catch (error) { this.calls.delete(id); reject(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  private answer(message: VideoFramePortResponseMessage): void {
    const call = this.calls.get(message.id)
    if (!call) return
    this.calls.delete(message.id)
    if (message.error !== undefined) call.reject(new Error(message.error))
    else call.resolve(message.result)
  }

  /** 订阅某条帧流；同一流只保留一个订阅者。返回取消订阅函数。 */
  subscribe(streamId: string, handler: FrameHandler): () => void {
    this.handlers.set(streamId, handler)
    return () => {
      if (this.handlers.get(streamId) === handler) this.handlers.delete(streamId)
    }
  }

  /** 订阅解码会话的计划事件（缺帧、计划结束）。帧与这些事件经不同通道到达，消费方按 index 对齐。 */
  subscribeSchedule(streamId: string, handler: ScheduleHandler): () => void {
    this.scheduleHandlers.set(streamId, handler)
    return () => {
      if (this.scheduleHandlers.get(streamId) === handler) this.scheduleHandlers.delete(streamId)
    }
  }

  /** 订阅流结束（原生出错、服务退出）：之后不会再有该流的帧与计划事件。 */
  subscribeEnded(streamId: string, handler: EndedHandler): () => void {
    this.endedHandlers.set(streamId, handler)
    return () => {
      if (this.endedHandlers.get(streamId) === handler) this.endedHandlers.delete(streamId)
    }
  }

  stats(): NativeFrameReceiverStats {
    return { ...this.counters, outstanding: this.outstanding.size }
  }

  /**
   * 交回所有未归还的帧并关闭端口。返回的 Promise 在交回消息全部发出、端口关闭后完成：
   * Worker 要等它完成才能被终止，否则在途帧会泄漏到页面卸载（记录 002）。
   */
  dispose(): Promise<void> {
    if (this.closed) return this.closed
    this.disposed = true
    this.handlers.clear()
    this.scheduleHandlers.clear()
    this.endedHandlers.clear()
    for (const call of this.calls.values()) call.reject(new Error('原生帧通道已关闭。'))
    this.calls.clear()
    for (const frame of [...this.outstanding]) frame.release()
    this.closed = (async () => {
      // 等推迟的交回消息发出后再关闭端口；GPU 工作迟迟不完成时最多等 2 秒。
      await Promise.race([Promise.allSettled([...this.sending]), new Promise(resolve => setTimeout(resolve, 2000))])
      await new Promise(resolve => setTimeout(resolve, 0))
      this.port.onmessage = null
      this.port.close()
    })()
    return this.closed
  }

  private receive(message: VideoFramePortFrameMessage): void {
    if (message?.type !== 'frame' || !message.frame) return
    this.counters.received += 1
    let returned = false
    const native: NativeVideoFrame = {
      frame: message.frame,
      meta: message.meta,
      receivedAt: this.now(),
      release: (device) => {
        if (returned) return
        returned = true
        this.outstanding.delete(native)
        this.counters.released += 1
        const send = (): void => {
          const reply: VideoFramePortReleaseMessage = { type: 'release', frame: message.frame, token: message.token }
          try { this.port.postMessage(reply, [message.frame]) } catch { /* 端口已关闭：帧随页面卸载回收（记录 002 已知限制） */ }
        }
        const sent: Promise<void> = (device ? device.queue.onSubmittedWorkDone() : new Promise<void>(resolve => setTimeout(resolve, 0))).then(send, send).finally(() => this.sending.delete(sent))
        this.sending.add(sent)
      },
    }
    this.outstanding.add(native)
    const handler = this.disposed ? undefined : this.handlers.get(message.meta.streamId)
    if (!handler) {
      this.counters.unclaimed += 1
      native.release()
      return
    }
    try {
      handler(native)
    } catch (error) {
      native.release()
      throw error
    }
  }
}
