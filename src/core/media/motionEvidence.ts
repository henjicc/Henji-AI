import { z } from 'zod'
import { motionReviewSampleSchema } from './motionReview'

export const videoMotionScanSchema = z.object({
  startSeconds: z.number().finite().nonnegative().max(86400), endSeconds: z.number().finite().positive().max(86400),
  samplingFps: z.number().int().min(1).max(60), width: z.number().int().min(32).max(1024), height: z.number().int().min(32).max(1024),
  sampledFrames: z.number().int().positive().max(60000), samples: z.array(motionReviewSampleSchema).min(1).max(60000),
}).strict()
export type VideoMotionScan = z.infer<typeof videoMotionScanSchema>
export interface VideoMotionOptions { analysis: 'motion'; width: number; height: number; channels: 1; fps: number; startSeconds: number; endSeconds: number; sourceAspectRatio?: number; displayRotation?: number }

/** Rebuildable evidence must cover its declared range, not just be valid JSON. */
export function validateVideoMotionScan(raw: unknown, startSeconds: number, endSeconds: number): VideoMotionScan {
  const scan = videoMotionScanSchema.parse(raw)
  const expected = Math.ceil((endSeconds - startSeconds) * scan.samplingFps - 1e-9)
  if (scan.startSeconds !== startSeconds || scan.endSeconds !== endSeconds || endSeconds <= startSeconds || scan.sampledFrames !== expected || scan.samples.length !== expected) throw new Error('运动采样未完整覆盖原范围，请缩小范围后重试。')
  for (let i = 0; i < scan.samples.length; i++) {
    const sample = scan.samples[i]
    if (Math.abs(sample.fromSeconds - (startSeconds + i / scan.samplingFps)) > 1e-7 || Math.abs(sample.toSeconds - Math.min(endSeconds, startSeconds + (i + 1) / scan.samplingFps)) > 1e-7) throw new Error('运动证据的采样时钟无效，请重新分析。')
  }
  return scan
}
