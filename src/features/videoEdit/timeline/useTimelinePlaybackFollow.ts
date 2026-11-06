import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { subscribeVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { timelineFollowScrollLeft, timelineHeaderWidthOf } from './timelineGeometry'

/**
 * 播放中手动滚动后，停手多久把时间线带回播放头。PR 的自动滚动最终总会回到播放头，但它当场就把手动滚动拉回去，
 * 滚轮像失灵一样；这里等用户停手再回去。
 */
const MANUAL_SCROLL_RESUME_MS = 2000

interface Options {
  instance: VideoEditInstance
  viewport: RefObject<HTMLElement>
  pixels: number
  duration: number
  /** 跟随写入的滚动位置，时间线据此区分跟随和手动滚动；没在跟随时为 null。 */
  followedLeft: MutableRefObject<number | null>
  /** 跟随结束：时间线把渲染窗口收回实际可见区。 */
  onSettled: () => void
}

/**
 * 播放时让时间线跟着播放头滚动。挂在视图通知上直接写 scrollLeft，不经过 React：播放头每帧都动，
 * 这里不能带着整条时间线重渲染，时间线只在渲染窗口走到头时才更新（见 VideoEditTimelineCanvas 的 readViewport）。
 */
export function useTimelinePlaybackFollow(options: Options): void {
  const latest = useRef(options); latest.current = options
  useEffect(() => {
    let seenLeft: number | null = null; let seenPixels = 0; let manualAt = -Infinity
    // 时间线里各种块有自己的拖动手势，缩放滚动条在视口外面：按住期间内容不能被滚走，统一看指针有没有按在时间线这一块。
    let pressed = false
    const press = (event: PointerEvent): void => { pressed = !!latest.current.viewport.current?.parentElement?.contains(event.target as Node | null) }
    const lift = (): void => { pressed = false }
    // 时间线可能在单独的浮窗里；指针移出窗口松开时收不到抬起，失焦也算松开。
    const owner = latest.current.viewport.current?.ownerDocument.defaultView ?? window
    owner.addEventListener('pointerdown', press, true); owner.addEventListener('pointerup', lift, true); owner.addEventListener('pointercancel', lift, true); owner.addEventListener('blur', lift)
    const unsubscribe = subscribeVideoEditView(() => {
      const { instance, viewport, pixels, duration, followedLeft, onSettled } = latest.current
      const host = viewport.current
      if (!host || !instance.playing || instance.scrubbing || !useSettingsStore.getState().videoEditTimelineAutoScroll) {
        if (seenLeft !== null) { seenLeft = null; manualAt = -Infinity; followedLeft.current = null; onSettled() }
        return
      }
      const now = performance.now()
      // 上次之后位置变了又不是这里写的，就是用户在滚（滚轮、手型、缩放滚动条）。缩放换算出来的位置不算：缩放时播放头照样留在中间。
      if (pressed || seenLeft !== null && host.scrollLeft !== seenLeft && pixels === seenPixels) manualAt = now
      seenLeft = host.scrollLeft; seenPixels = pixels
      if (now - manualAt < MANUAL_SCROLL_RESUME_MS) { followedLeft.current = null; return }
      const trackWidth = host.clientWidth - timelineHeaderWidthOf(host)
      if (trackWidth <= 0) return
      const next = timelineFollowScrollLeft({ frame: instance.frame, pixels, durationFrames: duration, scrollLeft: host.scrollLeft, trackWidth, direction: instance.playbackDirection })
      if (next === host.scrollLeft) return
      host.scrollLeft = next
      // 读回实际位置：浏览器会按设备像素取整，也可能被内容宽度夹住
      followedLeft.current = seenLeft = host.scrollLeft
    })
    return () => {
      unsubscribe()
      owner.removeEventListener('pointerdown', press, true); owner.removeEventListener('pointerup', lift, true); owner.removeEventListener('pointercancel', lift, true); owner.removeEventListener('blur', lift)
    }
  }, [])
}
