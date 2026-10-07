/**
 * 播放时钟与显示器刷新对齐。
 *
 * 渲染 Worker 用 requestAnimationFrame 等到每帧的呈现时刻（`videoEditGpuCompositor.draw` 的 deadline）。时钟起点若恰好落在
 * 某次刷新附近，刷新时刻与呈现时刻的先后会随两者的微小频差来回翻转：一帧晚一个刷新、下一帧紧跟着补上，画面成对出现、
 * 看起来一顿一顿的。把起点挪到两次刷新正中间，每帧离两侧刷新都有半个周期的余量。
 */

/** 下一次刷新的时间戳（`performance.now()` 时基）；窗口不在前台、浏览器不发刷新时等到上限就返回 undefined。 */
export function nextVideoEditDisplayFrame(timeoutMs = 50): Promise<number | undefined> {
  return new Promise(resolve => {
    let request = 0
    const timer = setTimeout(() => { cancelAnimationFrame(request); resolve(undefined) }, timeoutMs)
    request = requestAnimationFrame(at => { clearTimeout(timer); resolve(at) })
  })
}

/** 用若干次连续刷新估计刷新周期（毫秒，取间隔的中位数）；拿不到稳定的刷新时返回 undefined。 */
export async function measureVideoEditDisplayPeriod(samples = 6): Promise<number | undefined> {
  const stamps: number[] = []
  for (let index = 0; index <= samples; index++) {
    const at = await nextVideoEditDisplayFrame()
    if (at === undefined) return undefined
    stamps.push(at)
  }
  const gaps = stamps.slice(1).map((at, index) => at - stamps[index]).sort((a, b) => a - b)
  const period = gaps[Math.floor(gaps.length / 2)]
  // 4–50ms 之外（240Hz 以上或掉到 20Hz 以下）多半是窗口被节流，不据此对齐。
  return period >= 4 && period <= 50 ? period : undefined
}

/** 不早于 `target` 的、位于两次刷新正中间的时刻；`vsync` 是任一次刷新的时间戳。 */
export function alignVideoEditClockToDisplay(target: number, vsync: number, period: number): number {
  const phase = (((target - vsync) % period) + period) % period
  return target + (((period / 2 - phase) % period) + period) % period
}
