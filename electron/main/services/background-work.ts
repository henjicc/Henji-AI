/** 只用到页面后台节流开关的那部分 WebContents，便于测试替身。 */
export interface ThrottledContents {
  getBackgroundThrottling(): boolean
  setBackgroundThrottling(allowed: boolean): void
  isDestroyed(): boolean
}

const holds = new WeakMap<ThrottledContents, { count: number; original: boolean }>()

/**
 * 窗口最小化或被完全遮住时，Chromium 把页面定时器节流到一秒以上（隐藏 5 分钟后链式定时器约一分钟一次），逐帧推进的工作停摆。
 * 窗口隐藏时仍要继续出帧的工作（剪辑浮窗、自动预渲染）各持一份；同一页面的持有者都放开后才恢复原来的节流设置，
 * 互不覆盖对方的放开。与 Electron 剪辑浮窗、离屏页面一样走 setBackgroundThrottling，不把调度搬进 Worker。
 */
export function holdBackgroundWork(contents: ThrottledContents): () => void {
  let state = holds.get(contents)
  if (!state) { state = { count: 0, original: contents.getBackgroundThrottling() }; holds.set(contents, state) }
  if (state.count++ === 0) contents.setBackgroundThrottling(false)
  let released = false
  return () => {
    if (released) return
    released = true
    const current = holds.get(contents)
    if (!current || --current.count > 0) return
    holds.delete(contents)
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(current.original)
  }
}
