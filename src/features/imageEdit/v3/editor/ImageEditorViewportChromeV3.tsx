import { Maximize, Minus, Plus } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton } from '@/components/ui'
import { UI_TEXT_NUMERIC_CLASS } from '@/components/ui/styleTokens'

interface ImageEditorViewportChromeV3Props {
  horizontalSnapGuideRef: RefObject<HTMLDivElement>
  verticalSnapGuideRef: RefObject<HTMLDivElement>
  zoom: number
  displayZoom: number
  onViewportPreset(preset: 'fit' | 'actual'): void
  onZoomChange(zoom: number): void
}

export function ImageEditorViewportChromeV3({
  horizontalSnapGuideRef,
  verticalSnapGuideRef,
  zoom,
  displayZoom,
  onViewportPreset,
  onZoomChange,
}: ImageEditorViewportChromeV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  return (
    <>
      <div
        ref={verticalSnapGuideRef}
        data-snap-guide-axis="x"
        className="pointer-events-none absolute z-raised w-px -translate-x-1/2 bg-accent"
        style={{ visibility: 'hidden' }}
 />
      <div
        ref={horizontalSnapGuideRef}
        data-snap-guide-axis="y"
        className="pointer-events-none absolute z-raised h-px -translate-y-1/2 bg-accent"
        style={{ visibility: 'hidden' }}
 />
      {/* 浮在画面上的一条缩放条（与画布缩放条同一种）：缩小、比例、放大、适应窗口、1:1 */}
      {/* data-layout-pinned：固定在画面上的缩放条，平移、缩放的画面与控制点滑到它下面属于正常（重要记录 020） */}
      <div
        data-viewport-control
        data-layout-pinned
        className="ui-glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-0.5"
      >
        <UiIconButton size="sm"
          aria-label={t('imageEditor.v3.zoomOut')}
          tooltip={t('imageEditor.v3.zoomOut')}
          disabled={zoom <= 0.05}
          onClick={() => onZoomChange(zoom / 1.25)}
        >
          <Minus />
        </UiIconButton>
        <span className={`w-12 text-center text-xs text-text1 ${UI_TEXT_NUMERIC_CLASS}`}>{Math.round(displayZoom * 100)}%</span>
        <UiIconButton size="sm"
          aria-label={t('imageEditor.v3.zoomIn')}
          tooltip={t('imageEditor.v3.zoomIn')}
          disabled={zoom >= 8}
          onClick={() => onZoomChange(zoom * 1.25)}
        >
          <Plus />
        </UiIconButton>
        <UiIconButton size="sm" aria-label={t('imageEditor.v3.fitWindow')} tooltip={`${t('imageEditor.v3.fitWindow')} (Ctrl+0)`}
          onClick={() => onViewportPreset('fit')}>
          <Maximize />
        </UiIconButton>
        <UiButton size="sm" aria-label={t('imageEditor.v3.actualSize')} tooltip={`${t('imageEditor.v3.actualSize')} (Ctrl+1)`}
          onClick={() => onViewportPreset('actual')}>
          1:1
        </UiButton>
      </div>
    </>
  )
}
