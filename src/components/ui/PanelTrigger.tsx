import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UI_FIELD_LABEL_CLASS, UI_TRIGGER_BUTTON_CLASS, UI_TRIGGER_PANEL_CLASS } from './styleTokens'
import { UiButton } from './primitives'

type PanelTriggerProps = {
  label?: string
  display?: string
  disabled?: boolean
  className?: string
  buttonClassName?: string
  panelClassName?: string
  zIndex?: number
  panelWidth?: number
  alignment?: 'bottomLeft' | 'aboveCenter'
  panelHeight?: number
  closeOnPanelClick?: boolean | ((target: Node) => boolean)
  renderPanel: () => React.ReactNode
  stableHeight?: boolean
  freezePositionOnOpen?: boolean
}

export default function PanelTrigger(props: PanelTriggerProps) {
  const {
    label,
    display,
    disabled,
    className,
    buttonClassName,
    panelClassName,
    zIndex = 1000,
    panelWidth,
    alignment = 'bottomLeft',
    panelHeight: _panelHeight,
    closeOnPanelClick = true,
    renderPanel,
    stableHeight,
    freezePositionOnOpen = false,
  } = props
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const anchorRectRef = useRef<DOMRect | null>(null)
  const maxHeightRef = useRef<number>(0)



  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const inTrigger = !!ref.current && ref.current.contains(target)
      const inPanel = !!panelRef.current && panelRef.current.contains(target)
      if (inTrigger) return
      if (inPanel) {
        if (open) {
          if (typeof closeOnPanelClick === 'function') {
            const shouldClose = closeOnPanelClick(target)
            if (shouldClose) {
              setClosing(true)
              setTimeout(() => { setOpen(false); setClosing(false) }, 200)
            }
          } else if (closeOnPanelClick === true) {
            setClosing(true)
            setTimeout(() => { setOpen(false); setClosing(false) }, 200)
          }
        }
        return
      }
      if (open) {
        setClosing(true)
        setTimeout(() => { setOpen(false); setClosing(false) }, 200)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, closeOnPanelClick])

  useEffect(() => {
    const updateAnchor = () => {
      if (!ref.current) return
      const btn = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
      const target = btn || ref.current
      const rect = target.getBoundingClientRect()
      anchorRectRef.current = rect

      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const margin = 8
      const titleBarHeight = 40 // Tauri 标题栏高度
      const w = Math.min(panelWidth || rect.width, viewportW - margin * 2)
      let left = alignment === 'aboveCenter' ? (rect.left + rect.width / 2 - w / 2) : rect.left
      left = Math.max(margin, Math.min(left, viewportW - w - margin))
      const gap = 45

      if (alignment === 'aboveCenter') {
        const bottom = viewportH - rect.top + gap
        const maxHeight = rect.top - margin - gap - titleBarHeight
        setPos({ bottom, left, width: w, maxHeight })
      } else {
        const top = rect.bottom + 4
        const maxHeight = viewportH - top - margin
        setPos({ top, left, width: w, maxHeight })
      }
      setReady(!!panelRef.current)
    }

    if (open) {
      updateAnchor()
      if (freezePositionOnOpen) {
        return
      }
      const onScrollOrResize = () => {
        updateAnchor()
      }
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
      return () => {
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [open, alignment, panelWidth, freezePositionOnOpen])

  useLayoutEffect(() => {
    if (freezePositionOnOpen) return
    if (!open) return
    if (!anchorRectRef.current) return

    const updatePos = () => {
      if (!anchorRectRef.current) return
      const rect = anchorRectRef.current
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const margin = 8
      const titleBarHeight = 40 // Tauri 标题栏高度
      const w = Math.min(panelWidth || rect.width, viewportW - margin * 2)

      let left = alignment === 'aboveCenter' ? (rect.left + rect.width / 2 - w / 2) : rect.left
      left = Math.max(margin, Math.min(left, viewportW - w - margin))
      const gap = 45

      if (alignment === 'aboveCenter') {
        const bottom = viewportH - rect.top + gap
        const maxHeight = rect.top - margin - gap - titleBarHeight
        setPos({ bottom, left, width: w, maxHeight })
      } else {
        const top = rect.bottom + 4
        const maxHeight = viewportH - top - margin
        setPos({ top, left, width: w, maxHeight })
      }

      if (panelRef.current && stableHeight) {
        const h = panelRef.current.offsetHeight
        if (h > maxHeightRef.current) {
          maxHeightRef.current = h
        }
      }

      setReady(true)
    }

    updatePos()
  }, [open, alignment, panelWidth, stableHeight, freezePositionOnOpen])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const obs = new ResizeObserver(() => {
      if (panelRef.current && stableHeight) {
        const h = panelRef.current.offsetHeight
        if (h > maxHeightRef.current) {
          maxHeightRef.current = h
          // Force re-render to apply new minHeight
          setPos(prev => prev ? { ...prev } : prev)
        }
      }
    })
    obs.observe(panelRef.current)
    return () => obs.disconnect()
  }, [open, alignment, panelWidth, stableHeight])

  useEffect(() => {
    if (freezePositionOnOpen) return
    if (!open) return
    if (!anchorRectRef.current) return
    requestAnimationFrame(() => {
      const rect = anchorRectRef.current!
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const margin = 8
      const titleBarHeight = 40 // Tauri 标题栏高度
      const w = Math.min(panelWidth || rect.width, viewportW - margin * 2)

      let left = alignment === 'aboveCenter' ? (rect.left + rect.width / 2 - w / 2) : rect.left
      left = Math.max(margin, Math.min(left, viewportW - w - margin))
      const gap = 45

      if (alignment === 'aboveCenter') {
        const bottom = viewportH - rect.top + gap
        const maxHeight = rect.top - margin - gap - titleBarHeight
        setPos({ bottom, left, width: w, maxHeight })
      } else {
        const top = rect.bottom + 4
        const maxHeight = viewportH - top - margin
        setPos({ top, left, width: w, maxHeight })
      }

      if (panelRef.current && stableHeight) {
        const h = panelRef.current.offsetHeight
        if (h > maxHeightRef.current) {
          maxHeightRef.current = h
        }
      }

      setReady(true)
    })
  }, [open, alignment, panelWidth, stableHeight, freezePositionOnOpen])

  return (
    <div className={`relative inline-block ${className || ''}`} ref={ref}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiButton
        type="button"
        disabled={disabled}
        variant="muted"
        onClick={() => {
          if (disabled) return
          if (open) {
            setClosing(true)
            setTimeout(() => { setOpen(false); setClosing(false) }, 200)
          } else {
            if (ref.current) {
              const btn = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
              const target = btn || ref.current
              const rect = target.getBoundingClientRect()
              anchorRectRef.current = rect
              const viewportW = window.innerWidth
              const viewportH = window.innerHeight
              const margin = 8
              const titleBarHeight = 40 // Tauri 标题栏高度
              const w = Math.min(panelWidth || rect.width, viewportW - margin * 2)
              let left = alignment === 'aboveCenter' ? (rect.left + rect.width / 2 - w / 2) : rect.left
              left = Math.max(margin, Math.min(left, viewportW - w - margin))
              const gap = 45

              if (alignment === 'aboveCenter') {
                const bottom = viewportH - rect.top + gap
                const maxHeight = rect.top - margin - gap - titleBarHeight
                setReady(false)
                setPos({ bottom, left, width: w, maxHeight })
              } else {
                const top = rect.bottom + 4
                const maxHeight = viewportH - top - margin
                setReady(false)
                setPos({ top, left, width: w, maxHeight })
              }
            }
            setOpen(true)
          }
        }}
        data-panel-trigger-button
        className={`${UI_TRIGGER_BUTTON_CLASS} rounded-lg px-3 py-2 h-[38px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${buttonClassName || 'w-full'}`}
      >
        <span className="text-sm truncate">{display ?? ''}</span>
        <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </UiButton>
      {(open || closing) && pos && createPortal(
        <div
          ref={panelRef}
          className={`${UI_TRIGGER_PANEL_CLASS} ${panelClassName || ''} flex flex-col ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
          style={{
            position: 'fixed',
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            minHeight: stableHeight && maxHeightRef.current ? Math.min(maxHeightRef.current, pos.maxHeight) : undefined,
            zIndex,
            opacity: ready ? 1 : 0,
            visibility: ready ? 'visible' : 'hidden'
          }}
        >
          {renderPanel()}
        </div>,
        document.body
      )}
    </div>
  )
}
