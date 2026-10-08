/** Coalesce input before publishing; commit/cancel synchronously discard the pending frame. */
export class LatestAdjustmentPreview<T> {
  private handle: number | null = null
  private latest: T | null = null
  constructor(private readonly schedule: (callback: () => void) => number, private readonly unschedule: (handle: number) => void, private readonly publish: (value: T) => void) {}
  update(value: T): void {
    this.latest = value
    if (this.handle !== null) return
    this.handle = this.schedule(() => { this.handle = null; const latest = this.latest; this.latest = null; if (latest !== null) this.publish(latest) })
  }
  cancel(): void { if (this.handle !== null) this.unschedule(this.handle); this.handle = null; this.latest = null }
}
