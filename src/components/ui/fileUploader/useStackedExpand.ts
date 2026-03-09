import { useCallback, useEffect, useRef, useState } from 'react'

interface UseStackedExpandParams {
  collapseDelayMs?: number
}

interface UseStackedExpandReturn {
  expanded: boolean
  hoverCapable: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onToggle: () => void
  holdExpanded: (durationMs?: number) => void
  beginExpandLock: () => void
  endExpandLock: (durationMs?: number) => void
}

export function useStackedExpand(params: UseStackedExpandParams = {}): UseStackedExpandReturn {
  const { collapseDelayMs = 140 } = params
  const [expanded, setExpanded] = useState(false)
  const [hoverCapable, setHoverCapable] = useState(true)
  const collapseTimerRef = useRef<number | null>(null)
  const holdReleaseTimerRef = useRef<number | null>(null)
  const holdUntilRef = useRef(0)
  const isHoveringRef = useRef(false)
  const lockCountRef = useRef(0)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    const apply = () => setHoverCapable(mediaQuery.matches)
    apply()
    mediaQuery.addEventListener('change', apply)
    return () => mediaQuery.removeEventListener('change', apply)
  }, [])

  const clearTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
    if (holdReleaseTimerRef.current !== null) {
      window.clearTimeout(holdReleaseTimerRef.current)
      holdReleaseTimerRef.current = null
    }
  }, [])

  const onMouseEnter = useCallback(() => {
    isHoveringRef.current = true
    if (!hoverCapable) return
    clearTimer()
    setExpanded(true)
  }, [clearTimer, hoverCapable])

  const onMouseLeave = useCallback(() => {
    isHoveringRef.current = false
    if (!hoverCapable) return
    if (lockCountRef.current > 0) return
    if (Date.now() < holdUntilRef.current) return
    clearTimer()
    collapseTimerRef.current = window.setTimeout(() => {
      setExpanded(false)
    }, collapseDelayMs)
  }, [clearTimer, collapseDelayMs, hoverCapable])

  const onToggle = useCallback(() => {
    if (hoverCapable) return
    clearTimer()
    setExpanded((previous) => !previous)
  }, [clearTimer, hoverCapable])

  const holdExpanded = useCallback((durationMs = 1800) => {
    clearTimer()
    setExpanded(true)
    holdUntilRef.current = Date.now() + durationMs
    holdReleaseTimerRef.current = window.setTimeout(() => {
      if (hoverCapable && !isHoveringRef.current) {
        setExpanded(false)
      }
    }, durationMs)
  }, [clearTimer, hoverCapable])

  const beginExpandLock = useCallback(() => {
    clearTimer()
    lockCountRef.current += 1
    setExpanded(true)
  }, [clearTimer])

  const endExpandLock = useCallback((durationMs = 0) => {
    lockCountRef.current = Math.max(0, lockCountRef.current - 1)
    if (lockCountRef.current > 0) return
    if (durationMs > 0) {
      holdExpanded(durationMs)
      return
    }
    if (hoverCapable && !isHoveringRef.current) {
      setExpanded(false)
    }
  }, [holdExpanded, hoverCapable])

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  return {
    expanded,
    hoverCapable,
    onMouseEnter,
    onMouseLeave,
    onToggle,
    holdExpanded,
    beginExpandLock,
    endExpandLock
  }
}
