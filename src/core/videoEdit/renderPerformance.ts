import { z } from 'zod'

/** 每段保留最近两遍 5 秒 / 60fps 的样本，避免历史冷启动永久影响判断，也限制缓存体积。 */
export const VIDEO_EDIT_RENDER_SAMPLE_LIMIT = 600
/**
 * 至少半秒左右的观测才覆盖启发式；被跳过的帧超过 5% 表示每秒数次可察觉停顿。
 * 判定看画面是否按时出现（播放时钟跳过了哪些帧），而不是单帧渲染耗时：节目两三帧流水，单帧略超 1/fps 仍能按时呈现。
 */
export const VIDEO_EDIT_RENDER_MIN_SAMPLES = 15
export const VIDEO_EDIT_RENDER_SLOW_RATIO = 0.05

export const videoEditRenderMeasurementSchema = z.object({
  fps: z.number().positive(), updatedAt: z.number().nonnegative(),
  /** 每个应出现的帧：实际呈现的记渲染耗时（毫秒），被跳过的记 null。 */
  samples: z.array(z.number().finite().nonnegative().nullable()).max(VIDEO_EDIT_RENDER_SAMPLE_LIMIT),
}).strict()
export type VideoEditRenderMeasurement = z.infer<typeof videoEditRenderMeasurementSchema>
export interface VideoEditRenderPerformance { sampleFrames: number; droppedFrames: number; p90Ms: number }

export function videoEditRenderPerformance(measurement: VideoEditRenderMeasurement): VideoEditRenderPerformance {
  const shown = measurement.samples.filter((ms): ms is number => ms !== null).sort((a, b) => a - b)
  return { sampleFrames: measurement.samples.length, droppedFrames: measurement.samples.length - shown.length,
    p90Ms: shown[Math.max(0, Math.ceil(shown.length * 0.9) - 1)] ?? 0 }
}

export function videoEditMeasuredRenderState(heavy: boolean, measured?: VideoEditRenderPerformance): 'dropped' | 'predicted' | 'realtime' {
  if (!measured || measured.sampleFrames < VIDEO_EDIT_RENDER_MIN_SAMPLES) return heavy ? 'predicted' : 'realtime'
  return measured.droppedFrames / measured.sampleFrames > VIDEO_EDIT_RENDER_SLOW_RATIO ? 'dropped' : 'realtime'
}
