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
    // 刻意不给 timeout：带 timeout 的空闲回调到点会强制插队，而那个点正好落在
    // 启动尾声的繁忙期，预取的编译会挡在用户第一次点击前面。宁可晚取，不可抢跑。
    const handle = idleWindow.requestIdleCallback(() => run())
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const timer = window.setTimeout(run, 1000)
  return () => window.clearTimeout(timer)
}

interface PrefetchOptions {
  /**
   * `'eager'`：立刻并行发起，用最短时间抹平「启动后马上点」的等待窗口。
   * `'idle'`：逐个等浏览器空闲再取，把带宽和主线程让给当前界面。
   */
  strategy?: 'eager' | 'idle'
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
 * 预取懒加载模块，让用户真正切过去时 `import()` 直接命中模块缓存。
 *
 * 预取只有「赶在用户点击之前完成」才有意义：等空闲、又逐个串行的话，主线程被启动
 * 初始化占着时预取会一直排不上号，用户开机就点仍然要看完整的加载动画。所以生产态用
 * `eager` 并行抢跑，开发态才退回 `idle`。
 *
 * @returns 取消函数；调用后不再发起后续预取（已在途的那个不会中断）。
 */
export function prefetchWhenIdle(loaders: ModuleLoader[], options: PrefetchOptions = {}): () => void {
  let cancelled = false
  let cancelSchedule: (() => void) | null = null

  const runAll = (): void => {
    if (cancelled) return
    if (options.strategy === 'eager') {
      loaders.forEach((load) => { void load().catch(() => undefined) })
      return
    }
    const runNext = (index: number): void => {
      if (cancelled || index >= loaders.length) return
      cancelSchedule = scheduleIdle(() => {
        if (cancelled) return
        void loaders[index]()
          .catch(() => undefined)
          .then(() => runNext(index + 1))
      })
    }
    runNext(0)
  }

  const startDelayMs = options.startDelayMs ?? 0
  if (startDelayMs > 0) {
    const startTimer = window.setTimeout(runAll, startDelayMs)
    cancelSchedule = () => window.clearTimeout(startTimer)
  } else {
    runAll()
  }

  return () => {
    cancelled = true
    cancelSchedule?.()
  }
}
