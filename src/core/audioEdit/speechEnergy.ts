import { z } from 'zod'

export const speechEnergyOptionsSchema = z.object({
  channels: z.array(z.object({ stream: z.number().int().min(0).max(63), channel: z.number().int().min(0).max(63) }).strict()).min(1).max(2).optional(),
  /** 同时返回逐帧全频电平（字间气口清理用来找字真正的起止） */
  levels: z.boolean().optional(),
}).strict()
export type SpeechEnergyOptions = z.infer<typeof speechEnergyOptionsSchema>
export interface SpeechEnergyPause { startMs: number; endMs: number; cutMs: number }
export const speechEnergyAnalysisSchema = z.object({
  resolutionMs: z.number().min(10).max(10), thresholdDb: z.number().min(-120).max(0), highThresholdDb: z.number().min(-120).max(0),
  pauses: z.array(z.object({ startMs: z.number().nonnegative().max(21_600_000), endMs: z.number().positive().max(21_600_000), cutMs: z.number().nonnegative().max(21_600_000) }).strict()).max(216000),
  /** 每 10 ms 一帧的全频与 2.5 kHz 以上高频 RMS 电平（dBFS，静音记 -120），只在请求 levels 时返回 */
  levels: z.object({ wideDb: z.array(z.number().min(-120).max(0)).max(2_160_000), highDb: z.array(z.number().min(-120).max(0)).max(2_160_000).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  value.pauses.forEach((pause, index) => {
    if (pause.endMs - pause.startMs < 100 - .01 || pause.cutMs < pause.startMs || pause.cutMs > pause.endMs || index > 0 && pause.startMs < value.pauses[index - 1].endMs) context.addIssue({ code: 'custom', path: ['pauses', index], message: '声音低谷必须有序、不重叠，切点位于至少100毫秒的区间内。' })
  })
})
export type SpeechEnergyAnalysis = z.infer<typeof speechEnergyAnalysisSchema>

/** Quarter-dB histogram: bounded memory and linear cost even for hour-long recordings. */
export class SpeechEnergyHistogram {
  private readonly bins = new Uint32Array(481)
  private count = 0
  add(db: number): void {
    if (db > -120 && Number.isFinite(db)) {
      this.bins[Math.max(0, Math.min(480, Math.round((db + 120) * 4)))]++
      this.count++
    }
  }
  threshold(belowDb: number, floorDb = -80): number {
    let remaining = Math.ceil(this.count * .8)
    if (!remaining) return floorDb
    for (let index = 0; index < this.bins.length; index++) {
      remaining -= this.bins[index]
      if (remaining <= 0) return Math.max(floorDb, index / 4 - 120 - belowDb)
    }
    return floorDb
  }
}

/** Both bands must be quiet. Never bridge a voiced burst and call the whole span silence. */
export class SpeechEnergyValleys {
  readonly pauses: SpeechEnergyPause[] = []
  private startMs: number | undefined
  private endMs = 0
  constructor(private readonly thresholdDb: number, private readonly highThresholdDb: number) {}
  append(startMs: number, endMs: number, wideDb: number, highDb: number): void {
    const quiet = wideDb < this.thresholdDb && highDb < this.highThresholdDb
    if (!quiet || startMs > this.endMs + .01) this.flush()
    if (quiet) { this.startMs ??= startMs; this.endMs = endMs }
  }
  flush(): void {
    if (this.startMs !== undefined && this.endMs - this.startMs >= 100 - .01) {
      this.pauses.push({ startMs: this.startMs, endMs: this.endMs, cutMs: (this.startMs + this.endMs) / 2 })
    }
    this.startMs = undefined
  }
}
