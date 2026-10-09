import type { InteractionCancelReason, InteractionGesture, InteractionPointerInput, InteractionTime } from './contracts'

function sameTime(a: InteractionTime, b: InteractionTime): boolean {
  return a.sourceVersion === b.sourceVersion && a.kind === b.kind
    && (a.kind === 'static' || (b.kind === 'sample' && a.ticks === b.ticks && a.ticksPerSecond === b.ticksPerSecond))
}

/** A single lease per host. Domain adapters own preview resources and their existing undo stack. */
export class InteractionLifecycle {
  private active: { gesture: InteractionGesture; pointerId: number; time: InteractionTime; phase: 'armed' | 'preview' | 'committing' } | null = null

  get phase(): 'idle' | 'armed' | 'preview' | 'committing' {
    return this.active?.phase ?? 'idle'
  }

  get pointerId(): number | null {
    return this.active?.pointerId ?? null
  }

  begin(gesture: InteractionGesture, input: InteractionPointerInput): boolean {
    if (this.active) return false
    this.active = { gesture, pointerId: input.sample.pointerId, time: { ...input.time }, phase: 'armed' }
    try { gesture.begin(input) } catch (error) { this.cancel('failed'); throw error }
    return true
  }

  preview(input: InteractionPointerInput): boolean {
    const lease = this.active
    if (!lease || lease.pointerId !== input.sample.pointerId || lease.phase === 'committing') return false
    if (!sameTime(lease.time, input.time)) { this.cancel('target-change'); return false }
    lease.phase = 'preview'
    try { lease.gesture.preview(input) } catch (error) { this.cancel('failed'); throw error }
    return true
  }

  commit(input: InteractionPointerInput): Promise<boolean> {
    const lease = this.active
    if (!lease || lease.pointerId !== input.sample.pointerId || lease.phase === 'committing') return Promise.resolve(false)
    if (!sameTime(lease.time, input.time)) { this.cancel('target-change'); return Promise.resolve(false) }
    lease.phase = 'committing'
    try {
      const completion = lease.gesture.commit(input)
      if (completion) return completion.then(() => {
        if (this.active !== lease) return false
        this.active = null
        return true
      }, error => {
        if (this.active === lease) this.cancel('failed')
        throw error
      })
      if (this.active === lease) this.active = null
      return Promise.resolve(true)
    } catch (error) {
      if (this.active === lease) this.cancel('failed')
      return Promise.reject(error)
    }
  }

  cancel(reason: InteractionCancelReason): boolean {
    const lease = this.active
    if (!lease) return false
    // Clear first: releasing capture can synchronously emit lostcapture.
    this.active = null
    lease.gesture.cancel(reason)
    return true
  }
}
