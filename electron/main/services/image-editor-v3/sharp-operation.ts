import { imageSourceAbortError } from './abortable-singleflight'

export interface DestroyableSharpPipeline {
  destroy(error?: Error): unknown
}

/** Sharp/libvips 的单次 pass 是协作式取消原子单位；取消时销毁当前管线。 */
export async function runSharpOperation<T>(
  pipeline: DestroyableSharpPipeline,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    pipeline.destroy()
    throw imageSourceAbortError()
  }
  const onAbort = (): void => {
    pipeline.destroy(imageSourceAbortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw imageSourceAbortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
