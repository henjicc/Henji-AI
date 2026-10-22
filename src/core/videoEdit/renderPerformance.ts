import { z } from 'zod'

/** 每段保留最近两遍 5 秒 / 60fps 的样本，避免历史冷启动永久影响判断，也限制缓存体积。 */
export const VIDEO_EDIT_RENDER_SAMPLE_LIMIT = 600
/** 至少半秒左右的观测才覆盖启发式；超预算比例大于 5% 表示每秒数次可察觉停顿。 */
export const VIDEO_EDIT_RENDER_MIN_SAMPLES = 15
export const VIDEO_EDIT_RENDER_SLOW_RATIO = 0.05

export const videoEditRenderMeasurementSchema = z.object({
  fps: z.number().positive(), updatedAt: z.number().nonnegative(),
  samples: z.array(z.number().finite().nonnegative()).max(VIDEO_EDIT_RENDER_SAMPLE_LIMIT),
}).strict()
export type VideoEditRenderMeasurement = z.infer<typeof videoEditRenderMeasurementSchema>
export interface VideoEditRenderPerformance { sampleFrames: number; overBudgetFrames: number; p90Ms: number }

export function videoEditRenderPerformance(measurement: VideoEditRenderMeasurement): VideoEditRenderPerformance {
  const samples = [...measurement.samples].sort((a, b) => a - b)
  return { sampleFrames: samples.length, overBudgetFrames: samples.filter(ms => ms > 1000 / measurement.fps).length,
    p90Ms: samples[Math.max(0, Math.ceil(samples.length * 0.9) - 1)] ?? 0 }
}

export function videoEditMeasuredRenderState(heavy: boolean, measured?: VideoEditRenderPerformance): 'dropped' | 'predicted' | 'realtime' {
  if (!measured || measured.sampleFrames < VIDEO_EDIT_RENDER_MIN_SAMPLES) return heavy ? 'predicted' : 'realtime'
  return measured.overBudgetFrames / measured.sampleFrames > VIDEO_EDIT_RENDER_SLOW_RATIO ? 'dropped' : 'realtime'
}
