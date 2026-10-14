import { captureClockCorrelation, RECORDING_CLOCK_RECALIBRATION_SECONDS } from '@/core/captureLog/clockSync'

export class RecordingTracksClock {
  originMs = 0
  uncertaintyUs = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  constructor(readonly originUs: number, private readonly read: () => Promise<number>, private readonly failed: (error: unknown) => void) {}
  async start(): Promise<void> { await this.calibrate(); this.schedule() }
  nowUs(): number { return Math.max(0, Math.round((performance.now() - this.originMs) * 1000)) }
  private async calibrate(): Promise<void> {
    const beforeMs = performance.now(); const mainUs = await this.read(); const afterMs = performance.now()
    if (this.stopped) return
    const next = captureClockCorrelation({ beforeMs, afterMs, mainUs }, this.originUs)
    this.originMs = next.originMs; this.uncertaintyUs = next.uncertaintyUs
  }
  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { void this.calibrate().then(() => this.schedule()).catch(error => { if (!this.stopped) this.failed(error) }) }, RECORDING_CLOCK_RECALIBRATION_SECONDS * 1000)
  }
  stop(): void { this.stopped = true; clearTimeout(this.timer) }
}
