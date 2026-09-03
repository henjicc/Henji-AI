import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  isPanelInteractionPortalTarget,
  shouldClosePanelAfterInternalClick,
} from './panelTriggerClosePolicy'
import {
  resolveFloatingPanelPosition,
  type FloatingPanelPosition,
} from './floatingPanelPosition'
import { UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UI_FIELD_LABEL_CLASS, UI_TRIGGER_BUTTON_CLASS, UI_TRIGGER_PANEL_CLASS } from './styleTokens'
import { measureElementTextWidth } from './textMeasurement'
import { UiButton } from './primitives'
import { ChevronDown } from 'lucide-react'

type PanelTriggerProps = {
  label?: string
  display?: string
  disabled?: boolean
  className?: string
  buttonClassName?: string
  buttonLabelClassName?: string
  panelClassName?: string
  zIndex?: number
  panelWidth?: number
  /** 纯文字菜单可传入全部项目文案，在打开前按最长项计算稳定宽度。 */
  panelWidthLabels?: readonly string[]
  alignment?: 'bottomLeft' | 'aboveCenter'
  /** aboveCenter 对齐时面板底部与触发按钮顶部的间距（默认 45，与画布节点行内紧凑触发器保持一致时可调小） */
  gap?: number
  panelHeight?: number
  /**
   * 是否在点击面板内容后关闭。交互型面板默认保持打开；
   * 纯动作菜单应显式传入 true，或用函数只匹配会完成选择的元素。
   */
  closeOnPanelClick?: boolean | ((target: Node) => boolean)
  renderPanel: () => React.ReactNode
  stableHeight?: boolean
  stableHeightKey?: string | number
  freezePositionOnOpen?: boolean
  children?: (controls: PanelTriggerControls) => React.ReactNode
}

type PanelTriggerControls = {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
}

const PANEL_VIEWPORT_GUTTER_PX = 8
const PANEL_VIEWPORT_TOP_INSET_PX = 48
// 标准文字菜单：外层 p-1（8）+ 菜单项 px-2.5（20）+ 玻璃边框（2）。
const PANEL_TEXT_MENU_HORIZONTAL_CHROME_PX = 30

