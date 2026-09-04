/**
 * 每次稳定 GPU 帧之间最多发起一次自动恢复；恢复设备若在首帧前再次丢失，
 * 保持 CPU fallback，避免 Worker 内形成 acquire/lost 重试风暴。
 */
export class ImageEditorGpuSceneRecoveryV3 {
  private unvalidatedRecovery = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  schedule(delayMs: number, recover: () => void): boolean {
    if (this.disposed || this.unvalidatedRecovery || this.timer !== null) return false
    this.unvalidatedRecovery = true
    if (delayMs <= 0) {
      recover()
      return true
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.disposed) recover()
    }, delayMs)
    return true
  }

  validateFrame(): void {
    this.unvalidatedRecovery = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

export function imageEditorGpuSceneErrorMessageV3(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function waitForImageEditorGpuSceneTaskV3(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
