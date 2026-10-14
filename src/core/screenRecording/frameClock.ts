import { RECORDING_CLOCK_RECALIBRATION_SECONDS } from '../captureLog/clockSync'

/** Correlation uses the common session clock. Transport latency is not physical acquisition latency. */
export class CaptureFrameClock {
  private offset = 0
  private last = -1
  private calibrated = -Infinity
  needsCalibration(deviceUs: number): boolean { return deviceUs - this.calibrated >= RECORDING_CLOCK_RECALIBRATION_SECONDS * 1_000_000 }
  calibrate(deviceUs: number, monoUs: number, quantumUs: number): void {
    const target = monoUs - deviceUs
    this.offset = this.last < 0 ? target : this.offset + Math.max(-quantumUs, Math.min(quantumUs, target - this.offset))
    this.calibrated = deviceUs
  }
  map(deviceUs: number): number {
    this.last = Math.max(this.last + 1, Math.round(deviceUs + this.offset), 0)
    return this.last
  }
}
