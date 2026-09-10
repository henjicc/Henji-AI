import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiError, UiLoading } from '@/components/ui'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { CropOverlayBox } from '@/features/imageMark/editor/CropOverlayBox'
import { marginsToRect, rectToMargins, resolveOutpaintMargins, type OutpaintImageSize, type OutpaintMargins } from '../../domain/outpaintGeometry'

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
  // 只在保存或节点尺寸改变时重新适配；拖动过程中比例固定，避免框追着指针缩放。
  const scale = image && saved ? Math.max(0.001, Math.min(
    (viewport.width - 48) / (image.width + 2 * Math.max(saved.expandLeft, saved.expandRight, image.width * 0.25)),
    (viewport.height - 48) / (image.height + 2 * Math.max(saved.expandTop, saved.expandBottom, image.height * 0.25)),
  )) : 1
  const imageRect = image ? {
    x: (viewport.width / scale - image.width) / 2,
    y: (viewport.height / scale - image.height) / 2,
    ...image,
  } : null
  const margins = draft ?? saved
  const crop = margins && imageRect ? marginsToRect(margins, imageRect) : null
  return (
    <div ref={host} className="relative min-h-0 w-full flex-1 overflow-hidden" data-outpaint-stage>
      {failed ? <UiError message={t('node.outpaint.loadFailed')} /> : !image && <UiLoading />}
      {crop && <div className="pointer-events-none absolute image-editor-transparency-grid"
        style={{ left: crop.x * scale, top: crop.y * scale, width: crop.width * scale, height: crop.height * scale }} />}
      <img
        src={resolveImageDisplayUrl(source)} alt="" draggable={false}
        className="pointer-events-none absolute select-none"
        style={imageRect ? { left: imageRect.x * scale, top: imageRect.y * scale, width: imageRect.width * scale, height: imageRect.height * scale } : { visibility: 'hidden' }}
        onLoad={event => { setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFailed(false) }}
        onError={() => setFailed(true)}
      />
      {!failed && imageRect && crop && <>
        <CropOverlayBox
          displayWidth={viewport.width} displayHeight={viewport.height} scale={scale}
          crop={crop} imageWidth={viewport.width / scale} imageHeight={viewport.height / scale}
          ratio={null} appearance="expand"
          constrainRect={rect => marginsToRect(rectToMargins(rect, imageRect, maximum), imageRect)}
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
