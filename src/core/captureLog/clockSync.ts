import { RECORDING_CLOCK_RECALIBRATION_SECONDS } from '../audioEdit/recordingClock'

export { RECORDING_CLOCK_RECALIBRATION_SECONDS }

/** Main process monotonic clock -> renderer performance clock. Both tracks and events subtract originUs. */
export interface CaptureClockSample { beforeMs: number; afterMs: number; mainUs: number }
export function captureClockCorrelation(sample: CaptureClockSample, originUs: number): { originMs: number; uncertaintyUs: number } {
  if (![sample.beforeMs, sample.afterMs, sample.mainUs, originUs].every(Number.isFinite) || sample.afterMs < sample.beforeMs) throw new Error('采集时钟校准无效')
  return { originMs: (sample.beforeMs + sample.afterMs) / 2 - (sample.mainUs - originUs) / 1000, uncertaintyUs: Math.ceil((sample.afterMs - sample.beforeMs) * 500) }
}

/** Camera clocks can have an arbitrary origin. Use the best delivery correlation, never timestamp every frame on arrival. */
export class CaptureSourceClock {
  private offsetUs: number | undefined
  private targetUs = 0
  private calibratedUs = -Infinity
  private bestOffsetUs = Infinity
  private previousUs = -1
  constructor(private readonly quantumUs: number) {}
  map(sourceUs: number, arrivalUs: number): { monoUs: number; uncertaintyUs: number; calibrated: boolean; offsetUs: number } {
    if (![sourceUs, arrivalUs].every(Number.isFinite)) throw new Error('采集样本时钟无效')
    const observed = arrivalUs - sourceUs
    this.bestOffsetUs = Math.min(this.bestOffsetUs, observed)
    const calibrated = arrivalUs - this.calibratedUs >= RECORDING_CLOCK_RECALIBRATION_SECONDS * 1_000_000
    if (calibrated) { this.targetUs = this.bestOffsetUs; this.bestOffsetUs = Infinity; this.calibratedUs = arrivalUs }
    this.offsetUs ??= this.targetUs
    this.offsetUs += Math.max(-this.quantumUs, Math.min(this.quantumUs, this.targetUs - this.offsetUs))
    const mapped = Math.round(sourceUs + this.offsetUs)
    const monoUs = Math.max(0, this.previousUs + 1, mapped)
    this.previousUs = monoUs
    return { monoUs, offsetUs: this.offsetUs, calibrated, uncertaintyUs: Math.ceil(this.quantumUs + Math.abs(observed - this.offsetUs) + Math.abs(monoUs - mapped)) }
  }
}
