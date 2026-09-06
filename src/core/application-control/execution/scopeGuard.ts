/** 一次占住整组资源；不持有部分锁等待其他锁，无关作用域仍可并行。 */
export class ApplicationExecutionScopeGuard {
  private readonly active = new Set<string>()
  private readonly pending: Array<{ keys: string[]; enter: () => void }> = []

  async run<T>(keys: readonly string[], signal: AbortSignal | undefined, execute: () => Promise<T>): Promise<T> {
    const wanted = [...new Set(keys)].sort()
    const release = await new Promise<() => void>((resolve, reject) => {
      const cancel = () => {
        const index = this.pending.indexOf(waiter)
        if (index >= 0) this.pending.splice(index, 1)
        signal?.removeEventListener('abort', cancel)
        reject(new Error('CANCELLED'))
        this.drain()
      }
      const waiter = { keys: wanted, enter: () => {
        signal?.removeEventListener('abort', cancel)
        wanted.forEach((key) => this.active.add(key))
        let released = false
        resolve(() => {
          if (released) return
          released = true
          wanted.forEach((key) => this.active.delete(key))
          this.drain()
        })
      } }
      if (signal?.aborted) { cancel(); return }
      this.pending.push(waiter)
      signal?.addEventListener('abort', cancel, { once: true })
      this.drain()
    })
    try {
      if (signal?.aborted) throw new Error('CANCELLED')
      return await execute()
    } finally { release() }
  }

  private drain(): void {
    const earlier = new Set<string>()
    for (const waiter of [...this.pending]) {
      if (waiter.keys.some((key) => this.active.has(key) || earlier.has(key))) {
        waiter.keys.forEach((key) => earlier.add(key))
        continue
      }
      this.pending.splice(this.pending.indexOf(waiter), 1)
      waiter.enter()
    }
  }
}
