import { useEffect, useRef } from 'react'

interface ImageEditorDisposableV3 {
  dispose(): void
}

/**
 * React StrictMode 会在开发环境中执行一次 setup → cleanup → setup。
 * 延迟到微任务再释放，并由紧随其后的同资源 setup 撤销释放，既保留真实卸载清理，
 * 又不会把仍由第二次 setup 使用的 Worker/缓存客户端提前销毁。
 */
export function useImageEditorDisposableV3<T extends ImageEditorDisposableV3>(resource: T): void {
  const pendingDisposalsRef = useRef(new Map<T, symbol>())

  useEffect(() => {
    const pendingDisposals = pendingDisposalsRef.current
    pendingDisposals.delete(resource)
    return () => {
      const token = Symbol('image-editor-disposal')
      pendingDisposals.set(resource, token)
      queueMicrotask(() => {
        if (pendingDisposals.get(resource) !== token) return
        pendingDisposals.delete(resource)
        resource.dispose()
      })
    }
  }, [resource])
}
