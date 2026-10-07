import { randomUUID } from 'node:crypto'
import { assertTrackingFrames, trackingFrameBatchCount, TRACKING_FRAME_MAX_PENDING, type TrackingFrameReply, type TrackingFrameRequest } from '../../../../../src/platform/contracts/tracking'

/** utility 端按需拉有界批次；不在主进程累积整段视频，也不改原跟踪算法。 */
export class RenderedTrackingFrames {
  private readonly pending = new Map<string, { jobId: string; finish(reply?: TrackingFrameReply, error?: Error): void }>()
  constructor(private readonly post: (jobId: string, requestId: string, request: TrackingFrameRequest) => void, private readonly timeoutMs = 35_000) {}

  reply(jobId: string, reply: TrackingFrameReply): void {
    const entry = this.pending.get(reply.id)
    if (entry?.jobId === jobId) entry.finish(reply)
  }
  private request(jobId: string, request: TrackingFrameRequest, signal: AbortSignal): Promise<Uint8Array[]> {
    signal.throwIfAborted()
    if (this.pending.size >= TRACKING_FRAME_MAX_PENDING) return Promise.reject(new Error('嵌套取帧请求过多。'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const abort = (): void => finish(undefined, new Error('嵌套取帧已取消。'))
      const timer = setTimeout(() => finish(undefined, new Error('嵌套取帧超时。')), this.timeoutMs)
      const finish = (reply?: TrackingFrameReply, error?: Error): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        try {
          if (error || reply?.error) throw error ?? new Error(reply!.error)
          assertTrackingFrames(request, reply!.frames); resolve(reply!.frames)
        } catch (failure) { reject(failure) }
      }
      this.pending.set(id, { jobId, finish }); signal.addEventListener('abort', abort, { once: true })
      try { this.post(jobId, id, request) } catch (error) { finish(undefined, error instanceof Error ? error : new Error('嵌套取帧发送失败。')) }
    })
  }
  async *frames(jobId: string, request: TrackingFrameRequest, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const max = trackingFrameBatchCount(request.width, request.height)
    for (let offset = 0; offset < request.count; offset += max) {
      const batch = { ...request, first: request.first + offset, count: Math.min(max, request.count - offset) }
      const frames = await this.request(jobId, batch, signal)
      for (const frame of frames) { signal.throwIfAborted(); yield frame }
    }
  }
}
