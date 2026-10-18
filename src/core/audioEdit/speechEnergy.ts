import { z } from 'zod'

export const speechEnergyOptionsSchema = z.object({
  channels: z.array(z.object({ stream: z.number().int().min(0).max(63), channel: z.number().int().min(0).max(63) }).strict()).min(1).max(2).optional(),
}).strict()
export type SpeechEnergyOptions = z.infer<typeof speechEnergyOptionsSchema>
export interface SpeechEnergyPause { startMs: number; endMs: number; cutMs: number }
export interface SpeechEnergyAnalysis {
  resolutionMs: number
  thresholdDb: number
  highThresholdDb: number
  pauses: SpeechEnergyPause[]
}

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
