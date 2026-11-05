import type { GpuBuffer, GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditGpuDeviceLostError, VideoEditGpuFrameError } from './videoEditGpuFailure'

interface FenceBuffer extends GpuBuffer { mapAsync(mode: number): Promise<void>; unmap(): void }
interface FenceEncoder { clearBuffer(buffer: unknown, offset?: number, size?: number): void }
const GPU_MAP_READ = 1, GPU_COPY_DST = 8, FENCE_BYTES = 4, MAX_IDLE = 4
/**
 * 映射失败后等 `device.lost` 的上界。规范没有规定映射失败与 `device.lost` 谁先到，也不保证失败一定来自设备丢失，
 * 所以不能无限等；中止类失败多半是设备丢失，多等一会儿，其余失败只是确认一下。
 */
const ABORTED_LOSS_WAIT_MS = 2000, FAILED_LOSS_WAIT_MS = 100

export interface VideoEditGpuFrameFence {
  /** 提交后等待：这一帧的 GPU 工作做完时 resolve；设备丢失时当帧就拒绝。 */
  wait(): Promise<void>
  /** 没有提交（编码中途抛错）：不再等待。 */
  abandon(): void
}

/**
 * 帧完成的栅栏。设备丢失时 `onSubmittedWorkDone` 照样 resolve、错误作用域弹出 `null`，它们都分不出这一帧是否真的做完；
 * 映射编进这一帧提交的小缓冲则会失败，判定不依赖 `device.lost` 回调先到。
 * 必须编进这一帧最后一次提交：没用过的缓冲做映射可能不等队列就直接完成。
 */
export class VideoEditGpuFrameFences {
  private readonly idle: FenceBuffer[] = []
  private closed = false
  constructor(private readonly device: GpuDevice, private readonly onLost: (reason: string) => void) {}
  arm(encoder: unknown): VideoEditGpuFrameFence {
    const buffer = this.idle.pop() ?? this.device.createBuffer({ size: FENCE_BYTES, usage: GPU_MAP_READ | GPU_COPY_DST }) as FenceBuffer
    ;(encoder as FenceEncoder).clearBuffer(buffer, 0, FENCE_BYTES)
    return { wait: () => this.wait(buffer), abandon: () => { buffer.destroy() } }
  }
  private async wait(buffer: FenceBuffer): Promise<void> {
    try { await buffer.mapAsync(GPU_MAP_READ) }
    catch (error) {
      buffer.destroy()
      throw await this.failure(error)
    }
    buffer.unmap()
    if (this.closed || this.idle.length >= MAX_IDLE) buffer.destroy()
    else this.idle.push(buffer)
  }
  private async failure(error: unknown): Promise<Error> {
    const closed = (): DOMException => new DOMException('剪辑渲染已关闭。', 'AbortError')
    // 自己关闭时取消挂起的映射也是中止，不是设备丢失。
    if (this.closed) return closed()
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = (error as { name?: unknown } | null)?.name === 'AbortError' ? ABORTED_LOSS_WAIT_MS : FAILED_LOSS_WAIT_MS
    const lost = await Promise.race([this.device.lost, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), wait) })])
    clearTimeout(timer)
    if (this.closed) return closed()
    const message = error instanceof Error ? error.message : String(error)
    if (!lost) return new VideoEditGpuFrameError('composite', [message])
    if (lost.reason === 'destroyed') return closed()
    const reason = lost.message || lost.reason || message
    this.onLost(reason)
    return new VideoEditGpuDeviceLostError(reason)
  }
  dispose(): void {
    this.closed = true
    for (const buffer of this.idle) buffer.destroy()
    this.idle.length = 0
  }
}
