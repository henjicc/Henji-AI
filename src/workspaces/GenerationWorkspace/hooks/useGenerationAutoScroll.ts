import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import { useAutoScrollOnResize } from './useAutoScrollOnResize'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 记录列表停在“最新那一端”：最新在下时贴住底部，最新在上时贴住顶部。用户滚离这一端后不再拉回，
 * 回到这一端后继续跟随。新记录出现时平滑滚过去；平滑滚动期间卡片测高、图片载入引起的尺寸变化
 * 把目标改到新的末端继续平滑滚，不打断成一次硬跳。
 */
export function useGenerationAutoScroll(isTasksLoaded: boolean, taskCount: number, newestTaskId: string | undefined, newestFirst: boolean): {
  listContainerRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  isAtNewestEdge: () => boolean
} {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const isUserAtNewest = useRef(true)
  const lastPosition = useRef({ top: 0, height: 0 })
  const smoothing = useRef(false)
  const newestFirstRef = useRef(newestFirst)
  newestFirstRef.current = newestFirst
  const shouldAutoScroll = useCallback(() => isUserAtNewest.current, [])
  const isAtNewestEdge = useCallback(() => isUserAtNewest.current, [])
  const scrollToNewest = useCallback((smooth = false): void => {
    const element = listContainerRef.current
    if (!element) return
    const target = newestFirstRef.current ? 0 : element.scrollHeight - element.clientHeight
    if ((smooth || smoothing.current) && !prefersReducedMotion() && Math.abs(element.scrollTop - target) > 1) {
      smoothing.current = true
      element.scrollTo({ top: target, behavior: 'smooth' })
      return
    }
    smoothing.current = false
    element.scrollTop = target
    lastPosition.current = { top: element.scrollTop, height: element.scrollHeight }
  }, [])
  const followResize = useCallback(() => scrollToNewest(), [scrollToNewest])
  const contentRef = useAutoScrollOnResize(shouldAutoScroll, followResize)

  useEffect(() => {
    const element = listContainerRef.current
    if (!element) return
    const update = () => {
      const threshold = 8
      const { scrollTop: top, scrollHeight: height, clientHeight } = element
      const distance = newestFirstRef.current ? top : height - clientHeight - top
      if (distance <= threshold) isUserAtNewest.current = true
      // 虚拟卡片测量/媒体载入也会触发 scroll；内容变高不代表用户离开最新一端。
      // 只有尺寸不变、且不在自动平滑滚动中时，真正朝远离最新一端滚动才解除跟随。
      else if (!smoothing.current && height === lastPosition.current.height
        && (newestFirstRef.current ? top > lastPosition.current.top : top < lastPosition.current.top)) isUserAtNewest.current = false
      lastPosition.current = { top, height }
    }
    const settle = () => { smoothing.current = false }
    update()
    element.addEventListener('scroll', update)
    element.addEventListener('scrollend', settle)
    // 用户自己动滚轮、拖滚动条或按键滚动时让出控制
    element.addEventListener('wheel', settle, { passive: true })
    element.addEventListener('pointerdown', settle)
    element.addEventListener('keydown', settle)
    return () => {
      element.removeEventListener('scroll', update)
      element.removeEventListener('scrollend', settle)
      element.removeEventListener('wheel', settle)
      element.removeEventListener('pointerdown', settle)
      element.removeEventListener('keydown', settle)
    }
  }, [])
  // 首次载入与切换排列方向：直接停到最新一端
  useLayoutEffect(() => {
    if (isTasksLoaded) {
      isUserAtNewest.current = true
      scrollToNewest()
    }
  }, [isTasksLoaded, newestFirst, scrollToNewest])
  const previous = useRef({ count: taskCount, newestId: newestTaskId })
  const previousHeight = useRef(0)
  useLayoutEffect(() => {
    const element = listContainerRef.current
    const added = taskCount - previous.current.count
    // 只有最新一条换了人、且只多了几条，才是新生成的记录落在最新一端；打开“包含画布生成”这类一次插进
    // 很多条、散落在各处的变化不算
    const newRecord = added > 0 && added <= 3 && newestTaskId !== previous.current.newestId
    previous.current = { count: taskCount, newestId: newestTaskId }
    if (!element || !isTasksLoaded || !newRecord) return
    if (isUserAtNewest.current) scrollToNewest(true)
    // 最新在上而用户正往下看旧记录：顶上插进来的记录把内容往下推，补回同样的距离，眼前的卡片不动
    else if (newestFirstRef.current) element.scrollTop += element.scrollHeight - previousHeight.current
  }, [isTasksLoaded, newestTaskId, scrollToNewest, taskCount])
  // 每次提交后记下内容高度，供下一次插入时计算被推开的距离（必须排在上面的插入处理之后）
  useLayoutEffect(() => {
    previousHeight.current = listContainerRef.current?.scrollHeight ?? 0
  })

  return { listContainerRef, contentRef, isAtNewestEdge }
}
