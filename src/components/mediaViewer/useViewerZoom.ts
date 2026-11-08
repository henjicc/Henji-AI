import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { UI_DURATION, UI_EASE_ZOOM } from '@/components/ui/motion'
import { currentOriginRect, takeViewerOrigin, type ViewerOrigin } from './viewerOrigin'

type ZoomGeometry = Keyframe & { transform: string; clipPath: string }

/** 起点矩形到窗格里 object-contain 成品的反向变换：缩放到盖满起点，再裁成起点的形状与圆角。 */
function zoomFrom(pane: HTMLElement, origin: ViewerOrigin, rect: DOMRect): ZoomGeometry | null {
  // offset 尺寸不受进行中的变换影响；位置按定位父级换算。
  const parent = pane.offsetParent?.getBoundingClientRect()
  if (!parent) return null
  const box = { left: parent.left + pane.offsetLeft, top: parent.top + pane.offsetTop, width: pane.offsetWidth, height: pane.offsetHeight }
  const image = origin.element
  const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : rect.width / rect.height
  if (!box.width || !box.height || !rect.width || !rect.height || !Number.isFinite(ratio)) return null
  const fitWidth = Math.min(box.width, box.height * ratio)
  const fitHeight = fitWidth / ratio
  const scale = Math.max(rect.width / fitWidth, rect.height / fitHeight)
  const dx = rect.left + rect.width / 2 - (box.left + box.width / 2)
  const dy = rect.top + rect.height / 2 - (box.top + box.height / 2)
  const insetX = Math.max(0, (box.width - rect.width / scale) / 2)
  const insetY = Math.max(0, (box.height - rect.height / scale) / 2)
  const radius = (Number.parseFloat(getComputedStyle(image).borderTopLeftRadius) || 0) / scale
  return {
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
    clipPath: `inset(${insetY}px ${insetX}px round ${radius}px)`,
  }
}

const REST: ZoomGeometry = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px round 0px)' }
const FADE: Keyframe[] = [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }]

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 打开时从按下的缩略图放大到画面中央，关闭时缩回原处；找不到起点时轻微缩放加淡入。
 * 背景与控件由查看器外壳单独淡入，这里只管画面本身，所以画面从第一帧起就是不透明的。
 * 打开后翻到别的图，起点就不再对应当前画面，关闭改为淡出。
 */
export function useViewerZoom(open: boolean, mounted: boolean, imageUrl: string, paneRef: RefObject<HTMLElement>, enabled: boolean, atRest: () => boolean) {
  const originRef = useRef<ViewerOrigin | null>(null)
  const openedUrl = useRef<string | null>(null)
  const [placeholder, setPlaceholder] = useState<string | null>(null)
  const wasOpen = useRef(false)
  const atRestRef = useRef(atRest)
  atRestRef.current = atRest

  useLayoutEffect(() => {
    const pane = paneRef.current
    // 外壳在 open 之后的下一次渲染才挂载画面，等窗格出现再起动画。
    // 在编辑模式（不渲染画面）下被关掉，也要记下已关闭，下次打开才会重新进场。
    if (!pane) { if (!open) wasOpen.current = false; return }
    if (open && wasOpen.current && imageUrl !== openedUrl.current) {
      openedUrl.current = imageUrl
      originRef.current = null
      setPlaceholder(null)
    }
    if (open === wasOpen.current) return
    wasOpen.current = open
    const options = { duration: UI_DURATION.slow, easing: UI_EASE_ZOOM }
    if (open) {
      openedUrl.current = imageUrl
      const origin = takeViewerOrigin()
      originRef.current = origin
      setPlaceholder(origin?.src ?? null)
      if (!enabled || reducedMotion()) return
      const from = origin && zoomFrom(pane, origin, origin.rect)
      pane.animate(from ? [from, REST] : FADE, options)
      return
    }
    if (!enabled || reducedMotion()) return
    // 打开动画还没走完就关：从当前画面出发，避免先跳回中央再缩。
    const style = getComputedStyle(pane)
    const current: Keyframe = {
      transform: style.transform === 'none' ? REST.transform : style.transform,
      clipPath: style.clipPath === 'none' ? REST.clipPath : style.clipPath,
      opacity: style.opacity,
    }
    pane.getAnimations().forEach(animation => animation.cancel())
    const origin = originRef.current
    const rect = origin && atRestRef.current() ? currentOriginRect(origin) : null
    const to = origin && rect && zoomFrom(pane, origin, rect)
    // fill 保持终点直到外壳卸载，避免缩回原处后又闪回中央。
    pane.animate([current, to ?? FADE[0]], { ...options, fill: 'forwards' })
  }, [open, mounted, imageUrl, enabled, paneRef])

  useLayoutEffect(() => {
    if (!open) return
    // 重新打开时撤掉上次关闭留下的终点状态。
    paneRef.current?.getAnimations().forEach(animation => { if (animation.effect?.getTiming().fill === 'forwards') animation.cancel() })
  }, [open, paneRef])

  return { placeholder, clearPlaceholder: () => setPlaceholder(null) }
}
