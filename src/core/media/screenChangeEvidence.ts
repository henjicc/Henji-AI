import { z } from 'zod'

const seconds = z.number().finite().nonnegative().max(86400)
export const screenChangeSchema = z.object({
  beforeSeconds: seconds, atSeconds: seconds, lastChangeSeconds: seconds,
  settledSeconds: seconds.optional(), returnSeconds: seconds.optional(), changedRatio: z.number().min(0).max(1),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict(),
  abrupt: z.boolean(), kind: z.enum(['change', 'transient', 'flash', 'burst', 'continuous']),
}).strict()
export const screenChangeScanSchema = z.object({
  samplingFps: z.number().min(1).max(60), sampledFrames: z.number().int().nonnegative(), lastSampleSeconds: seconds.nullable(),
  candidates: z.array(screenChangeSchema).max(10000),
}).strict()
export const screenChangeAnalysisSchema = z.object({
  coarse: screenChangeScanSchema,
  refinements: z.array(z.object({ fromSeconds: seconds, toSeconds: seconds, scan: screenChangeScanSchema }).strict()).max(12),
  omittedCandidates: z.number().int().nonnegative(),
}).strict()
export type ScreenChangeAnalysis = z.infer<typeof screenChangeAnalysisSchema>

/** Cache/Worker evidence must still describe the requested source window, in chronological order. */
export function validateScreenChangeAnalysis(value: ScreenChangeAnalysis, from: number, to: number): void {
  const scans = [{ fromSeconds: from, toSeconds: to, scan: value.coarse }, ...value.refinements]
  if (value.omittedCandidates > value.coarse.candidates.length) throw new Error('局部变化复核数量无效。')
  for (const { fromSeconds, toSeconds, scan } of scans) {
    const last = scan.lastSampleSeconds
    if (fromSeconds < from || toSeconds > to || toSeconds <= fromSeconds || scan.sampledFrames < 1 || last === null
      || Math.abs(last - (fromSeconds + (scan.sampledFrames - 1) / scan.samplingFps)) > 1e-7 || last >= toSeconds
      || last + 1 / scan.samplingFps < toSeconds - 1e-7) throw new Error('局部变化未完整覆盖请求源范围，请缩小范围并检查原视频时长后重试。')
    let previous = -1
    for (const event of scan.candidates) {
      if (event.atSeconds <= previous || event.beforeSeconds < fromSeconds - 1e-7 || event.beforeSeconds >= event.atSeconds || event.atSeconds > last + 1e-7 || event.lastChangeSeconds < event.atSeconds || event.lastChangeSeconds > last + 1e-7
        || event.settledSeconds !== undefined && (event.settledSeconds < event.lastChangeSeconds || event.settledSeconds > last + 1e-7)
        || event.returnSeconds !== undefined && (event.returnSeconds <= event.atSeconds || event.returnSeconds > last + 1e-7)
        || event.region.x + event.region.width > 1 + 1e-7 || event.region.y + event.region.height > 1 + 1e-7) throw new Error('局部变化的源时间或变化区域无效，请重新分析。')
      previous = event.atSeconds
    }
  }
}
