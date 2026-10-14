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

/** Letterboxing is part of source geometry; cursor events use the same crop/fit as both encoders. */
export function createCaptureGeometry(source: CaptureSource, options: ScreenCaptureOptions): () => CaptureGeometry {
  const read = createCaptureBounds(source, options)
  return () => {
    const bounds = read()
    // Unsupported window geometry must not manufacture coordinates from the app window.
    if (!bounds) throw new Error('无法读取录制来源边界，请改为录制显示器')
    const scale = Math.min(options.width / bounds.width, options.height / bounds.height)
    const width = options.width / scale, height = options.height / scale
    return { bounds: { x: bounds.x - (width - bounds.width) / 2, y: bounds.y - (height - bounds.height) / 2, width, height }, pixels: { width: options.width, height: options.height } }
  }
}
