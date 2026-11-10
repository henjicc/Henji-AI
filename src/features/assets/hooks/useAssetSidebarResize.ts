import { UI_PANEL_WIDTH } from '@/core/theme/panelSizes'
import { useEffect, useState } from 'react'

export const ASSET_SIDEBAR_MIN_WIDTH = UI_PANEL_WIDTH.sidebar.min
export const ASSET_SIDEBAR_MAX_WIDTH = UI_PANEL_WIDTH.sidebar.max
const ASSET_SIDEBAR_DEFAULT_WIDTH = UI_PANEL_WIDTH.sidebar.default

function viewportMaxWidth(viewportWidth: number): number {
  return Math.round(Math.max(ASSET_SIDEBAR_MIN_WIDTH, Math.min(ASSET_SIDEBAR_MAX_WIDTH, viewportWidth * 0.3)))
}

export function clampAssetSidebarWidth(width: number, viewportWidth: number): number {
  return Math.round(Math.min(viewportMaxWidth(viewportWidth), Math.max(ASSET_SIDEBAR_MIN_WIDTH, width)))
}

/** 侧栏宽度与它当前能拖到的范围，交给 UiResizeHandle 使用。 */
export function useAssetSidebarResize(): {
  width: number
  min: number
  max: number
  setWidth: (width: number) => void
} {
  // 记住用户拖出的宽度，只在显示时按视口夹紧：窗口缩小再放大后恢复原宽度。
  const [preferredWidth, setWidth] = useState<number>(ASSET_SIDEBAR_DEFAULT_WIDTH)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const handleViewportResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  return {
    width: clampAssetSidebarWidth(preferredWidth, viewportWidth),
    min: ASSET_SIDEBAR_MIN_WIDTH,
    max: viewportMaxWidth(viewportWidth),
    setWidth,
  }
}
