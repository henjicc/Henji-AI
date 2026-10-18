interface AnalysisFlight<T> {
  controller: AbortController
  promise: Promise<T>
  listeners: Map<symbol, (value: number) => void>
  consumers: number
  progress: number
}

/** Share computation, not caller lifetimes. Slots stay occupied until the underlying process settles. */
export class SharedMediaAnalysis<T> {
  private readonly flights = new Map<string, AnalysisFlight<T>>()
  constructor(private readonly limit = 2) {}
  run(key: string, operation: (signal: AbortSignal, progress: (value: number) => void) => Promise<T>, signal: AbortSignal, progress: (value: number) => void): Promise<T> {
    signal.throwIfAborted()
    let flight = this.flights.get(key)
    if (flight?.controller.signal.aborted) throw new Error('原分析正在取消，请稍后重试。')
    if (!flight) {
      if (this.flights.size >= this.limit) throw new Error('已有两段素材正在分析，请等待或取消后再试。')
      const controller = new AbortController()
      const listeners = new Map<symbol, (value: number) => void>()
      const promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal, value => {
          owned.progress = Math.max(owned.progress, Math.min(1, Math.max(0, value)))
          for (const listener of listeners.values()) listener(owned.progress)
        })
      }).finally(() => { if (this.flights.get(key) === owned) this.flights.delete(key) })
      const owned: AnalysisFlight<T> = { controller, listeners, consumers: 0, progress: 0, promise }
      // A cancelled last consumer may leave before native close.
      void owned.promise.catch(() => undefined)
      flight = owned; this.flights.set(key, owned)
    }
    const shared = flight; const token = Symbol()
    shared.consumers++
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const leave = (): boolean => {
        if (settled) return false
        settled = true; signal.removeEventListener('abort', abort); shared.listeners.delete(token); shared.consumers--
        return true
      }
      const fail = (error: unknown): void => {
        if (!leave()) return
        if (!shared.consumers) shared.controller.abort(error)
        reject(error)
      }
      const abort = (): void => fail(signal.reason ?? new DOMException('操作已取消', 'AbortError'))
      const notify = (value: number): void => { try { progress(value) } catch (error) { fail(error) } }
      shared.listeners.set(token, notify)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else notify(shared.progress)
      shared.promise.then(value => {
        if (leave()) {
          try { resolve(structuredClone(value)) } catch (error) { reject(error) }
        }
      }, error => { if (leave()) reject(error) })
    })
  }
}
