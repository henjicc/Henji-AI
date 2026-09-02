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
  let destroyed = false
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    pipeline.destroy()
  }
  if (signal?.aborted) {
    destroy()
    throw imageSourceAbortError()
  }
  const onAbort = (): void => {
    // 不把 AbortError 注入 Sharp 的 Stream 错误通道：如果 libvips 已经结束、Promise
    // 监听器已经撤下，destroy(error) 会转成未捕获的 EventEmitter error，进而弹出
    // Electron 主进程错误框。Promise 的 catch 会根据 signal 统一映射为 AbortError。
    destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw imageSourceAbortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    // Windows 会阻止删除仍被 libvips 管线持有的源文件。单次 pass 的结果已完全落入
    // Buffer/metadata 后立即销毁管线，既释放原生资源，也让资源租约真正覆盖句柄寿命。
    destroy()
  }
}
