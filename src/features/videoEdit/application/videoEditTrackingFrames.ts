import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditTrackFps } from '@/core/videoEdit/tracking'
import { videoEditTrackingSequenceFrame } from '@/core/videoEdit/trackingSource'
import { assertTrackingFrameRequest, TRACKING_FRAME_MAX_PENDING, type TrackingFrameEvent, type TrackingFrameReply, type TrackingSequenceSource } from '@/platform/contracts/tracking'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'

const logger = createLogger('features.videoEdit.tracking')
interface Session { renderer: VideoEditRenderSession; source: TrackingSequenceSource; controller: AbortController; busy: boolean }
export class VideoEditTrackingFrames {
  private readonly sessions = new Map<string, Session>()
  constructor(private readonly resolve: (source: TrackingSequenceSource) => VideoEditComposition, private readonly reply: (reply: TrackingFrameReply) => Promise<void>, private readonly prepare: (renderer: VideoEditRenderSession, composition: VideoEditComposition) => void | Promise<void>) {}

  private release(jobId: string): void {
    const session = this.sessions.get(jobId)
    if (!session) return
    this.sessions.delete(jobId); session.controller.abort()
    logger.debug('嵌套跟踪取帧结束', { event: 'video_edit.tracking.frames.end' })
    void session.renderer.dispose().catch(error => logger.warn('嵌套跟踪取帧关闭失败', { event: 'video_edit.tracking.frames.dispose_failed', error }))
  }
  handle(event: TrackingFrameEvent): void {
    if (event.kind === 'release') { this.release(event.jobId); return }
    void this.render(event).catch(error => logger.warn('嵌套跟踪帧回复失败', { event: 'video_edit.tracking.frames.reply_failed', error }))
  }
  private async render(event: Extract<TrackingFrameEvent, { kind: 'frames' }>): Promise<void> {
    let session: Session | undefined
    let ownsFrameRequest = false
    try {
      assertTrackingFrameRequest(event.request)
      session = this.sessions.get(event.jobId)
      if (!session) {
        if (this.sessions.size >= TRACKING_FRAME_MAX_PENDING) throw new Error('嵌套跟踪取帧任务过多。')
        const composition = this.resolve(event.source)
        const renderer = new VideoEditRenderSession(composition, 1280, undefined, undefined, 64 * 1024 ** 2)
        session = { renderer, source: event.source, controller: new AbortController(), busy: true }; ownsFrameRequest = true
        this.sessions.set(event.jobId, session); await this.prepare(renderer, composition)
        logger.debug('嵌套跟踪取帧开始', { event: 'video_edit.tracking.frames.start', context: { width: composition.width, height: composition.height } })
      } else {
        if (session.busy || session.source.signature !== event.source.signature) throw new Error('嵌套跟踪帧来源改变或请求重叠。')
        session.busy = true; ownsFrameRequest = true
      }
      session.controller.signal.throwIfAborted()
      const { request } = event; const frames: Uint8Array[] = []
      const divisor = [1, 2, 4, 8].find(value => Math.max(event.source.width, event.source.height) / value <= Math.max(request.width, request.height)) ?? 8
      await session.renderer.setRenderDivisor(divisor)
      for (let index = 0; index < request.count; index++) {
        session.controller.signal.throwIfAborted()
        const frame = videoEditTrackingSequenceFrame(event.source, request.first + index, videoEditTrackFps(event.source.fps))
        const { rgb } = await session.renderer.present(frame, false, false, undefined, undefined, { width: request.width, height: request.height })
        session.controller.signal.throwIfAborted()
        if (!rgb || rgb.byteLength !== request.width * request.height * 3) throw new Error('嵌套序列没有返回跟踪画面。')
        frames.push(rgb)
      }
      if (!session.controller.signal.aborted) await this.reply({ id: event.id, frames })
    } catch (error) {
      if (!session?.controller.signal.aborted) {
        logger.warn('嵌套跟踪取帧失败', { event: 'video_edit.tracking.frames.failed', error })
        await this.reply({ id: event.id, frames: [], error: error instanceof Error ? error.message.slice(0, 300) : '嵌套画面读取失败。' })
      }
    } finally { if (session && ownsFrameRequest) session.busy = false }
  }
  dispose(): void { for (const jobId of this.sessions.keys()) this.release(jobId) }
}
