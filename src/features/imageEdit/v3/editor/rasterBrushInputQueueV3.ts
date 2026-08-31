import type { ImageEditBrushPointV3 } from '@/core/imageEdit/v3/brush/contracts'

type RasterBrushPointConsumerV3 = (points: readonly ImageEditBrushPointV3[]) => Promise<void>

/**
 * pointermove 不等待瓦片读取：当前批次执行期间到达的 coalesced samples 会合并为下一批，
 * 从而避免并发修改同一 Float32 工作瓦片。
 */
export class ImageEditorRasterBrushInputQueueV3 {
  private pending: ImageEditBrushPointV3[] = []
  private draining: Promise<void> | null = null
  private failure: unknown = null
  private stopped = false

  constructor(private readonly consume: RasterBrushPointConsumerV3) {}

  enqueue(points: readonly ImageEditBrushPointV3[]): void {
    if (this.stopped || points.length === 0) return
    this.pending.push(...points)
    if (!this.draining) this.draining = this.drain()
  }

  async flush(): Promise<void> {
    while (this.draining) await this.draining
    if (this.failure) throw this.failure
  }

  stop(): void {
    this.stopped = true
    this.pending = []
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopped && this.pending.length > 0) {
        const points = this.pending
        this.pending = []
        await this.consume(points)
      }
    } catch (error) {
      this.failure = error
      this.stopped = true
      this.pending = []
    } finally {
      this.draining = null
      if (!this.stopped && this.pending.length > 0) this.draining = this.drain()
    }
  }
}
