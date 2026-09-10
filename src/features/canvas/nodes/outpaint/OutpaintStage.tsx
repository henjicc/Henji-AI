import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiError, UiLoading } from '@/components/ui'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { CropOverlayBox } from '@/features/imageMark/editor/CropOverlayBox'
import { createOutpaintScene, moveOutpaintImage, outpaintSceneToMargins, resizeOutpaintFrame, resolveOutpaintMargins, zoomOutpaintImage, type OutpaintImageSize, type OutpaintMargins, type OutpaintScene } from '../../domain/outpaintGeometry'

interface Props {
  source: string
  params: Record<string, unknown>
  maximum: number
  onCommit: (margins: OutpaintMargins) => void
  onAspectRatio: (ratio: number) => void
}

export const OutpaintStage = memo(function OutpaintStage({ source, params, maximum, onCommit, onAspectRatio }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 400, height: 350 })
  const [image, setImage] = useState<OutpaintImageSize | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<{ scene: OutpaintScene; paramsKey: string; sizeKey: string } | null>(null)
  const committedKey = useRef('')
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>()
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setViewport(current => current.width === width && current.height === height ? current : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const saved = image ? resolveOutpaintMargins(params, image, maximum) : null
  const paramsKey = JSON.stringify(saved)
  const sizeKey = `${viewport.width}:${viewport.height}`
  const scene = draft && draft.sizeKey === sizeKey && (draft.paramsKey === paramsKey || committedKey.current === paramsKey)
    ? draft.scene : image && saved ? createOutpaintScene(image, viewport, saved, maximum) : null
  const latestScene = useRef(scene)
  latestScene.current = scene
  const update = (next: OutpaintScene) => {
    latestScene.current = next
    setDraft({ scene: next, paramsKey, sizeKey })
  }
  const commitRef = useRef<() => void>()
  commitRef.current = () => {
    clearTimeout(wheelTimer.current)
    wheelTimer.current = undefined
    if (!image || !latestScene.current) return
    const next = outpaintSceneToMargins(latestScene.current, image, maximum)
    committedKey.current = JSON.stringify(next)
    setDraft(current => current ? { ...current, paramsKey: committedKey.current } : current)
    onCommit(next)
  }
  const wheelRef = useRef<(event: WheelEvent) => void>()
  wheelRef.current = event => {
    event.preventDefault()
    event.stopPropagation()
    const current = latestScene.current
    if (!image || !current || event.buttons) return
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1)
    update({ ...current, image: zoomOutpaintImage(current, delta, image, maximum) })
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => commitRef.current?.(), 150)
  }
  useEffect(() => {
    const element = host.current
    if (!element) return
    const wheel = (event: WheelEvent) => wheelRef.current?.(event)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      if (wheelTimer.current) commitRef.current?.()
    }
  }, [])
  return (
    <div ref={host} className="nowheel relative min-h-0 w-full flex-1 overflow-hidden" data-outpaint-stage
      onMouseLeave={() => { if (wheelTimer.current) commitRef.current?.() }}>
      {failed ? <UiError message={t('node.outpaint.loadFailed')} /> : !image && <UiLoading />}
      {scene && <div className="pointer-events-none absolute image-editor-transparency-grid"
        style={{ left: scene.frame.x, top: scene.frame.y, width: scene.frame.width, height: scene.frame.height }} />}
      <img src={resolveImageDisplayUrl(source)} alt="" draggable={false}
        className="pointer-events-none absolute select-none"
        style={scene ? { left: scene.image.x, top: scene.image.y, width: scene.image.width, height: scene.image.height } : { visibility: 'hidden' }}
        onLoad={event => {
          const width = event.currentTarget.naturalWidth
          const height = event.currentTarget.naturalHeight
          setImage({ width, height })
          onAspectRatio((width + maximum * 2) / (height + maximum * 2))
          setFailed(false)
        }}
        onError={() => setFailed(true)} />
      {!failed && image && scene && <CropOverlayBox
        displayWidth={viewport.width} displayHeight={viewport.height} scale={1}
        crop={scene.frame} moveTarget={scene.image} imageWidth={viewport.width} imageHeight={viewport.height}
        ratio={null} appearance="expand"
        constrainRect={(rect, handle) => handle === 'move'
          ? moveOutpaintImage(rect, latestScene.current!.frame, image, maximum)
          : resizeOutpaintFrame(rect, latestScene.current!.image, image, viewport, maximum)}
        onChange={(rect, handle) => {
          clearTimeout(wheelTimer.current)
          wheelTimer.current = undefined
          update({ ...latestScene.current!, [handle === 'move' ? 'image' : 'frame']: rect })
        }}
        onCommit={() => commitRef.current?.()} />}
    </div>
  )
})
