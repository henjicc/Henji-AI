import { screen } from 'electron'
import type { CaptureSource } from '../../../../../src/core/screenRecording/contracts'
import type { ScreenCaptureOptions } from '../../../../../src/core/screenRecording/capture'
import type { CaptureGeometry, CaptureRect } from '../../../../../src/core/captureLog/coordinates'
import { createWindowsEventFacts } from '../windows-events'

/** Desktop rectangle (DIP) that is actually recorded: display or window bounds narrowed to the chosen region. */
export function createCaptureBounds(source: CaptureSource, options: ScreenCaptureOptions): () => CaptureRect | undefined {
  const facts = source.kind === 'window' ? createWindowsEventFacts() : undefined
  return () => {
    let bounds: CaptureRect | undefined
    if (source.kind === 'screen') bounds = screen.getAllDisplays().find(display => String(display.id) === source.displayId)?.bounds
    else {
      const physical = facts?.bounds?.(source.id.split(':')[1])
      if (physical) {
        const start = screen.screenToDipPoint(physical)
        const end = screen.screenToDipPoint({ x: physical.x + physical.width, y: physical.y + physical.height })
        bounds = { ...start, width: end.x - start.x, height: end.y - start.y }
      }
    }
    if (!bounds) return undefined
    const region = options.region ?? { x: 0, y: 0, width: 1, height: 1 }
    return { x: bounds.x + bounds.width * region.x, y: bounds.y + bounds.height * region.y, width: bounds.width * region.width, height: bounds.height * region.height }
  }
}

/**
 * 被录的来源是否还在：窗口没被关掉、显示器没被拔掉。来源没了是这次录制的正常结尾（与 OBS、WebRTC 一样当作采集源结束），
 * 不是采集出错。系统查不到时当作还在。
 * `misses` 是连续查不到几次才算没了：窗口一旦销毁不会回来，一次就算；显示器在休眠、KVM 切换、Win+P 改投影时
 * 会短暂从枚举里消失，要连续几次（隔 `CAPTURE_PRESENCE_INTERVAL_MS`）都查不到才算，免得把正常的长录悄悄停掉。
 */
export const CAPTURE_PRESENCE_INTERVAL_MS = 500
export interface CaptureSourcePresence { present(): boolean; misses: number }
export function createCaptureSourcePresence(source: CaptureSource): CaptureSourcePresence {
  if (source.kind === 'screen') return { misses: 3, present: () => screen.getAllDisplays().some(display => String(display.id) === source.displayId) }
  const facts = createWindowsEventFacts(), windowId = source.id.split(':')[1]
  return { misses: 1, present: () => facts.exists?.(windowId) ?? true }
}
/** 确认来源已经没了：按 `misses` 连续查，期间任何一次查到就算还在。 */
export async function captureSourceGone(presence: CaptureSourcePresence): Promise<boolean> {
  for (let attempt = 0; attempt < presence.misses; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, CAPTURE_PRESENCE_INTERVAL_MS))
    if (presence.present()) return false
  }
  return true
}

/** Letterboxing is part of source geometry; cursor events use the same crop/fit as both encoders. */
export function createCaptureGeometry(source: CaptureSource, options: ScreenCaptureOptions): () => CaptureGeometry {
  const read = createCaptureBounds(source, options)
  let last: CaptureRect | undefined
  return () => {
    // 录制中来源一时读不到（窗口正在关闭、显示器正在拔出）沿用上一次的边界；来源没了由来源检查收尾，事件不因此失败。
    const bounds = read() ?? last
    // Unsupported window geometry must not manufacture coordinates from the app window.
    if (!bounds) throw new Error('无法读取录制来源边界，请改为录制显示器')
    last = bounds
    const scale = Math.min(options.width / bounds.width, options.height / bounds.height)
    const width = options.width / scale, height = options.height / scale
    return { bounds: { x: bounds.x - (width - bounds.width) / 2, y: bounds.y - (height - bounds.height) / 2, width, height }, pixels: { width: options.width, height: options.height } }
  }
}
