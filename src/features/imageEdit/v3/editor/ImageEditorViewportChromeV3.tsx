import { Minus, Plus } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton } from '@/components/ui'

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
      {/* 压在画面上的缩放条：媒体叠层固定令牌（不随主题），三段同高 28 */}
      <div
        data-viewport-control
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1"
      >
        <UiIconButton tone="media"
          aria-label={t('imageEditor.v3.zoomOut')}
          title={t('imageEditor.v3.zoomOut')}
          disabled={zoom <= 0.05}
          onClick={() => onZoomChange(zoom / 1.25)}
        >
          <Minus className="h-4 w-4" />
        </UiIconButton>
        <span className="flex h-7 w-14 items-center justify-center rounded-md bg-media-control text-xs tabular-nums text-on-media">
          {Math.round(displayZoom * 100)}%
        </span>
        <UiIconButton tone="media"
          aria-label={t('imageEditor.v3.zoomIn')}
          title={t('imageEditor.v3.zoomIn')}
          disabled={zoom >= 8}
          onClick={() => onZoomChange(zoom * 1.25)}
        >
          <Plus className="h-4 w-4" />
        </UiIconButton>
        <UiButton variant="media" size="sm" title={`${t('imageEditor.v3.fitWindow')} (Ctrl+0)`}
          onClick={() => onViewportPreset('fit')}>
          {t('imageEditor.v3.fitWindow')}
        </UiButton>
        <UiButton variant="media" size="sm" title={`${t('imageEditor.v3.actualSize')} (Ctrl+1)`}
          onClick={() => onViewportPreset('actual')}>
          {t('imageEditor.v3.actualSize')}
        </UiButton>
      </div>
    </>
  )
}
