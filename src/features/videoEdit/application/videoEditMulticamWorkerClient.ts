export function synchronizeVideoEditMulticam(reference: Float32Array, candidate: Float32Array, signal?: AbortSignal): Promise<{ seconds: number; confidence: number }> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('../engine/videoEditMulticamWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = (): void => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = (): void => { finish(); reject(signal?.reason ?? new Error('多机位同步已取消。')) }
    worker.onmessage = (event: MessageEvent<{ result: { seconds: number; confidence: number } } | { error: string }>): void => { finish(); if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data.result) }
    worker.onerror = event => { finish(); reject(new Error(event.message)) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { worker.postMessage({ reference, candidate }) } catch (error) { finish(); reject(error) }
  })
}
