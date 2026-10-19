import { z } from 'zod'

export const videoEditObservationRegionSchema = z.object({ x: z.number().min(0).lt(1), y: z.number().min(0).lt(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
  .refine(region => region.x + region.width <= 1 + 1e-9 && region.y + region.height <= 1 + 1e-9, 'cropRegion 必须完整位于画面内。')
export type VideoEditObservationRegion = z.infer<typeof videoEditObservationRegionSchema>
export type VideoEditObservationFrames = { startFrame: number; endFrame: number; frameCount: number } | { frames: number[] } | { cutFrame: number; before: number; after: number }

export function videoEditObservationFrames(duration: number, selection: VideoEditObservationFrames): number[] {
  if ('frames' in selection) {
    if (!selection.frames.length || selection.frames.length > 12 || selection.frames.some(frame => !Number.isSafeInteger(frame) || frame < 0 || frame >= duration)) throw new Error('target.frames 须为序列时长内的1–12个整数帧。')
    return [...new Set(selection.frames)].sort((a, b) => a - b)
  }
  if ('cutFrame' in selection) {
    if (!Number.isSafeInteger(selection.cutFrame) || selection.cutFrame < 0 || selection.cutFrame >= duration) throw new Error('target.cutFrame 须为序列时长内的整数帧（切入后第一帧）。')
    if (![selection.before, selection.after].every(value => Number.isInteger(value) && value >= 0 && value <= 5)) throw new Error('target.before/after 须为0–5个连续帧。')
    const from = Math.max(0, selection.cutFrame - selection.before); const to = Math.min(duration - 1, selection.cutFrame + selection.after)
    return Array.from({ length: to - from + 1 }, (_, index) => from + index)
  }
  if (!Number.isSafeInteger(selection.startFrame) || selection.startFrame < 0 || selection.startFrame >= duration) throw new Error('target.startFrame 必须位于序列时长内。')
  if (!Number.isSafeInteger(selection.endFrame) || selection.endFrame <= selection.startFrame || selection.endFrame >= duration) throw new Error('target.endFrame 必须大于 startFrame 且位于序列时长内（含末帧）。')
  if (!Number.isSafeInteger(selection.frameCount) || selection.frameCount < 2 || selection.frameCount > 12 || selection.frameCount > selection.endFrame - selection.startFrame + 1) throw new Error('target.frameCount 必须为 2–12，且不能超过区间内不同帧的数量。')
  return Array.from({ length: selection.frameCount }, (_, index) => Math.round(selection.startFrame + (selection.endFrame - selection.startFrame) * index / (selection.frameCount - 1)))
}

export function videoEditObservationPixelCrop(width: number, height: number, region?: VideoEditObservationRegion): { x: number; y: number; width: number; height: number } {
  // Public temporary regions are validated by the input schema; existing annotations may extend past an edge.
  const crop = region ?? { x: 0, y: 0, width: 1, height: 1 }
  const x = Math.floor(crop.x * width); const y = Math.floor(crop.y * height)
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil((crop.x + crop.width) * width)) - x), height: Math.max(1, Math.min(height, Math.ceil((crop.y + crop.height) * height)) - y) }
}
