import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { findGeneratedCoverSources, updateCanvasProjectCover } from './canvasProjectCover'
import { isUiInspectionReadOnly } from '@/platform/runtime'

/** 新生成图片落盘后尽快刷新；纯节点布局变化等到用户停手，避免拖拽期间反复截图。 */
const GENERATED_MEDIA_DEBOUNCE_MS = 240
const CANVAS_CAPTURE_DEBOUNCE_MS = 1_600

/**
 * 工程封面自动保存：内容变化后低频刷新，并在页面进入后台时立即补一次。
 *
 * 这样封面平时就已经落盘，应用关闭不再依赖用户先点击“返回项目”；返回按钮仍会执行
 * 一次同步补刷新，覆盖刚生成完就立即离开的极端时序。
 */
export function useCanvasProjectCoverAutosave(projectId: string | null): void {
  const timerRef = useRef<number | null>(null)
  const lastSavedMediaSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectId || isUiInspectionReadOnly()) return
    let disposed = false

    const clearTimer = (): void => {
      if (timerRef.current === null) return
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const runUpdate = async (): Promise<void> => {
      clearTimer()
      if (disposed) return
      const sources = findGeneratedCoverSources(useCanvasStore.getState().nodes)
      const signature = sources.map((item) => item.source).join('\n')
      if (signature && signature === lastSavedMediaSignatureRef.current) return
      await updateCanvasProjectCover(projectId)
      if (!disposed && signature) lastSavedMediaSignatureRef.current = signature
    }

    const scheduleUpdate = (): void => {
      const sources = findGeneratedCoverSources(useCanvasStore.getState().nodes)
      const signature = sources.map((item) => item.source).join('\n')
      if (signature && signature === lastSavedMediaSignatureRef.current) return
      clearTimer()
      timerRef.current = window.setTimeout(
        () => { void runUpdate() },
        sources.length > 0 ? GENERATED_MEDIA_DEBOUNCE_MS : CANVAS_CAPTURE_DEBOUNCE_MS,
      )
    }

    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') void runUpdate()
    }

    scheduleUpdate()
    const unsubscribe = useCanvasStore.subscribe(scheduleUpdate)
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', runUpdate)

    return () => {
      disposed = true
      clearTimer()
      unsubscribe()
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', runUpdate)
    }
  }, [projectId])
}
