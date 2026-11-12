const FALLBACK_RETRY_BASE_MS = 10_000
const FALLBACK_RETRY_MAX_MS = 300_000
// 单帧失败只丢这一帧；连续 3 帧失败，或 2 秒内累计 3 次（异步错误夹在成功帧之间），才交给 CPU。
const FRAME_FAILURE_LIMIT = 3
const FRAME_FAILURE_WINDOW_MS = 2_000
// 退避只在 GPU 持续 10 秒、30 帧都没有新错误后才从头计：重试后头几帧成功不能算数，
// 否则持续出错时 GPU/CPU 每 10 秒来回切、后台反复重建上下文与重传瓦片。
const STABLE_RESET_MS = 10_000
const STABLE_RESET_FRAMES = 30

/**
 * GPU 预览的失败与恢复策略。
 * 设备丢失后的立即恢复：每次稳定 GPU 帧之间最多一次，恢复设备若在首帧前再次丢失就交给 CPU，
 * 避免 Worker 内形成 acquire/lost 重试风暴。
 * 交给 CPU 之后按退避定时重新尝试 GPU：10 秒起、每次翻倍、最长 5 分钟。
 */
export class ImageEditorGpuSceneRecoveryV3 {
  private unvalidatedRecovery = false
  private fallbackRetries = 0
  private consecutiveFailures = 0
  private recentFailures: number[] = []
  private stableSince: number | null = null
  private stableFrames = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  schedule(delayMs: number, recover: () => void): boolean {
    if (this.disposed || this.unvalidatedRecovery || this.timer !== null) return false
    this.unvalidatedRecovery = true
    if (delayMs <= 0) {
      recover()
      return true
    }
    this.start(delayMs, recover)
    return true
  }

  /** 返回这次排下的等待时间；已有计时在等时不重复排，返回 null。 */
  scheduleFallbackRetry(recover: () => void): number | null {
    if (this.disposed || this.timer !== null) return null
    const delayMs = Math.min(FALLBACK_RETRY_MAX_MS, FALLBACK_RETRY_BASE_MS * 2 ** this.fallbackRetries)
    this.fallbackRetries += 1
    this.stableSince = null
    this.start(delayMs, recover)
    return delayMs
  }

  /** 一帧成功呈现。 */
  recordFrame(now: number): void {
    this.unvalidatedRecovery = false
    this.consecutiveFailures = 0
    if (this.fallbackRetries === 0) return
    if (this.stableSince === null) {
      this.stableSince = now
      this.stableFrames = 0
    }
    this.stableFrames += 1
    if (now - this.stableSince >= STABLE_RESET_MS && this.stableFrames >= STABLE_RESET_FRAMES) {
      this.fallbackRetries = 0
      this.stableSince = null
    }
  }

  /** 一帧（或一批瓦片）失败并计数；返回是否该交给 CPU。 */
  recordFailure(now: number): boolean {
    this.noteError()
    this.consecutiveFailures += 1
    this.recentFailures = this.recentFailures.filter((time) => now - time < FRAME_FAILURE_WINDOW_MS)
    this.recentFailures.push(now)
    return this.consecutiveFailures >= FRAME_FAILURE_LIMIT || this.recentFailures.length >= FRAME_FAILURE_LIMIT
  }

  /** 出了错但不计数（例如只需重绘的异步错误）：仍打断“持续稳定”的计时。 */
  noteError(): void {
    this.stableSince = null
  }

  /** 换上新的合成状态（回退、恢复或重试成功）后，失败次数从头计；退避不受影响。 */
  resetFailures(): void {
    this.consecutiveFailures = 0
    this.recentFailures = []
  }

  /** 会话结束：上一个会话排下的恢复与重试、失败计数与退避都清掉。 */
  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.unvalidatedRecovery = false
    this.fallbackRetries = 0
    this.stableSince = null
    this.resetFailures()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.reset()
  }

  private start(delayMs: number, recover: () => void): void {
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.disposed) recover()
    }, delayMs)
  }
}

export function imageEditorGpuSceneErrorMessageV3(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type GpuOutOfMemoryErrorClass = abstract new (...args: never[]) => object

/**
 * 原生 GPUOutOfMemoryError，或被 vGPU、调用方包装后放在 cause 链里的同一对象。
 * 只认类型不认文案：各浏览器的错误文字不同，且会随版本变化。
 */
export function isImageEditorGpuOutOfMemoryError(error: unknown): boolean {
  const OutOfMemoryError = (globalThis as { GPUOutOfMemoryError?: GpuOutOfMemoryErrorClass }).GPUOutOfMemoryError
  if (typeof OutOfMemoryError !== 'function') return false
  let current = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    if (current instanceof OutOfMemoryError) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export function waitForImageEditorGpuSceneTaskV3(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
