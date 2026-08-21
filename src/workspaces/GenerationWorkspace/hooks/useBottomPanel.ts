import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { COLLAPSE_SETTING_SPECS, COLLAPSE_WATCH_EVENTS, useLocalStorageSettings } from '@/hooks/useLocalStorageSetting'

interface UseBottomPanelOptions {
  listContainerRef: RefObject<HTMLDivElement>
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

const COMPACT_WORKSPACE_MAX_HEIGHT_PX = 920
const COMPACT_WORKSPACE_MAX_WIDTH_PX = 1180
const COMPACT_NARROW_WORKSPACE_MAX_HEIGHT_PX = 1050

export function shouldUseCompactBottomPanelLayout(
  availableWidth: number,
  availableHeight: number
): boolean {
  return availableHeight <= COMPACT_WORKSPACE_MAX_HEIGHT_PX || (
    availableWidth <= COMPACT_WORKSPACE_MAX_WIDTH_PX &&
    availableHeight <= COMPACT_NARROW_WORKSPACE_MAX_HEIGHT_PX
  )
}

export function useBottomPanel({ listContainerRef }: UseBottomPanelOptions): UseBottomPanelResult {
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
    let lastMouseX = 0
    let lastMouseY = 0

    const trackMousePosition = (e: MouseEvent) => {
      lastMouseX = e.clientX
      lastMouseY = e.clientY
    }

    const checkMousePosition = () => {
      const panel = inputContainerRef.current
      if (!panel) return
      const elements = document.elementsFromPoint(lastMouseX, lastMouseY)
      const isInside = elements.some(el => panel.contains(el))
      if (isPanelHoveredRef.current !== isInside) {
        isPanelHoveredRef.current = isInside
      }
    }

    document.addEventListener('mousemove', trackMousePosition, { passive: true })
    const interval = window.setInterval(checkMousePosition, 500)

    return () => {
      document.removeEventListener('mousemove', trackMousePosition)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const inputEl = inputContainerRef.current
    const listEl = listContainerRef.current
    if (!inputEl || !listEl) return

    const update = () => {
      const h = inputEl.offsetHeight || 0
      const availableHeight = listEl.clientHeight
      const availableWidth = listEl.clientWidth
      setIsCompactLayout(shouldUseCompactBottomPanelLayout(availableWidth, availableHeight))
      const actualHeight = (isPanelCollapsed && !isCollapsing) ? 60 : h
      const newPadding = actualHeight + 48
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
    return () => ro.disconnect()
  }, [isPanelCollapsed, isCollapsing, listContainerRef])

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
    if (!enableAutoCollapse) return
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
  }, [collapseDelay, collapseOnScrollOnly, collapsePanelSmooth, enableAutoCollapse, listContainerRef])

  const handlePanelMouseMove = useCallback((): void => {
    if (!isPanelHoveredRef.current) {
      isPanelHoveredRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!enableAutoCollapse) {
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
  }, [enableAutoCollapse, expandPanelSmooth, collapsePanelSmooth, listContainerRef])

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
