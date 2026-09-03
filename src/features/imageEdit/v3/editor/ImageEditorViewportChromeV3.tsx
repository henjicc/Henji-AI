import { Minus, Plus } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'

interface ImageEditorViewportChromeV3Props {
  horizontalSnapGuideRef: RefObject<HTMLDivElement>
  verticalSnapGuideRef: RefObject<HTMLDivElement>
  zoom: number
  onZoomChange(zoom: number): void
}

export function ImageEditorViewportChromeV3({
  horizontalSnapGuideRef,
  verticalSnapGuideRef,
  zoom,
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
      <div
        data-viewport-control
        className="ui-glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1"
      >
        <UiIconButton
          className="h-8 w-8 text-white hover:text-white"
          showBorder={false}
          appearance="hover-only"
          aria-label={t('imageEditor.v3.zoomOut')}
          title={t('imageEditor.v3.zoomOut')}
          disabled={zoom <= 0.05}
          onClick={() => onZoomChange(zoom / 1.25)}
        >
          <Minus className="h-4 w-4" />
        </UiIconButton>
        <span className="w-14 text-center text-xs tabular-nums text-white">
          {Math.round(zoom * 100)}%
        </span>
        <UiIconButton
          className="h-8 w-8 text-white hover:text-white"
          showBorder={false}
          appearance="hover-only"
          aria-label={t('imageEditor.v3.zoomIn')}
          title={t('imageEditor.v3.zoomIn')}
          disabled={zoom >= 8}
          onClick={() => onZoomChange(zoom * 1.25)}
        >
          <Plus className="h-4 w-4" />
        </UiIconButton>
      </div>
    </>
  )
}
