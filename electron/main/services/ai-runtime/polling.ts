import { cancelledError } from './errors'
import { isCancelled } from './task-registry'

export async function waitIntervalMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw cancelledError('aborted')
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(cancelledError('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function ensureNotCancelled(requestId: string): void {
  if (isCancelled(requestId)) {
    throw cancelledError(requestId)
  }
}
