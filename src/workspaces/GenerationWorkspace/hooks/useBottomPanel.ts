import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { COLLAPSE_SETTING_SPECS, COLLAPSE_WATCH_EVENTS, useLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import { shouldUseCompactGenerationLayout } from '@/core/layout/uiAvailableSpace'
import { useNavigationStore } from '@/stores/navigationStore'

interface UseBottomPanelOptions {
  listContainerRef: RefObject<HTMLDivElement>
  /** 输入面板在左侧时不压在列表上：列表底部只留常规留白，也不自动收起。 */
  sideDocked?: boolean
}

interface UseBottomPanelResult {
  inputContainerRef: RefObject<HTMLDivElement>
  inputPadding: number
  isCompactLayout: boolean
  isPanelCollapsed: boolean
  isCollapsing: boolean
  expandPanelSmooth: () => void
  collapsePanelSmooth: () => void
  handlePanelMouseEnter: () => void
  handlePanelMouseLeave: () => void
  handlePanelMouseMove: () => void
}

/** 输入面板在左侧时列表底部的留白 */
const SIDE_DOCKED_LIST_PADDING = 32

export function useBottomPanel({ listContainerRef, sideDocked = false }: UseBottomPanelOptions): UseBottomPanelResult {
  const isActive = useNavigationStore(state => state.activeWorkspace === 'generation')
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const [inputPadding, setInputPadding] = useState<number>(400)
  const [isCompactLayout, setIsCompactLayout] = useState(false)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isCollapsing, setIsCollapsing] = useState(false)

  const { enableAutoCollapse, collapseDelay, collapseOnScrollOnly } = useLocalStorageSettings(
    COLLAPSE_SETTING_SPECS,
    COLLAPSE_WATCH_EVENTS
  )

  const isPanelHoveredRef = useRef(false)
  const mousePositionRef = useRef({ x: 0, y: 0 })
  const collapseTimerRef = useRef<number | null>(null)
  const collapseAnimationRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const isProgrammaticScrollRef = useRef(false)

  useEffect(() => {
    let initialized = false
    const handleFirstInteraction = (e: MouseEvent) => {
      if (initialized) return
      initialized = true
      const panel = inputContainerRef.current
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      const isInside = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      )
      isPanelHoveredRef.current = isInside
    }

    document.addEventListener('mousemove', handleFirstInteraction, { once: true, passive: true })
    document.addEventListener('mousedown', handleFirstInteraction, { once: true, passive: true })
    document.addEventListener('wheel', handleFirstInteraction, { once: true, passive: true })

    return () => {
      document.removeEventListener('mousemove', handleFirstInteraction)
      document.removeEventListener('mousedown', handleFirstInteraction)
      document.removeEventListener('wheel', handleFirstInteraction)
    }
  }, [])

  useEffect(() => {
    const trackMousePosition = (e: MouseEvent) => {
      mousePositionRef.current.x = e.clientX
      mousePositionRef.current.y = e.clientY
    }
    // 保留坐标，键盘切回生成页、鼠标尚未移动时也能恢复原有悬浮判断。
    document.addEventListener('mousemove', trackMousePosition, { passive: true })
    return () => document.removeEventListener('mousemove', trackMousePosition)
  }, [])

  useEffect(() => {
    // 工作区保持挂载；隐藏或关闭自动收起时，不需要全页面命中检测。
    if (!isActive || !enableAutoCollapse) return
    const checkMousePosition = () => {
      const panel = inputContainerRef.current
      if (!panel) return
      const { x, y } = mousePositionRef.current
      const elements = document.elementsFromPoint(x, y)
      const isInside = elements.some(el => panel.contains(el))
      if (isPanelHoveredRef.current !== isInside) {
        isPanelHoveredRef.current = isInside
      }
    }

    const interval = window.setInterval(checkMousePosition, 500)
    return () => clearInterval(interval)
  }, [isActive, enableAutoCollapse])

  useEffect(() => {
    const inputEl = inputContainerRef.current
    const listEl = listContainerRef.current
    if (!inputEl || !listEl) return
    const stickyToolbar = listEl.querySelector<HTMLElement>(':scope > [data-generation-history-toolbar]')

    const update = () => {
      const h = inputEl.offsetHeight || 0
      // 吸顶命令带在滚动区里，但不属于记录可用的高度；焦点滚进来的卡片也要停在它下面
      const toolbarHeight = stickyToolbar?.offsetHeight ?? 0
      const availableHeight = listEl.clientHeight - toolbarHeight
      listEl.style.scrollPaddingTop = `${toolbarHeight}px`
      const availableWidth = listEl.clientWidth
      setIsCompactLayout(shouldUseCompactGenerationLayout(availableWidth, availableHeight))
      const actualHeight = (isPanelCollapsed && !isCollapsing) ? 60 : h
      const newPadding = sideDocked ? SIDE_DOCKED_LIST_PADDING : actualHeight + 48
      setInputPadding(newPadding)

      const oldPadding = parseInt(listEl.style.paddingBottom || '0', 10) || 0
      const paddingDiff = newPadding - oldPadding
      const threshold = 8
      const atBottom = listEl.scrollHeight - listEl.clientHeight - listEl.scrollTop <= threshold

      listEl.style.paddingBottom = `${newPadding}px`

      if (atBottom && paddingDiff > 0) {
        isProgrammaticScrollRef.current = true
        listEl.scrollTop += paddingDiff
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false
        })
      }
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(inputEl)
    ro.observe(listEl)
    // 命令带会变高（搜索时选了自定义时间，日期另起一行）
    if (stickyToolbar) ro.observe(stickyToolbar)
    return () => ro.disconnect()
  }, [isPanelCollapsed, isCollapsing, listContainerRef, sideDocked])

  const collapsePanelSmooth = useCallback((): void => {
    if (isPanelCollapsed || isCollapsing) return
    setIsCollapsing(true)
    requestAnimationFrame(() => {
      collapseAnimationRef.current = window.setTimeout(() => {
        setIsPanelCollapsed(true)
        setIsCollapsing(false)
      }, 500)
    })
  }, [isPanelCollapsed, isCollapsing])

  const expandPanelSmooth = useCallback((): void => {
    if (!isPanelCollapsed && !isCollapsing) return
    if (collapseAnimationRef.current) {
      clearTimeout(collapseAnimationRef.current)
      collapseAnimationRef.current = null
    }
    setIsCollapsing(true)
    requestAnimationFrame(() => {
      setIsPanelCollapsed(false)
      setIsCollapsing(false)
    })
  }, [isPanelCollapsed, isCollapsing])

  const handlePanelMouseEnter = useCallback((): void => {
    isPanelHoveredRef.current = true
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
    expandPanelSmooth()
  }, [expandPanelSmooth])

  const handlePanelMouseLeave = useCallback((): void => {
    isPanelHoveredRef.current = false
    if (!enableAutoCollapse || sideDocked) return
    if (collapseOnScrollOnly) return

    const el = listContainerRef.current
    if (!el) return

    const threshold = 8
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold

    const lastTaskElement = el.querySelector('.space-y-6 > div:last-child')
    let isLastTaskVisible = false
    if (lastTaskElement) {
      const taskRect = lastTaskElement.getBoundingClientRect()
      const containerRect = el.getBoundingClientRect()
      isLastTaskVisible = taskRect.bottom > containerRect.top && taskRect.top < containerRect.bottom
    }

    if (!atBottom && !isLastTaskVisible) {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current)
      }
      collapseTimerRef.current = window.setTimeout(() => {
        if (!isPanelHoveredRef.current) {
          collapsePanelSmooth()
        }
      }, collapseDelay)
    }
  }, [collapseDelay, collapseOnScrollOnly, collapsePanelSmooth, enableAutoCollapse, listContainerRef, sideDocked])

  const handlePanelMouseMove = useCallback((): void => {
    if (!isPanelHoveredRef.current) {
      isPanelHoveredRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!enableAutoCollapse || sideDocked) {
      expandPanelSmooth()
      return
    }

    const el = listContainerRef.current
    if (!el) return

    lastScrollTopRef.current = el.scrollTop

    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return

      const threshold = 8
      const currentScrollTop = el.scrollTop
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold
      const scrollDelta = Math.abs(currentScrollTop - lastScrollTopRef.current)

      const lastTaskElement = el.querySelector('.space-y-6 > div:last-child')
      let isLastTaskVisible = false
      if (lastTaskElement) {
        const taskRect = lastTaskElement.getBoundingClientRect()
        const containerRect = el.getBoundingClientRect()
        isLastTaskVisible = taskRect.bottom > containerRect.top && taskRect.top < containerRect.bottom
      }

      lastScrollTopRef.current = currentScrollTop

      if (atBottom) {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current)
          collapseTimerRef.current = null
        }
        expandPanelSmooth()
        return
      }

      if (scrollDelta > 3 && !isPanelHoveredRef.current && !isLastTaskVisible) {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current)
          collapseTimerRef.current = null
        }
        collapsePanelSmooth()
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current)
      }
      if (collapseAnimationRef.current) {
        clearTimeout(collapseAnimationRef.current)
      }
    }
  }, [enableAutoCollapse, sideDocked, expandPanelSmooth, collapsePanelSmooth, listContainerRef])

  return {
    inputContainerRef,
    inputPadding,
    isCompactLayout,
    isPanelCollapsed,
    isCollapsing,
    expandPanelSmooth,
    collapsePanelSmooth,
    handlePanelMouseEnter,
    handlePanelMouseLeave,
    handlePanelMouseMove,
  }
}
