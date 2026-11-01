import { webcrypto } from 'node:crypto'
import type { CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { webTimeAtFrame, type WebTimeGrid } from '../../../../src/core/videoEdit/webTimeCache'
import { GpuFrameCapture } from '../web-replay/player/gpuCapture'
import type { VideoFrameTarget } from '../video-decoder/texture-bridge'
import { WebSourcePage, type ReliableWebSourceFrame } from './page'
import type { WebCacheSubmissions } from './submissions'

/** 一个槽拥有一个页面和读回器；顺序模式保留同一页面，回退重建后从零向前重演。 */
export class WebCacheRecordingSlot {
  private readonly reader = new GpuFrameCapture(0, 'yuv444p')
  private page?: WebSourcePage
  private nextFrame: number

  constructor(private readonly source: WebSourcePage, private readonly view: CodeWebView,
    private readonly grid: WebTimeGrid, private readonly contentHash: string,
    private readonly submissions: WebCacheSubmissions, firstFrame: number) { this.nextFrame = firstFrame }

  get next(): number { return this.nextFrame }

  async capture(frame: number, selectors: readonly string[], signal: AbortSignal): Promise<ReliableWebSourceFrame> {
    if (frame < this.nextFrame) throw new Error('网页补录槽不能向后取帧')
    if (!this.page) {
      await this.submissions.run(() => this.reader.open(), signal)
      const contents = this.reader.targetContents
      const target: VideoFrameTarget = { id: contents.id, get mainFrame() { return contents.mainFrame }, isDestroyed: () => contents.isDestroyed(), send: () => undefined, onGone: () => () => undefined }
      // 分区按原来源路径决定，不能把realpath后的批次根当成新的存储身份。
      this.page = new WebSourcePage(`cache-${this.source.streamId}-${contents.id}`, target, 'web-cache-recording', this.source.folder,
        this.view, this.contentHash, () => undefined, () => undefined, this.submissions)
      await this.page.open(signal)
    }
    for (;;) {
      const index = this.nextFrame
      const captured = await this.page.captureReliable(webTimeAtFrame(this.grid, index), String(index), this.reader, index === frame ? selectors : [], signal)
      this.nextFrame++
      if (index === frame) return captured
    }
  }

  async close(): Promise<void> { this.page?.close(); this.page = undefined; await this.reader.dispose() }
}

export class WebCacheOverlapMismatch extends Error {
  constructor(readonly frame: number) { super(`网页相邻录制槽在帧 ${frame} 的交叠画面不一致`) }
}

/** 摘要在原生异步密码任务执行；只保留摘要和生命周期校验，不把整幅画面留到发布。 */
export async function webCacheFrameEvidence(frame: ReliableWebSourceFrame): Promise<{ fingerprint: string; isCurrent: () => boolean; validate: () => Promise<boolean> }> {
  const digest = await webcrypto.subtle.digest('SHA-256', frame.frame.bitmap())
  if (!frame.isCurrent()) throw new Error('网页交叠快照已失效')
  return { fingerprint: `${frame.time}:${frame.frame.width}:${frame.frame.height}:${Buffer.from(digest).toString('hex')}`, isCurrent: frame.isCurrent, validate: frame.validate }
}

/** 所有槽到达才允许提交；上层取消整组信号会唤醒已到达的槽。 */
export class WebCacheOverlap {
  private readonly samples = new Map<number, { first: string; next?: string; check(): Promise<boolean> }>()
  private resolve!: () => void
  private reject!: (error: unknown) => void
  private readonly ready = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  private readonly abort: () => void

  constructor(private readonly indices: readonly number[], private readonly boundary: (index: number) => number, private readonly signal: AbortSignal) {
    this.abort = () => this.reject(signal.reason)
    signal.addEventListener('abort', this.abort, { once: true })
    void this.ready.catch(() => undefined)
    if (signal.aborted) this.abort()
  }

  async arrive(index: number, sample: { first: string; next?: string; check(): Promise<boolean> }): Promise<void> {
    this.signal.throwIfAborted()
    this.samples.set(index, sample)
    if (this.samples.size === this.indices.length) {
      try {
        for (let i = 1; i < this.indices.length; i++) {
          const previous = this.samples.get(this.indices[i - 1])!, current = this.samples.get(this.indices[i])!
          if (previous.next !== current.first) throw new WebCacheOverlapMismatch(this.boundary(this.indices[i]))
        }
        for (const entry of this.samples.values()) if (!await entry.check()) throw new Error('网页交叠快照发布资格已失效')
        this.signal.throwIfAborted()
        this.resolve()
      } catch (error) { this.reject(error) }
    }
    await this.ready
  }

  close(): void { this.signal.removeEventListener('abort', this.abort) }
}
