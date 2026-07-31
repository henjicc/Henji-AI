import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 分节标题停靠在内容区顶部时留出的距离。
 * 必须与 `src/index.css` 里 `.settings-scroll-body` 的 `scroll-padding-top` 相等，
 * 否则「点击目录停下的位置」和「滚动时判定的当前分节」会差一截，高亮会在边界反复抖。
 */
const SECTION_ANCHOR_OFFSET = 16

/** 内容区自身的下内边距（tabs 里的 `p-4`），算尾部占位时要一起扣掉 */
const CONTENT_BOTTOM_PADDING = 16

/** `scrollend` 没触发时的兜底解除时长；比一次平滑滚动稍长即可 */
const PROGRAMMATIC_SCROLL_FALLBACK_MS = 800

export const SETTINGS_SECTION_ATTR = 'data-settings-section'

interface UseSettingsScrollSpyOptions {
  containerRef: RefObject<HTMLElement>
  /** 当前大类下的分节 id，顺序即渲染顺序；用于在结构变化后重新测量 */
  sectionIds: string[]
  onActiveSectionChange: (sectionId: string) => void
}

interface UseSettingsScrollSpyResult {
  /** 目录点击时调用；平滑滚动期间会屏蔽 spy，避免中途分节被依次点亮 */
  scrollToSection: (sectionId: string, behavior?: ScrollBehavior) => void
  /** 尾部占位高度：没有它，最后一个分节永远滚不到顶，点目录会「没反应」 */
  tailSpacerHeight: number
}

function readSections(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[${SETTINGS_SECTION_ATTR}]`))
}

/**
 * 设置弹窗的「单页滚动 + 目录定位」逻辑。
 *
 * 拆成 hook 而不是写在弹窗组件里，是因为这里有三段互相牵制的状态
 * （程序化滚动屏蔽、滚动判定、尾部占位测量），混在渲染代码里很难看出彼此的约束。
 */
export function useSettingsScrollSpy({
  containerRef,
  sectionIds,
  onActiveSectionChange,
}: UseSettingsScrollSpyOptions): UseSettingsScrollSpyResult {
  const [tailSpacerHeight, setTailSpacerHeight] = useState(0)
  const isProgrammaticScrollRef = useRef(false)
  const fallbackTimerRef = useRef<number | null>(null)
  // 回调放进 ref，滚动监听就不必跟着调用方的每次重渲染重新绑定
  const onActiveSectionChangeRef = useRef(onActiveSectionChange)
  onActiveSectionChangeRef.current = onActiveSectionChange

  const sectionKey = sectionIds.join('|')

  const releaseProgrammaticScroll = useCallback(() => {
    isProgrammaticScrollRef.current = false
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  const scrollToSection = useCallback(
    (sectionId: string, behavior: ScrollBehavior = 'smooth'): void => {
      const container = containerRef.current
      if (!container) return
      const target = container.querySelector<HTMLElement>(
        `[${SETTINGS_SECTION_ATTR}="${sectionId}"]`
      )
      if (!target) return

      isProgrammaticScrollRef.current = true
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current)
      }
      fallbackTimerRef.current = window.setTimeout(
        releaseProgrammaticScroll,
        PROGRAMMATIC_SCROLL_FALLBACK_MS
      )

      const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + delta - SECTION_ANCHOR_OFFSET, behavior })
    },
    [containerRef, releaseProgrammaticScroll]
  )

  // 滚动判定：取「顶部已经越过判定线的最后一个分节」，滚到底时强制选中最后一个。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let frame = 0
    const evaluate = (): void => {
      frame = 0
      if (isProgrammaticScrollRef.current) return
      const sections = readSections(container)
      if (sections.length === 0) return

      const containerTop = container.getBoundingClientRect().top
      // 容差 1px：滚动位置常有小数，正好停在判定线上时不应该来回跳
      const probeLine = containerTop + SECTION_ANCHOR_OFFSET + 1
      let current = sections[0]
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= probeLine) {
          current = section
        }
      }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
        current = sections[sections.length - 1]
      }

      const id = current.getAttribute(SETTINGS_SECTION_ATTR)
      if (id) {
        onActiveSectionChangeRef.current(id)
      }
    }

    const handleScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(evaluate)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('scrollend', releaseProgrammaticScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('scrollend', releaseProgrammaticScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [containerRef, releaseProgrammaticScroll, sectionKey])

  // 尾部占位测量。刻意只依赖「容器高度」和「最后一个分节高度」，不读 scrollHeight，
  // 否则占位本身会算进去，形成 ResizeObserver 的自激循环。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let frame = 0
    const measure = (): void => {
      frame = 0
      const sections = readSections(container)
      const last = sections[sections.length - 1]
      if (!last) {
        setTailSpacerHeight(0)
        return
      }
      const next = Math.max(
        0,
        container.clientHeight -
          last.getBoundingClientRect().height -
          SECTION_ANCHOR_OFFSET -
          CONTENT_BOTTOM_PADDING
      )
      setTailSpacerHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next))
    }

    const schedule = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    const sections = readSections(container)
    const last = sections[sections.length - 1]
    if (last) observer.observe(last)

    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [containerRef, sectionKey])

  useEffect(() => releaseProgrammaticScroll, [releaseProgrammaticScroll])

  return { scrollToSection, tailSpacerHeight }
}
