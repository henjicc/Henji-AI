import { useEffect, useRef } from 'react'

interface ImageEditorReleasableResultV3 {
  release(): void
}

/**
 * 渲染 Hook 持有成品租约，显示组件只读取成品。
 *
 * 结果被替换后延迟到本次 React commit 结束再释放旧结果；开发环境 StrictMode
 * 的 setup → cleanup → setup 会撤销临时 cleanup，避免第二次绘制拿到 detached bitmap。
 */
export function useImageEditorResultLeaseV3<T extends ImageEditorReleasableResultV3>(
  result: T | null,
): void {
  const pendingReleasesRef = useRef(new Map<T, symbol>())

  useEffect(() => {
    if (!result) return
    const pendingReleases = pendingReleasesRef.current
    pendingReleases.delete(result)
    return () => {
      const token = Symbol('image-editor-result-release')
      pendingReleases.set(result, token)
      queueMicrotask(() => {
        if (pendingReleases.get(result) !== token) return
        pendingReleases.delete(result)
        result.release()
      })
    }
  }, [result])
}
