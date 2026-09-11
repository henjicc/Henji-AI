import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiError, UiLoading } from '@/components/ui'
import { UI_OUTPAINT_FEATHER_MASK } from '@/components/ui/styleTokens'
import { createLogger } from '@/core/logging'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { CropOverlayBox } from '@/features/imageMark/editor/CropOverlayBox'
import { createOutpaintScene, moveOutpaintImage, outpaintSceneToMargins, resizeOutpaintScene, resolveOutpaintMargins, zoomOutpaintImage, type OutpaintImageSize, type OutpaintMargins, type OutpaintScene } from '../../domain/outpaintGeometry'
import { getOutpaintPreview, OUTPAINT_PREVIEW_SLICE } from './outpaintPreviewTexture'

const logger = createLogger('features.canvas.outpaint')

interface Props {
  source: string
  params: Record<string, unknown>
  maximum: number
  onCommit: (margins: OutpaintMargins) => void
  onSourceAspectRatio: (aspect: number) => void
}

export const OutpaintStage = memo(function OutpaintStage({ source, params, maximum, onCommit, onSourceAspectRatio }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<OutpaintImageSize | null>(null)
  const [preview, setPreview] = useState<{ source: string; texture: string } | null>(null)
  const previewTicket = useRef(0)
  useEffect(() => () => { previewTicket.current++ }, [source])
  const texture = preview?.source === source ? preview.texture : undefined
  // 固定逻辑工作面；节点缩放只由 CSS 整体变换，不测量、不重排内部图框。
  const viewport = { width: image ? 600 * image.width / image.height : 600, height: 600 }
  const [failed, setFailed] = useState(false)
  const [corsFallback, setCorsFallback] = useState('')
  const displaySource = resolveImageDisplayUrl(source)
  type Snapshot = { scene: OutpaintScene; paramsKey: string; viewport: OutpaintImageSize }
  const [draft, setDraft] = useState<Snapshot | null>(null)
  const baseline = useRef<Snapshot | null>(null)
  const committedKey = useRef('')
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>()
  const saved = image ? resolveOutpaintMargins(params, image, maximum) : null
  const paramsKey = JSON.stringify(saved)
  const snapshot = draft && (draft.paramsKey === paramsKey || committedKey.current === paramsKey)
    ? draft : baseline.current?.paramsKey === paramsKey ? baseline.current : null
  const scene = snapshot ? snapshot.scene
    : image && saved && viewport.width > 0 && viewport.height > 0 ? createOutpaintScene(image, viewport, saved, maximum) : null
  useLayoutEffect(() => {
    if (scene && baseline.current?.paramsKey !== paramsKey) baseline.current = { scene, paramsKey, viewport }
  })
  const latestScene = useRef(scene)
  latestScene.current = scene
  const update = (next: OutpaintScene) => {
    latestScene.current = next
    setDraft({ scene: next, paramsKey, viewport })
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
    const nextImage = zoomOutpaintImage(current, delta, image, maximum, { x: 0, y: 0, ...viewport })
    if (Math.abs(nextImage.width - current.image.width) < 1e-7) return
    update({ ...current, image: nextImage })
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
    <div ref={host} className="nowheel relative min-h-0 w-full flex-1 overflow-hidden" data-outpaint-stage style={{ containerType: 'size' }}
      onMouseLeave={() => { if (wheelTimer.current) commitRef.current?.() }}>
      {failed ? <UiError message={t('node.outpaint.loadFailed')} /> : !image && <UiLoading />}
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: viewport.width, height: viewport.height, transform: `scale(calc(100cqw / ${viewport.width}px))` }}>
      {scene && <div className={`pointer-events-none absolute ${texture ? 'border-solid border-transparent' : 'image-editor-transparency-grid'}`}
        data-outpaint-preview={texture ? 'ready' : 'pending'}
        style={{ left: scene.frame.x, top: scene.frame.y, width: scene.frame.width, height: scene.frame.height,
          ...(texture ? {
            borderTopWidth: Math.max(0, scene.image.y - scene.frame.y),
            borderRightWidth: Math.max(0, scene.frame.x + scene.frame.width - scene.image.x - scene.image.width),
            borderBottomWidth: Math.max(0, scene.frame.y + scene.frame.height - scene.image.y - scene.image.height),
            borderLeftWidth: Math.max(0, scene.image.x - scene.frame.x),
            borderImageSource: `url("${texture}")`, borderImageSlice: `${OUTPAINT_PREVIEW_SLICE} fill`, borderImageRepeat: 'stretch',
          } : {}),
        }} />}
      <img src={displaySource} crossOrigin={corsFallback !== displaySource && /^(?:https?:|asset:|henji-media:)/i.test(displaySource) ? 'anonymous' : undefined} alt="" draggable={false}
        className="pointer-events-none absolute select-none"
        style={scene ? { left: scene.image.x, top: scene.image.y, width: scene.image.width, height: scene.image.height,
          ...(texture ? { maskImage: UI_OUTPAINT_FEATHER_MASK, maskComposite: 'intersect' } : {}),
        } : { visibility: 'hidden' }}
        onLoad={event => {
          const width = event.currentTarget.naturalWidth
          const height = event.currentTarget.naturalHeight
          setImage({ width, height })
          onSourceAspectRatio(width / height)
          setFailed(false)
          const ticket = ++previewTicket.current
          void getOutpaintPreview(event.currentTarget).then(value => {
            if (ticket === previewTicket.current) setPreview({ source, texture: value })
          }).catch(error => {
            if (ticket === previewTicket.current) logger.warn('扩图边缘预览失败，保留透明区域提示', { event: 'outpaint.preview.failed', error })
          })
        }}
        onError={event => {
          if (event.currentTarget.crossOrigin) setCorsFallback(displaySource)
          else setFailed(true)
        }} />
      {!failed && image && scene && <CropOverlayBox
        displayWidth={viewport.width} displayHeight={viewport.height} scale={1}
        crop={scene.frame} moveTarget={scene.image} imageWidth={viewport.width} imageHeight={viewport.height}
        ratio={null} appearance="expand"
        constrainRect={(rect, handle) => handle === 'move'
          ? moveOutpaintImage(rect, latestScene.current!.frame, image, maximum, { x: 0, y: 0, ...viewport })
          : resizeOutpaintScene(rect, latestScene.current!.image, image, viewport, maximum).frame}
        onChange={(rect, handle) => {
          clearTimeout(wheelTimer.current)
          wheelTimer.current = undefined
          update(handle === 'move' ? { ...latestScene.current!, image: rect }
            : resizeOutpaintScene(rect, latestScene.current!.image, image, viewport, maximum))
        }}
        onCommit={() => commitRef.current?.()} />}
      </div>
    </div>
  )
})
