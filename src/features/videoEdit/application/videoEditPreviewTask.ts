/** A deadline covers waiting, rendering and encoding, including operations which ignore cancellation. */
export const VIDEO_EDIT_PREVIEW_TIMEOUT_MS = 35_000

export async function runVideoEditPreviewTask<T>(signal: AbortSignal, message: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  const controller = new AbortController()
  let rejectStopped!: (reason: unknown) => void
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject })
  const cancel = (): void => { controller.abort(signal.reason); rejectStopped(controller.signal.reason) }
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    const error = new Error(message)
    controller.abort(error); rejectStopped(error)
  }, VIDEO_EDIT_PREVIEW_TIMEOUT_MS)
  try {
    return await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal) }), stopped])
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}

/** Cancelled waiting entries settle immediately, but never let a successor overtake the active entry. */
export class VideoEditPreviewQueue {
  private tail: Promise<void> = Promise.resolve()
  run<T>(signal: AbortSignal, message: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const previous = this.tail
    const result = runVideoEditPreviewTask(signal, message, async active => {
      await previous; active.throwIfAborted()
      return work(active)
    })
    this.tail = previous.then(() => result).then(() => undefined, () => undefined)
    return result
  }
}
