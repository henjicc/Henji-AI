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

/**
 * 正向播放下一张要画的帧：通常是紧接上一张提交的帧；画面跟不上时钟时直接跳到下一张还来得及按时呈现的帧（丢帧），
 * 不让时钟被渲染拖慢、画面与声音越拉越远。`due` 是此刻按时钟应当在屏上的帧。
 */
export function videoEditPlaybackTarget(next: number, due: number, start: number, duration: number): number {
  return Math.max(start, Math.min(duration - 1, Math.max(next, due + 1)))
}

/** 声音输出时间戳（AudioContext.getOutputTimestamp）的两个时基。 */
export interface VideoEditAudioStamp { contextTime?: number; performanceTime?: number }

/**
 * 声音为主时钟：按扬声器实际输出的时间戳，换算出起点帧在 performance.now() 时基下“被听到”的时刻（含输出延迟）。
 * `clockStart` 是起点帧声音在 AudioContext 时基下的排程时刻。声音尚未开始输出时返回 undefined。
 */
export function videoEditAudioClockOrigin(stamp: VideoEditAudioStamp, clockStart: number, now: number): number | undefined {
  if (!(stamp.contextTime! > 0) || !(stamp.performanceTime! > 0)) return undefined
  const heard = stamp.contextTime! + (now - stamp.performanceTime!) / 1000
  return now - (heard - clockStart) * 1000
}

/** 画面时钟跟随声音：偏差大（起播时的输出延迟、设备切换）直接对齐，小偏差每次修正一成，不让时间戳抖动传到画面。 */
export function followVideoEditAudioClock(current: number, origin: number): number {
  const error = origin - current
  return Math.abs(error) > 100 ? origin : current + error * 0.1
}

/** 示范中按现有播放时钟重画已到时刻，不把最新姿态排到下一张未来帧之后。 */
export function videoEditLiveFrame(start: number, elapsedMs: number, fps: number, rate: number, direction: 1 | -1, duration: number): number {
  const steps = Math.floor(Math.max(0, elapsedMs) * fps * rate / 1000)
  return Math.max(0, Math.min(duration - 1, start + direction * steps))
}
