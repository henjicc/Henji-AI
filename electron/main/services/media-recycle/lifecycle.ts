/** A window is a possible unsaved session until the existing save/close guard succeeds.
 * No renderer reference snapshots participate in reclamation. */
export class MediaRecycleLifecycle {
  private phase: 'initial' | 'starting' | 'active' | 'exiting' = 'initial'
  private readonly windows = new Map<number, boolean>()
  private unsafeClose = false

  opened(id: number): void {
    if (this.phase === 'starting' || this.phase === 'exiting') throw new Error('Cannot open a document window during media reclamation')
    this.phase = 'active'
    this.windows.set(id, false)
  }

  saved(id: number): void { if (this.windows.has(id)) this.windows.set(id, true) }
  closed(id: number): void {
    if (this.windows.get(id) !== true) this.unsafeClose = true
    this.windows.delete(id)
  }

  async startup(sweep: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.phase !== 'initial') throw new Error('Startup reclamation requires unopened sessions')
    this.phase = 'starting'
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        sweep(controller.signal),
        new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(new Error('Startup media reclamation timed out')); resolve() }, 3_000) }),
      ])
    } finally { clearTimeout(timer); controller.abort(); this.phase = 'active' }
  }

  async exit(sweep: (signal: AbortSignal) => Promise<void>, timeoutMs = 3_000): Promise<'completed' | 'skipped' | 'timeout'> {
    if (this.phase !== 'active' || this.windows.size || this.unsafeClose) return 'skipped'
    this.phase = 'exiting'
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        sweep(controller.signal).then(() => 'completed' as const),
        new Promise<'timeout'>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve('timeout') }, timeoutMs)
        }),
      ])
    } finally { clearTimeout(timer); controller.abort() }
  }
}

export const mediaRecycleLifecycle = new MediaRecycleLifecycle()
