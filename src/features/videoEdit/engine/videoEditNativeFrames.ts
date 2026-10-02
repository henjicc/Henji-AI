import type { VideoFrameMeta, VideoFramePortFrameMessage, VideoFramePortReleaseMessage, VideoFramePortScheduleMessage, VideoFrameScheduleEvent } from '@/platform/contracts/videoFrames'

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

export class VideoEditNativeFrameReceiver {
  private readonly handlers = new Map<string, FrameHandler>()
  private readonly scheduleHandlers = new Map<string, ScheduleHandler>()
  private readonly outstanding = new Set<NativeVideoFrame>()
  private readonly counters = { received: 0, released: 0, unclaimed: 0 }
  private disposed = false

  constructor(private readonly port: MessagePort, private readonly now: () => number = () => performance.now()) {
    port.onmessage = (event: MessageEvent<VideoFramePortFrameMessage | VideoFramePortScheduleMessage>) => {
      if (event.data?.type === 'schedule') this.scheduleHandlers.get(event.data.event.streamId)?.(event.data.event)
      else this.receive(event.data)
    }
    port.start?.()
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

  stats(): NativeFrameReceiverStats {
    return { ...this.counters, outstanding: this.outstanding.size }
  }

  /** 交回所有未归还的帧并关闭端口。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.handlers.clear()
    this.scheduleHandlers.clear()
    for (const frame of [...this.outstanding]) frame.release()
    this.port.onmessage = null
    // 等推迟的交回消息发出后再关闭端口。
    setTimeout(() => this.port.close(), 0)
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
          this.port.postMessage(reply, [message.frame])
        }
        if (device) void device.queue.onSubmittedWorkDone().then(send, send)
        else setTimeout(send, 0)
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
