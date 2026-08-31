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
    // 不把 AbortError 注入 Sharp 的 Stream 错误通道：如果 libvips 已经结束、Promise
    // 监听器已经撤下，destroy(error) 会转成未捕获的 EventEmitter error，进而弹出
    // Electron 主进程错误框。Promise 的 catch 会根据 signal 统一映射为 AbortError。
    pipeline.destroy()
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
