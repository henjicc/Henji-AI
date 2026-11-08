import { useCallback, useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react'
import { UI_DURATION, UI_EASE_STACK } from '@/components/ui/motion'

/**
 * FLIP 位移过渡：布局要变之前调用 `capture()` 记下根元素里所有 `[data-flip-key]` 的位置，
 * 依赖变化后的那一帧把它们反向移回旧位置，再用 Web Animations 滑到新位置。
 *
 * 只动 translate，不缩放：宽度变化（例如输入框让出左侧位置）直接到位，避免文字和图片在过渡中被拉伸。
 * 位置取屏幕坐标：输入卡片这类贴底、向上长高的容器里，没动的元素不会被误判成位移。
 * 没有 capture 的依赖变化不做过渡；快照两秒内没被用掉就作废（例如上传被拒绝），免得之后别的变化拿旧位置做起点。
 * 系统减少动态效果时直接到位。
 */
const FLIP_SNAPSHOT_TTL_MS = 2000

export function useFlipTransition(
  rootRef: RefObject<HTMLElement>,
  deps: DependencyList,
  durationMs: number = UI_DURATION.slow,
): () => void {
  const snapshotRef = useRef<{ takenAt: number; rects: Map<string, { left: number; top: number }> } | null>(null)

  const capture = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const snapshot = new Map<string, { left: number; top: number }>()
    root.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => {
      const rect = element.getBoundingClientRect()
      snapshot.set(element.dataset.flipKey as string, { left: rect.left, top: rect.top })
    })
    snapshotRef.current = { takenAt: performance.now(), rects: snapshot }
  }, [rootRef])

  useLayoutEffect(() => {
    const snapshot = snapshotRef.current
    snapshotRef.current = null
    const root = rootRef.current
    if (!snapshot || !root || performance.now() - snapshot.takenAt > FLIP_SNAPSHOT_TTL_MS) return
    const before = snapshot.rects
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    root.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => {
      const previous = before.get(element.dataset.flipKey as string)
      if (!previous) return
      const rect = element.getBoundingClientRect()
      const dx = previous.left - rect.left
      const dy = previous.top - rect.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      element.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }],
        { duration: durationMs, easing: UI_EASE_STACK },
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖由调用方给出：只在这些值变化时消费快照
  }, deps)

  return capture
}
