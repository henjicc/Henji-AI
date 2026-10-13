export type RafOwner = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>

export interface RafScheduler<Args extends unknown[]> {
  schedule: (...args: Args) => void
  cancel: () => void
  /** 结束手势时立即提交最后一个样本。 */
  flush: () => void
  readonly pending: boolean
}

/** 合并最新样本；申请和取消始终使用同一个宿主。持续循环由调用方显式再次 schedule。 */
export function createRafScheduler<Args extends unknown[]>(callback: (...args: Args) => void, owner: RafOwner = window): RafScheduler<Args> {
  let frame: number | null = null
  let latest: Args | null = null
  const run = (): void => {
    frame = null
    const args = latest
    latest = null
    if (args) callback(...args)
  }
  const cancel = (): void => {
    if (frame !== null) owner.cancelAnimationFrame(frame)
    frame = null
    latest = null
  }
  return {
    schedule: (...args) => {
      latest = args
      if (frame === null) frame = owner.requestAnimationFrame(run)
    },
    cancel,
    flush: () => {
      if (frame !== null) owner.cancelAnimationFrame(frame)
      run()
    },
    get pending() { return frame !== null },
  }
}
