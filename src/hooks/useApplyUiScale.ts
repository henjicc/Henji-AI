import { useEffect, useRef } from 'react'
import { createLogger } from '@/core/logging'
import {
  resolveUiScaleFactor,
  uiScaleFactorPercent,
  type UiScaleFactor,
} from '@/core/theme/uiScale'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { useSettingsStore } from '@/stores/settingsStore'

const logger = createLogger('hooks.useApplyUiScale')
const RESIZE_DEBOUNCE_MS = 150

export function useApplyUiScale(): void {
  const mode = useSettingsStore((state) => state.uiScaleMode)
  const appliedFactorRef = useRef<UiScaleFactor | null>(null)

  useEffect(() => {
    if (!isDesktopRuntime()) return

    const windowPlatform = getPlatform().window
    let disposed = false
    let resizeTimer: number | null = null
    let requestSequence = 0

    const applyScale = async (): Promise<void> => {
      const sequence = ++requestSequence
      try {
        const contentSize = await windowPlatform.getContentSize()
        if (disposed || sequence !== requestSequence) return

        const factor = resolveUiScaleFactor(mode, contentSize)
        if (appliedFactorRef.current !== factor) {
          await windowPlatform.setZoomFactor(factor)
          if (disposed || sequence !== requestSequence) return
          appliedFactorRef.current = factor
        }
        document.documentElement.dataset.uiScale = String(uiScaleFactorPercent(factor))
      } catch (error) {
        if (disposed || sequence !== requestSequence) return
        logger.error('界面缩放应用失败，保留当前缩放比例', {
          event: 'ui.scale.apply.failed',
          error,
        })
      }
    }

    const scheduleScale = (): void => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        void applyScale()
      }, RESIZE_DEBOUNCE_MS)
    }

    void applyScale()
    const unlisten = windowPlatform.onResized(scheduleScale)

    return () => {
      disposed = true
      requestSequence += 1
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      unlisten()
    }
  }, [mode])
}
