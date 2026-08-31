export class ImageEditGpuRuntimeInvalidatedError extends Error {
  readonly code = 'webgpu-runtime-generation-stale'

  constructor() {
    super('WebGPU 运行时代际已失效')
    this.name = 'ImageEditGpuRuntimeInvalidatedError'
  }
}

/**
 * 管理可异步创建的单一运行时资源。
 *
 * invalidate 不会等待无法硬取消的初始化；它推进 epoch 并让新初始化立即开始。旧初始化
 * 即使稍后成功，也只能走 dispose，不能重新挂回 current。
 */
export class SingleflightRuntimeState<T> {
  private current: T | null = null
  private initialization: { epoch: number; promise: Promise<T> } | null = null
  private epoch = 0
  private destroyed = false

  constructor(private readonly disposeValue: (value: T) => void) {}

  acquire(factory: () => Promise<T>): Promise<T> {
    if (this.current) return Promise.resolve(this.current)
    if (this.destroyed) {
      return Promise.reject(new Error('WebGPU 运行时状态控制器已销毁'))
    }
    if (this.initialization) return this.initialization.promise
    const epoch = this.epoch
    const promise = factory().then((value) => {
      if (this.destroyed || this.epoch !== epoch) {
        this.disposeValue(value)
        throw new ImageEditGpuRuntimeInvalidatedError()
      }
      this.current = value
      return value
    }).finally(() => {
      if (this.initialization?.promise === promise) this.initialization = null
    })
    this.initialization = { epoch, promise }
    return promise
  }

  invalidate(): void {
    this.epoch += 1
    this.initialization = null
    const current = this.current
    this.current = null
    if (current) this.disposeValue(current)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.invalidate()
  }

  isCurrent(value: T): boolean {
    return !this.destroyed && this.current === value
  }

  peek(): T | null {
    return this.current
  }
}

/**
 * 同一设备代际只允许一个 GPU 操作编码/读回；新代际无需等待已丢失设备上的旧 Promise。
 */
export class DeviceGenerationSerialQueue {
  private readonly tails = new Map<number, Promise<void>>()
  private destroyed = false

  async run<T>(options: {
    generation: number
    isCurrent: () => boolean
    execute: () => Promise<T>
    disposeStale?: (value: T) => void
  }): Promise<T> {
    if (this.destroyed) throw new Error('WebGPU 设备执行队列已销毁')
    const previous = this.tails.get(options.generation) ?? Promise.resolve()
    const result = previous.then(
      () => this.executeCurrent(options),
      () => this.executeCurrent(options),
    )
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(options.generation, tail)
    void tail.finally(() => {
      if (this.tails.get(options.generation) === tail) {
        this.tails.delete(options.generation)
      }
    })
    return await result
  }

  destroy(): void {
    this.destroyed = true
    this.tails.clear()
  }

  private async executeCurrent<T>(options: {
    isCurrent: () => boolean
    execute: () => Promise<T>
    disposeStale?: (value: T) => void
  }): Promise<T> {
    if (this.destroyed || !options.isCurrent()) {
      throw new ImageEditGpuRuntimeInvalidatedError()
    }
    const value = await options.execute()
    if (this.destroyed || !options.isCurrent()) {
      options.disposeStale?.(value)
      throw new ImageEditGpuRuntimeInvalidatedError()
    }
    return value
  }
}
