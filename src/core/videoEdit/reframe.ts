import { z } from 'zod'
import type { VideoEditClip } from './document'
import type { VideoEditSize } from './clipGeometry'
import { evaluateVideoEditKeyframes, isVideoEditReframeKeyframe, writeVideoEditClipKeyframes, type VideoEditKeyframe } from './keyframes'

export const videoEditReframeSettingsSchema = z.object({
  motion: z.enum(['slow', 'default', 'fast']).default('default'),
  attention: z.enum(['auto', 'person', 'face', 'tracker']).default('auto'),
}).strict()
export type VideoEditReframeSettings = z.infer<typeof videoEditReframeSettingsSchema>
export const VIDEO_EDIT_REFRAME_SIZES = { '9:16': { width: 1080, height: 1920 }, '1:1': { width: 1080, height: 1080 }, '4:5': { width: 1080, height: 1350 }, '16:9': { width: 1920, height: 1080 } } as const
export const videoEditReframeSizeSchema = z.object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096) }).strict()
/** Normalized source-picture bounds. null means no subject detected in this frame. */
export interface VideoEditAttentionBox { x: number; y: number; width: number; height: number }
export interface VideoEditReframeSample { x: number; y: number; scale: number }
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))

export function videoEditReframeViewport(picture: VideoEditSize, target: VideoEditSize): VideoEditReframeSample & { width: number; height: number } {
  if (picture.width <= 0 || picture.height <= 0) throw new Error('素材画面尺寸未知，请重新导入素材。')
  const fit = Math.min(target.width / picture.width, target.height / picture.height)
  const cover = Math.max(target.width / picture.width, target.height / picture.height)
  const scale = cover / fit
  if (scale > 4 + 1e-9) throw new Error('画幅差异超过可用缩放范围，请选择更接近原素材的画幅。')
  return { width: target.width / (picture.width * cover), height: target.height / (picture.height * cover), x: 0, y: 0, scale: Math.min(4, scale) }
}
function bounds(box: VideoEditAttentionBox | null, size: number, axis: 'x' | 'y'): [number, number] {
  if (!box) return [size / 2, 1 - size / 2]
  const length = axis === 'x' ? box.width : box.height
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 + 1e-8 || box.y + box.height > 1 + 1e-8) throw new Error('关注区域无效，请重新分析或修正跟踪框。')
  const low = Math.max(size / 2, box[axis] + length - size / 2)
  const high = Math.min(1 - size / 2, box[axis] + size / 2)
  if (low > high + 1e-8) throw new Error('主体超出目标画幅能容纳的范围，请改用人脸或较小的跟踪框，或选择更宽的画幅。')
  return [low, Math.max(low, high)]
}
/** EMA is restarted at each cut; project every sample onto subject + no-black-edge constraints. */
export function smoothVideoEditAttention(boxes: readonly (VideoEditAttentionBox | null)[], picture: VideoEditSize, target: VideoEditSize, fps: number, motion: VideoEditReframeSettings['motion'], cuts: readonly number[] = []): VideoEditReframeSample[] {
  const viewport = videoEditReframeViewport(picture, target)
  const alpha = 1 - Math.exp(-1 / (fps * ({ slow: 0.8, default: 0.35, fast: 0.1 }[motion])))
  const cutSet = new Set(cuts); let cx = 0.5; let cy = 0.5
  return boxes.map((box, frame) => {
    const reset = frame === 0 || cutSet.has(frame)
    const desiredX = box ? box.x + box.width / 2 : reset ? 0.5 : cx; const desiredY = box ? box.y + box.height / 2 : reset ? 0.5 : cy
    const bx = bounds(box, viewport.width, 'x'); const by = bounds(box, viewport.height, 'y')
    cx = clamp(reset ? desiredX : cx + alpha * (desiredX - cx), ...bx)
    cy = clamp(reset ? desiredY : cy + alpha * (desiredY - cy), ...by)
    return { x: (0.5 - cx) / viewport.width, y: (0.5 - cy) / viewport.height, scale: viewport.scale }
  })
}
/** Piecewise linear reduction is checked against every source frame, including cut-adjacent frames. */
export function generateVideoEditReframeKeyframes(clip: VideoEditClip, boxes: readonly (VideoEditAttentionBox | null)[], picture: VideoEditSize, target: VideoEditSize, fps: number, settings: VideoEditReframeSettings, cuts: readonly number[] = []): VideoEditClip {
  if (boxes.length !== clip.duration) throw new Error('关注区域帧数与片段长度不一致，请重新分析。')
  if (clip.follow || clip.rotation !== 0 || clip.curves?.rotation?.some(point => point.value !== 0)) throw new Error('请先取消片段跟随并重置旋转，再自动重构画幅；现有运动设置已保留。')
  const viewport = videoEditReframeViewport(picture, target)
  const anchor = (axis: 'anchorX' | 'anchorY', time: number): number => evaluateVideoEditKeyframes(clip.curves?.[axis], time, clip[axis] ?? 0.5)
  const samples = smoothVideoEditAttention(boxes, picture, target, fps, settings.motion, cuts).map((sample, time) => ({ ...sample, x: sample.x + (anchor('anchorX', time) - 0.5) / viewport.width, y: sample.y + (anchor('anchorY', time) - 0.5) / viewport.height }))
  const validCuts = cuts.filter(time => Number.isInteger(time) && time > 0 && time < clip.duration)
  const times = new Set([0, clip.duration - 1, ...validCuts.flatMap(time => [time - 1, time])])
  if (times.size > 256) throw new Error('镜头切点过于密集，请分割片段后重试。')
  const segments = [...times].sort((a, b) => a - b); const stack = segments.slice(1).map((end, i) => [segments[i], end])
  while (stack.length) {
    const [start, end] = stack.pop()!; let worst = 0; let index = -1
    for (let frame = start + 1; frame < end; frame++) {
      const t = (frame - start) / (end - start)
      const x = samples[start].x + (samples[end].x - samples[start].x) * t; const y = samples[start].y + (samples[end].y - samples[start].y) * t
      const cx = anchor('anchorX', frame) - x * viewport.width; const cy = anchor('anchorY', frame) - y * viewport.height
      const bx = bounds(boxes[frame], viewport.width, 'x'); const by = bounds(boxes[frame], viewport.height, 'y')
      const violation = Math.max(bx[0] - cx, cx - bx[1], by[0] - cy, cy - by[1], 0)
      const error = Math.max(Math.abs(x - samples[frame].x), Math.abs(y - samples[frame].y))
      const score = violation > 1e-8 ? 1 + violation : error / 0.0005
      if (score > worst && score > 1) { worst = score; index = frame }
    }
    if (index >= 0) { times.add(index); if (times.size > 256) throw new Error('主体运动变化过于密集，请在镜头切点分割片段后重试。'); stack.push([start, index], [index, end]) }
  }
  let result = clip; const sorted = [...times].sort((a, b) => a - b)
  for (const key of ['x', 'y', 'scale'] as const) {
    const manual = (clip.curves?.[key] ?? []).filter(point => !isVideoEditReframeKeyframe(point))
    const generated = sorted.filter(time => !manual.some(point => point.time === time)).map((time): VideoEditKeyframe => {
      const value = samples[time][key]; const interpolation = validCuts.includes(time + 1) ? 'hold' as const : 'linear' as const
      return { time, value, interpolation, source: 'reframe', reframeOrigin: { time, value, interpolation } }
    })
    if (manual.length + generated.length > 256) throw new Error('运动关键帧过于密集，请分割片段后重试；手动关键帧已保留。')
    result = writeVideoEditClipKeyframes(result, key, [...manual, ...generated].sort((a, b) => a.time - b.time), false)
  }
  // Hand-authored keys and anchors remain untouched. Reject the whole operation if they violate framing.
  for (let time = 0; time < clip.duration; time++) {
    const value = (key: 'x' | 'y' | 'scale' | 'anchorX' | 'anchorY'): number => evaluateVideoEditKeyframes(result.curves?.[key], time, result[key] ?? 0.5)
    const scale = value('scale'); const width = viewport.width * viewport.scale / scale; const height = viewport.height * viewport.scale / scale
    const cx = value('anchorX') - value('x') * width; const cy = value('anchorY') - value('y') * height
    const bx = bounds(boxes[time], width, 'x'); const by = bounds(boxes[time], height, 'y')
    if (scale < 0.01 || scale > 4 || width > 1 + 1e-8 || height > 1 + 1e-8 || cx < bx[0] - 1e-8 || cx > bx[1] + 1e-8 || cy < by[0] - 1e-8 || cy > by[1] + 1e-8) throw new Error('现有手动运动关键帧或锚点与目标构图冲突，请先调整这些设置后重试；手动关键帧未覆盖。')
  }
  return result
}