export default function PanelTrigger(props: PanelTriggerProps): React.ReactElement {
  const {
    label,
    display,
    disabled,
    className,
    buttonClassName,
    buttonLabelClassName,
    panelClassName,
    zIndex = 1000,
    panelWidth,
    panelWidthLabels,
    alignment = 'bottomLeft',
    gap: gapProp = 45,
    panelHeight: _panelHeight,
    closeOnPanelClick,
    renderPanel,
    stableHeight,
    stableHeightKey,
    freezePositionOnOpen = false,
    children,
  } = props
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [pos, setPos] = useState<FloatingPanelPosition | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const anchorRectRef = useRef<DOMRect | null>(null)
  const maxHeightRef = useRef<number>(0)
  const lastMeasuredPanelWidthRef = useRef<number | null>(null)
  const [measuredPanelWidth, setMeasuredPanelWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!panelWidthLabels || panelWidthLabels.length === 0 || !ref.current) {
      if (lastMeasuredPanelWidthRef.current !== null) {
        lastMeasuredPanelWidthRef.current = null
        setMeasuredPanelWidth(null)
      }
      return
    }
    const button = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
    if (!button) return
    const nextWidth = measureElementTextWidth(
      button,
      panelWidthLabels,
      PANEL_TEXT_MENU_HORIZONTAL_CHROME_PX,
    )
    if (nextWidth !== null && lastMeasuredPanelWidthRef.current !== nextWidth) {
      lastMeasuredPanelWidthRef.current = nextWidth
      setMeasuredPanelWidth(nextWidth)
    }
  }, [panelWidthLabels])

  const resolvedPanelWidth = panelWidth ?? measuredPanelWidth

  useEffect(() => {
    maxHeightRef.current = 0
  }, [stableHeightKey])

  const updatePanelPosition = useCallback((rect: DOMRect, reveal: boolean): void => {
    anchorRectRef.current = rect
    const measuredPanelHeight = Math.max(
      _panelHeight ?? 0,
      panelRef.current?.scrollHeight ?? 0,
      panelRef.current?.getBoundingClientRect().height ?? 0,
    )
    const position = resolveFloatingPanelPosition({
      anchor: rect,
      panelWidth: resolvedPanelWidth ?? rect.width,
      panelHeight: measuredPanelHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredPlacement: alignment === 'aboveCenter' ? 'above' : 'below',
      horizontalAlign: alignment === 'aboveCenter' ? 'center' : 'left',
      gap: alignment === 'aboveCenter' ? gapProp : 4,
      viewportGutter: PANEL_VIEWPORT_GUTTER_PX,
      viewportTopInset: PANEL_VIEWPORT_TOP_INSET_PX,
    })

    if (panelRef.current && stableHeight) {
      const height = panelRef.current.offsetHeight
      if (height > maxHeightRef.current) maxHeightRef.current = height
    }

    setPos(position)
    if (reveal) setReady(true)
  }, [_panelHeight, alignment, gapProp, resolvedPanelWidth, stableHeight])

  const computePanelPosition = useCallback((): void => {
    if (!ref.current) return
    const btn = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
    const target = btn || ref.current
    const rect = target.getBoundingClientRect()
    setReady(false)
    updatePanelPosition(rect, false)
  }, [updatePanelPosition])

  const closePanel = useCallback((): void => {
    setClosing(true)
    window.setTimeout(() => { setOpen(false); setClosing(false) }, 200)
  }, [])

  const openPanel = useCallback((): void => {
    if (disabled) return
    computePanelPosition()
    setOpen(true)
  }, [computePanelPosition, disabled])

  const togglePanel = useCallback((): void => {
    if (disabled) return
    if (open) {
      closePanel()
      return
    }
    openPanel()
  }, [closePanel, disabled, open, openPanel])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const targetElement = target instanceof Element ? target : target.parentElement
      const inTrigger = !!ref.current && ref.current.contains(target)
      const inPanel = !!panelRef.current && panelRef.current.contains(target)
      const inPortaledPanelControl = isPanelInteractionPortalTarget(targetElement)
      if (inTrigger) return
      if (inPortaledPanelControl) return
      if (inPanel) {
        if (open && shouldClosePanelAfterInternalClick(closeOnPanelClick, target)) {
          closePanel()
        }
        return
      }
      if (open) {
        closePanel()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [closePanel, open, closeOnPanelClick])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      closePanel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closePanel, open])

  useEffect(() => {
    const updateAnchor = (reveal: boolean) => {
      if (!ref.current) return
      const btn = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
      const target = btn || ref.current
      const rect = target.getBoundingClientRect()
      updatePanelPosition(rect, reveal && !!panelRef.current)
    }

    if (open) {
      updateAnchor(false)
      if (freezePositionOnOpen) {
        return
      }
      const onScrollOrResize = () => {
        updateAnchor(true)
      }
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
      return () => {
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [freezePositionOnOpen, open, updatePanelPosition])

  useLayoutEffect(() => {
    if (!open) return
    if (!anchorRectRef.current) return
    updatePanelPosition(anchorRectRef.current, true)
  }, [open, updatePanelPosition])

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
      if (!freezePositionOnOpen && anchorRectRef.current) {
        updatePanelPosition(anchorRectRef.current, true)
      }
    })
    obs.observe(panelRef.current)
    return () => obs.disconnect()
  }, [freezePositionOnOpen, open, stableHeight, updatePanelPosition])

  return (
    <div className={`relative inline-block ${className || ''}`} ref={ref}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      {children ? children({ open, openPanel, closePanel, togglePanel }) : (
        <UiButton
          type="button"
          disabled={disabled}
          variant="muted"
          onClick={togglePanel}
          data-panel-trigger-button
          className={`${UI_TRIGGER_BUTTON_CLASS} rounded-lg px-3 py-2 ${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${buttonClassName || 'w-full'}`}
        >
          <span className={`${buttonLabelClassName || 'text-sm'} truncate`}>{display ?? ''}</span>
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform duration-200 ml-2 ${open ? 'rotate-180' : ''}`} />
        </UiButton>
      )}
      {(open || closing) && pos && createPortal(
        <div
          ref={panelRef}
          className={`${UI_TRIGGER_PANEL_CLASS} ${panelClassName || ''} flex flex-col ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            minHeight: stableHeight && maxHeightRef.current ? Math.min(maxHeightRef.current, pos.maxHeight) : undefined,
            zIndex,
            opacity: ready ? 1 : 0,
            visibility: ready ? 'visible' : 'hidden'
          }}
          data-panel-placement={pos.placement}
        >
          <div
            data-panel-scroll-region
            className="ui-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {renderPanel()}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
