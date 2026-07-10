import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  UI_FIELD_LABEL_CLASS,
  UI_DROPDOWN_OPTION_ACTIVE_CLASS,
  UI_TRIGGER_BUTTON_CLASS,
  UI_TRIGGER_PANEL_CLASS,
} from './styleTokens'
import { UiButton, UiOptionButton } from './primitives'

type Option<T extends string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
}

type DropdownProps<T extends string | number | boolean> = {
  label?: string
  value?: T
  display?: string
  options?: Option<T>[]
  onSelect?: (value: T) => void
  renderPanel?: () => React.ReactNode
  disabled?: boolean
  className?: string
  buttonClassName?: string
  buttonLabelClassName?: string
  optionLabelClassName?: string
  panelClassName?: string
  portal?: boolean
  zIndex?: number
  minWidthStrategy?: 'options' | 'display' | 'none'
  panelWidthStrategy?: 'button' | 'options'
}

export default function Dropdown<T extends string | number | boolean>(props: DropdownProps<T>) {
  const {
    label,
    value,
    display,
    options,
    onSelect,
    renderPanel,
    disabled,
    className,
    buttonClassName,
    buttonLabelClassName,
    optionLabelClassName,
    panelClassName,
    portal = true,
    zIndex = 1000,
    minWidthStrategy = 'display',
    panelWidthStrategy = 'button',
  } = props
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [buttonMinWidthPx, setButtonMinWidthPx] = useState<number | null>(null)
  const [panelMinWidthPx, setPanelMinWidthPx] = useState<number | null>(null)
  const lastButtonMinWidthRef = useRef<number | null>(null)
  const lastPanelMinWidthRef = useRef<number | null>(null)
  const isSelectedOption = (optValue: T): boolean => {
    if (value === undefined) return false
    return String(value) === String(optValue)
  }
  const getOptionLabels = useCallback((source?: Option<T>[]): string[] => {
    return (source || []).map((option) => String(option.label))
  }, [])
  const measureTextMinWidth = (targetButton: HTMLElement, labels: string[]): number | null => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const computedStyle = window.getComputedStyle(targetButton)
    const font = `${computedStyle.fontStyle} ${computedStyle.fontVariant} ${computedStyle.fontWeight} ${computedStyle.fontSize} / ${computedStyle.lineHeight} ${computedStyle.fontFamily}`
    ctx.font = font
    const textWidth = Math.max(...labels.map((item) => ctx.measureText(item).width))
    const paddingLeft = parseFloat(computedStyle.paddingLeft || '12')
    const paddingRight = parseFloat(computedStyle.paddingRight || '12')
    const arrowSpace = 24
    const borderWidth = (parseFloat(computedStyle.borderLeftWidth || '1') + parseFloat(computedStyle.borderRightWidth || '1')) || 2
    return Math.ceil(textWidth + paddingLeft + paddingRight + arrowSpace + borderWidth)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return
      const target = e.target as Node
      const inTrigger = ref.current.contains(target)
      const inPanel = panelRef.current?.contains(target) ?? false
      if (!inTrigger && !inPanel) {
        if (open) {
          setClosing(true)
          setTimeout(() => { setOpen(false); setClosing(false) }, 200)
        }
      }
    }
    // 捕获阶段监听：画布内多处控件会在冒泡阶段 stopPropagation（避免触发节点拖拽），
    // 用捕获阶段确保点击节点内其它空白处也能正常关闭下拉
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  useLayoutEffect(() => {
    if (!ref.current) return
    const btn = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
    if (!btn) return
    const computeMinWidth = () => {
      const displayText = String(display ?? value ?? '')
      const optionLabels = getOptionLabels(options)
      if (minWidthStrategy === 'none') {
        if (lastButtonMinWidthRef.current !== null || buttonMinWidthPx !== null) {
          lastButtonMinWidthRef.current = null
          setButtonMinWidthPx(null)
        }
      } else {
        const buttonLabels = minWidthStrategy === 'display'
          ? [displayText]
          : (optionLabels.length > 0 ? optionLabels : [displayText])
        const nextButtonMinWidth = measureTextMinWidth(btn, buttonLabels)
        if (nextButtonMinWidth !== null && lastButtonMinWidthRef.current !== nextButtonMinWidth) {
          lastButtonMinWidthRef.current = nextButtonMinWidth
          setButtonMinWidthPx(nextButtonMinWidth)
        }
      }

      if (panelWidthStrategy !== 'options') {
        if (lastPanelMinWidthRef.current !== null || panelMinWidthPx !== null) {
          lastPanelMinWidthRef.current = null
          setPanelMinWidthPx(null)
        }
        return
      }

      const panelLabels = optionLabels.length > 0 ? optionLabels : [displayText]
      const nextPanelMinWidth = measureTextMinWidth(btn, panelLabels)
      if (nextPanelMinWidth !== null && lastPanelMinWidthRef.current !== nextPanelMinWidth) {
        lastPanelMinWidthRef.current = nextPanelMinWidth
        setPanelMinWidthPx(nextPanelMinWidth)
      }
    }
    computeMinWidth()
  }, [buttonMinWidthPx, display, getOptionLabels, minWidthStrategy, options, panelMinWidthPx, panelWidthStrategy, value])

  useEffect(() => {
    const updatePos = () => {
      if (!ref.current) return
      const el = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
      const target = el || ref.current
      const rect = target.getBoundingClientRect()
      setFixedPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    if (open && portal) {
      updatePos()
      const onScrollOrResize = () => updatePos()
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
      return () => {
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [open, portal])

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
            setOpen(true)
          }
        }}
        data-dropdown-button
        className={
          `${UI_TRIGGER_BUTTON_CLASS} rounded-lg px-3 py-2 h-[38px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${buttonClassName || 'w-full'}`
        }
        style={{
          outline: 'none',
          boxShadow: 'none',
          ...(buttonMinWidthPx ? { minWidth: `${buttonMinWidthPx}px` } : {})
        }}
      >
        <span className={`${buttonLabelClassName || 'text-sm'} truncate`}>{display ?? String(value ?? '')}</span>
        <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </UiButton>
      {(open || closing) && (
        portal && fixedPos ? (
          createPortal(
            <div
              ref={panelRef}
              className={`${UI_TRIGGER_PANEL_CLASS} overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'} ${panelClassName || ''}`}
              style={{
                position: 'fixed',
                top: fixedPos.top,
                left: fixedPos.left,
                width: panelWidthStrategy === 'options' && panelMinWidthPx
                  ? Math.max(fixedPos.width, panelMinWidthPx)
                  : fixedPos.width,
                zIndex
              }}
              data-dropdown-portal="true"
            >
              {renderPanel ? (
                <div className="max-h-60 overflow-y-auto">{renderPanel()}</div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {(options || []).map(opt => (
                    <UiOptionButton
                    key={String(opt.value)}
                    active={isSelectedOption(opt.value)}
                    className={`w-full rounded-none border-0 px-3 py-2 transition-colors duration-200 ${opt.disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : isSelectedOption(opt.value)
                        ? `${UI_DROPDOWN_OPTION_ACTIVE_CLASS} cursor-pointer`
                        : 'cursor-pointer'
                        }`}
                    onClick={() => {
                      if (opt.disabled) return
                        onSelect && onSelect(opt.value)
                        setClosing(true)
                        setTimeout(() => { setOpen(false); setClosing(false) }, 200)
                      }}
                    >
                      <span className={`block truncate whitespace-nowrap ${optionLabelClassName || 'text-sm'}`}>{opt.label}</span>
                    </UiOptionButton>
                  ))}
                </div>
              )}
            </div>,
            document.body
          )
        ) : (
          <div
            ref={panelRef}
            className={`absolute left-0 z-50 mt-1 ${panelWidthStrategy === 'options' ? 'w-auto' : 'w-full'} ${UI_TRIGGER_PANEL_CLASS} overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'} ${panelClassName || ''}`}
            style={panelWidthStrategy === 'options' && panelMinWidthPx ? { minWidth: `${panelMinWidthPx}px` } : undefined}
            data-dropdown-portal="true"
          >
            {renderPanel ? (
              <div className="max-h-60 overflow-y-auto">{renderPanel()}</div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {(options || []).map(opt => (
                  <UiOptionButton
                  key={String(opt.value)}
                  active={isSelectedOption(opt.value)}
                  className={`w-full rounded-none border-0 px-3 py-2 transition-colors duration-200 ${opt.disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : isSelectedOption(opt.value)
                        ? `${UI_DROPDOWN_OPTION_ACTIVE_CLASS} cursor-pointer`
                        : 'cursor-pointer'
                      }`}
                  onClick={() => {
                    if (opt.disabled) return
                      onSelect && onSelect(opt.value)
                      setClosing(true)
                      setTimeout(() => { setOpen(false); setClosing(false) }, 200)
                    }}
                  >
                    <span className={`block truncate whitespace-nowrap ${optionLabelClassName || 'text-sm'}`}>{opt.label}</span>
                  </UiOptionButton>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
