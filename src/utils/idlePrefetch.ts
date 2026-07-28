type ModuleLoader = () => Promise<unknown>

interface IdleDeadlineLike {
  timeRemaining: () => number
}

type IdleCallbackHandle = number

interface IdleCapableWindow {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => IdleCallbackHandle
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void
}

function scheduleIdle(run: () => void): () => void {
  const idleWindow = window as unknown as IdleCapableWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(() => run(), { timeout: 2000 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const timer = window.setTimeout(run, 200)
  return () => window.clearTimeout(timer)
}

interface PrefetchOptions {
  /**
   * 开始预取前的等待时间。
   *
   * dev 下 Vite 是收到请求才逐个转译源码的，一次预取会往转译队列里压几百个模块；
   * 用户此时点 Tab，那个 Tab 自己的请求要排在队尾，反而更慢。所以开发态要把预取
   * 推迟到用户大概率已经完成首轮点击之后；生产态是现成的 chunk，没有这个问题。
   */
  startDelayMs?: number
}

/**
 * 空闲时按顺序预取懒加载模块。
 *
 * 一次只取一个、且每个都等到浏览器空闲再开始，避免和当前界面的首屏渲染抢主线程；
 * 取到的模块进入模块缓存，用户真正切过去时 `import()` 直接命中，不再有「切过去要转圈」。
 *
 * @returns 取消函数；调用后不再发起后续预取（已在途的那个不会中断）。
 */
export function prefetchWhenIdle(loaders: ModuleLoader[], options: PrefetchOptions = {}): () => void {
  let cancelled = false
  let cancelSchedule: (() => void) | null = null

  const runNext = (index: number): void => {
    if (cancelled || index >= loaders.length) return
    cancelSchedule = scheduleIdle(() => {
      if (cancelled) return
      void loaders[index]()
        .catch(() => undefined)
        .then(() => runNext(index + 1))
    })
  }

  const startDelayMs = options.startDelayMs ?? 0
  if (startDelayMs > 0) {
    const startTimer = window.setTimeout(() => runNext(0), startDelayMs)
    cancelSchedule = () => window.clearTimeout(startTimer)
  } else {
    runNext(0)
  }

  return () => {
    cancelled = true
    cancelSchedule?.()
  }
}
