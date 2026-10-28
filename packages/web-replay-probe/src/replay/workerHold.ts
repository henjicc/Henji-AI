/**
 * Workers run on the real clock, outside page time. While the page waits for a worker's answer, page
 * time holds still, so the answer lands at the same page time however fast or slow the replay runs.
 * The wait ends at the answer, when the worker is terminated, or after a second of real time: a worker
 * may be busy for long, or not answer every message. After two waits in a row run out, the worker is
 * taken for one that only listens (an OffscreenCanvas renderer, a logging worker fed every frame), and
 * messages to it stop holding page time until it answers again. The replay warns once, the first time
 * a wait runs out. What a worker does on its own timers still follows the real clock, so its first
 * appearance is reported as well.
 */

export const WORKER_REPLY_LIMIT_MS = 1000
/** Waits in a row that ran out before a worker's messages stop holding page time. */
const QUIET_AFTER_TIMEOUTS = 2

export function holdWorkers(
  hold: (work: Promise<unknown>) => unknown,
  wallTimeout: (callback: () => void, ms: number) => () => void,
  warn: (message: string) => void,
): void {
  if (typeof Worker === 'undefined') return
  const answers = ['message', 'messageerror', 'error']
  /** Ends the open wait on each worker; messages sent meanwhile share it. */
  const waiting = new Map<Worker, () => void>()
  /** Waits in a row that ran out, per worker; any answer resets it. */
  const timeouts = new WeakMap<Worker, number>()
  const terminated = new WeakSet<Worker>()
  let timeoutWarned = false
  const watch = (worker: Worker): void => {
    if (timeouts.has(worker)) return
    timeouts.set(worker, 0)
    for (const type of answers) worker.addEventListener(type, () => timeouts.set(worker, 0))
  }
  const awaitReply = (worker: Worker): void => {
    watch(worker)
    if (terminated.has(worker) || waiting.has(worker) || (timeouts.get(worker) ?? 0) >= QUIET_AFTER_TIMEOUTS) return
    hold(new Promise<void>(resolve => {
      let cancel = (): void => {}
      const done = (): void => {
        for (const type of answers) worker.removeEventListener(type, done)
        cancel()
        waiting.delete(worker)
        resolve()
      }
      waiting.set(worker, done)
      for (const type of answers) worker.addEventListener(type, done)
      cancel = wallTimeout(() => {
        timeouts.set(worker, (timeouts.get(worker) ?? 0) + 1)
        if (!timeoutWarned) {
          timeoutWarned = true
          warn(`Worker 超过 ${WORKER_REPLY_LIMIT_MS / 1000} 秒没有回复，页面时间先继续往前走`)
        }
        done()
      }, WORKER_REPLY_LIMIT_MS)
    }))
  }
  const proto = Worker.prototype
  const post = proto.postMessage as (this: Worker, ...args: unknown[]) => void
  proto.postMessage = function (this: Worker, ...args: unknown[]) {
    post.apply(this, args)
    awaitReply(this)
  } as typeof proto.postMessage
  const terminate = proto.terminate
  proto.terminate = function (this: Worker) {
    terminate.call(this)
    terminated.add(this)
    waiting.get(this)?.()
  }

  let announced = false
  const announce = (): void => {
    if (announced) return
    announced = true
    warn('页面用了 Worker：它按真实时间运行，相关画面可能和录制差几帧')
  }
  const win = window as unknown as Record<string, unknown>
  for (const name of ['Worker', 'SharedWorker']) {
    const Native = win[name] as (new (...args: unknown[]) => object) | undefined
    if (typeof Native !== 'function') continue
    win[name] = new Proxy(Native, { construct(target, args, newTarget) { announce(); return Reflect.construct(target, args, newTarget) } })
  }
}
