import { randomUUID } from 'node:crypto'
import { assertTrackingFrameRequest, assertTrackingFrames, TRACKING_FRAME_MAX_PENDING, type TrackingFrameEvent, type TrackingFrameProvider, type TrackingFrameReply, type TrackingFrameRequest, type TrackingSequenceSource } from '../../../../src/platform/contracts/tracking'

export interface TrackingFrameSender {
  id: number
  send(event: TrackingFrameEvent): void
  onClosed(listener: () => void): () => void
}
interface Lease { sender: TrackingFrameSender; release(): void }
interface Pending { senderId: number; request: TrackingFrameRequest; jobId: string; finish(frames?: Uint8Array[], error?: Error): void }

/** 仅转发像素，不渲染或解码；回复只接受原发起窗口，停止/退出拒绝旧批次。 */
export class TrackingFrameBroker {
  private readonly leases = new Map<string, Lease>()
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly timeoutMs = 30_000) {}

  provider(source: TrackingSequenceSource, sender: TrackingFrameSender): TrackingFrameProvider {
    return async (jobId, request, signal) => {
      signal.throwIfAborted(); assertTrackingFrameRequest(request)
      if (!this.leases.has(jobId)) {
        if (this.leases.size >= TRACKING_FRAME_MAX_PENDING) throw new Error('嵌套取帧任务过多。')
        let off = (): void => undefined
        const release = (): void => {
          if (!this.leases.delete(jobId)) return
          off(); signal.removeEventListener('abort', release)
          for (const entry of this.pending.values()) if (entry.jobId === jobId) entry.finish(undefined, new Error('嵌套取帧已结束。'))
          sender.send({ kind: 'release', jobId })
        }
        this.leases.set(jobId, { sender, release })
        off = sender.onClosed(release)
        signal.addEventListener('abort', release, { once: true })
      }
      if (this.leases.get(jobId)?.sender.id !== sender.id || this.pending.size >= TRACKING_FRAME_MAX_PENDING) throw new Error('嵌套帧来源不匹配或请求过多。')
      const id = randomUUID()
      return new Promise<Uint8Array[]>((resolve, reject) => {
        const timer = setTimeout(() => this.leases.get(jobId)?.release(), this.timeoutMs)
        const finish = (frames?: Uint8Array[], error?: Error): void => {
          if (!this.pending.delete(id)) return
          clearTimeout(timer)
          if (error) reject(error); else resolve(frames!)
        }
        this.pending.set(id, { senderId: sender.id, jobId, request, finish })
        try { sender.send({ kind: 'frames', id, jobId, source, request }) }
        catch (error) { finish(undefined, error instanceof Error ? error : new Error('嵌套取帧窗口不可用。')); this.leases.get(jobId)?.release() }
      })
    }
  }

  reply(senderId: number, reply: TrackingFrameReply): void {
    const pending = this.pending.get(reply.id)
    if (!pending) return // 停止/超时后的迟到回复不再属于任何任务。
    if (pending.senderId !== senderId) throw new Error('跟踪帧只能由发起窗口回复。')
    try {
      if (reply.error) throw new Error(reply.error)
      assertTrackingFrames(pending.request, reply.frames)
      pending.finish(reply.frames)
    } catch (error) { pending.finish(undefined, error instanceof Error ? error : new Error('跟踪帧无效。')) }
  }
}
