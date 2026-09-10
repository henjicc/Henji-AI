import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiError, UiLoading } from '@/components/ui'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { CropOverlayBox } from '@/features/imageMark/editor/CropOverlayBox'
import { constrainOutpaintRect, fitOutpaintView, zoomOutpaintView, marginsToRect, rectToMargins, resolveOutpaintMargins, type OutpaintImageSize, type OutpaintMargins } from '../../domain/outpaintGeometry'

interface Props {
  source: string
  params: Record<string, unknown>
  maximum: number
  onCommit: (margins: OutpaintMargins) => void
}

export const OutpaintStage = memo(function OutpaintStage({ source, params, maximum, onCommit }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 400, height: 350 })
  const [image, setImage] = useState<OutpaintImageSize | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<OutpaintMargins | null>(null)
  const [zoom, setZoom] = useState(1)
  const draftRef = useRef<OutpaintMargins | null>(null)
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setViewport(current => current.width === width && current.height === height ? current : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const saved = image ? resolveOutpaintMargins(params, image, maximum) : null
  const imageRect = image ? { x: 0, y: 0, ...image } : null
  const margins = draft ?? saved
  const crop = margins && imageRect ? marginsToRect(margins, imageRect) : null
  const view = image ? fitOutpaintView(image, viewport, maximum, zoom) : { scale: 1, x: 0, y: 0 }
  const wheelRef = useRef<(event: WheelEvent) => void>()
  wheelRef.current = event => {
    event.preventDefault()
    event.stopPropagation()
    if (!image || !margins || event.buttons) return
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1)
    setZoom(current => zoomOutpaintView(current, delta, image, margins, viewport, maximum))
  }
  useEffect(() => {
    const element = host.current
    if (!element) return
    const wheel = (event: WheelEvent) => wheelRef.current?.(event)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const { scale } = view
  return (
    <div ref={host} className="nowheel relative min-h-0 w-full flex-1 overflow-hidden" data-outpaint-stage>
      {failed ? <UiError message={t('node.outpaint.loadFailed')} /> : !image && <UiLoading />}
      {crop && <div className="pointer-events-none absolute image-editor-transparency-grid"
        style={{ left: crop.x * scale + view.x, top: crop.y * scale + view.y, width: crop.width * scale, height: crop.height * scale }} />}
      <img
        src={resolveImageDisplayUrl(source)} alt="" draggable={false}
        className="pointer-events-none absolute select-none"
        style={imageRect ? { left: view.x, top: view.y, width: imageRect.width * scale, height: imageRect.height * scale } : { visibility: 'hidden' }}
        onLoad={event => { setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFailed(false) }}
        onError={() => setFailed(true)}
      />
      {!failed && imageRect && crop && <>
        <CropOverlayBox
          displayWidth={viewport.width} displayHeight={viewport.height} scale={scale}
          crop={crop} offset={view} imageWidth={viewport.width / scale} imageHeight={viewport.height / scale}
          ratio={null} appearance="expand"
          constrainRect={(rect, handle) => constrainOutpaintRect(rect, imageRect, maximum, handle === 'move', {
            x: (viewport.width - 48) / (2 * scale) - imageRect.width / 2,
            y: (viewport.height - 64) / (2 * scale) - imageRect.height / 2,
          })}
          onChange={rect => {
            const next = rectToMargins(rect, imageRect, maximum)
            draftRef.current = next
            setDraft(next)
          }}
          onCommit={() => {
            if (draftRef.current) onCommit(draftRef.current)
            draftRef.current = null
            setDraft(null)
          }}
        />
        <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-raised text-center text-xs text-text-muted">
          {Math.round(crop.width)} × {Math.round(crop.height)}
        </div>
      </>}
    </div>
  )
})
