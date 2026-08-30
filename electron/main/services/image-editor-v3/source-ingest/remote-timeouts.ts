type SourceBodyReadResult =
  | { done: false; value: Uint8Array }
  | { done: true; value?: Uint8Array }

export function sourceIngestAbortError(): Error {
  const error = new Error('Image source import was cancelled')
  error.name = 'AbortError'
  return error
}

function timeoutError(phase: 'response body idle' | 'total import', timeoutMs: number): Error {
  const error = new Error(`Remote image ${phase} timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

export function throwIfSourceIngestAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw sourceIngestAbortError()
}

export function createRemoteDeadlineSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onParentAbort = (): void => {
    controller.abort(parent?.reason instanceof Error ? parent.reason : sourceIngestAbortError())
  }
  parent?.addEventListener('abort', onParentAbort, { once: true })
  if (parent?.aborted) onParentAbort()
  const timer = setTimeout(() => {
    controller.abort(timeoutError('total import', timeoutMs))
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

export async function raceWithSourceIngestSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation
  throwIfSourceIngestAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): boolean => {
      if (settled) return false
      settled = true
      signal.removeEventListener('abort', onAbort)
      return true
    }
    const onAbort = (): void => {
      try {
        throwIfSourceIngestAborted(signal)
      } catch (error) {
        if (cleanup()) reject(error)
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    operation.then(
      (value) => {
        if (cleanup()) resolve(value)
      },
      (error) => {
        if (cleanup()) reject(error)
      },
    )
  })
}

export async function* streamRemoteResponseChunks(
  response: Response,
  maxBytes: number,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new Error('Remote image response has no body')
  const reader = response.body.getReader()
  let received = 0
  try {
    while (true) {
      throwIfSourceIngestAborted(signal)
      const result = await new Promise<SourceBodyReadResult>((resolve, reject) => {
        let settled = false
        const cleanup = (): boolean => {
          if (settled) return false
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          return true
        }
        const settleResolve = (value: SourceBodyReadResult): void => {
          if (cleanup()) resolve(value)
        }
        const settleReject = (error: unknown): void => {
          if (cleanup()) reject(error)
        }
        const onAbort = (): void => {
          let reason: unknown
          try {
            throwIfSourceIngestAborted(signal)
          } catch (error) {
            reason = error
          }
          settleReject(reason ?? sourceIngestAbortError())
          void reader.cancel(reason).catch(() => undefined)
        }
        const timer = setTimeout(() => {
          const error = timeoutError('response body idle', idleTimeoutMs)
          settleReject(error)
          void reader.cancel(error).catch(() => undefined)
        }, idleTimeoutMs)
        timer.unref?.()
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) {
          onAbort()
          return
        }
        reader.read().then(settleResolve, settleReject)
      })
      throwIfSourceIngestAborted(signal)
      if (result.done) break
      const chunk = result.value
      if (chunk.byteLength > maxBytes - received) {
        throw new Error(`Remote image exceeds maximum byte length of ${maxBytes}`)
      }
      received += chunk.byteLength
      yield chunk
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
