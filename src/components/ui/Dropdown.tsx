import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { UI_DROPDOWN_OPTION_ACTIVE_CLASS, UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UI_FIELD_LABEL_CLASS, UI_TRIGGER_BUTTON_CLASS, UI_TRIGGER_PANEL_CLASS } from './styleTokens'
import { UiButton, UiOptionButton } from './primitives'
import { resolveDropdownDisplay } from './dropdownUtils'
import { ChevronDown } from 'lucide-react'

export type DropdownOption<T extends string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
}

// 测宽用的离屏 canvas 只需要一张：每个 Dropdown 挂载时都新建一张，
// 启动瞬间几十个下拉一起挂载就是几十次 canvas 创建 + 上下文申请。
let measureContext: CanvasRenderingContext2D | null | undefined
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  return measureContext
}

type DropdownProps<T extends string | number | boolean> = {
  label?: string
  value?: T
  display?: string
  options?: DropdownOption<T>[]
  onSelect?: (value: T) => void
  renderPanel?: () => React.ReactNode
  disabled?: boolean
  className?: string
  buttonClassName?: string
  buttonLabelClassName?: string
  optionLabelClassName?: string
  panelClassName?: string
  ariaLabel?: string
  ariaLabelledBy?: string
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
    ariaLabel,
    ariaLabelledBy,
    portal = true,
    zIndex = 1000,
    minWidthStrategy = 'display',
    panelWidthStrategy = 'button',
  } = props
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
  const ref = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dropdownId = useId().replace(/:/g, '')
  const panelId = `dropdown-panel-${dropdownId}`
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [buttonMinWidthPx, setButtonMinWidthPx] = useState<number | null>(null)
  const [panelMinWidthPx, setPanelMinWidthPx] = useState<number | null>(null)
  const lastButtonMinWidthRef = useRef<number | null>(null)
  const lastPanelMinWidthRef = useRef<number | null>(null)
  const resolvedDisplay = resolveDropdownDisplay(display, value, options)
  const isSelectedOption = (optValue: T): boolean => {
    if (value === undefined) return false
    return String(value) === String(optValue)
  }
  const enabledOptionIndices = (): number[] => (options || [])
    .map((option, index) => option.disabled ? -1 : index)
    .filter((index) => index >= 0)
  const selectOption = (option: DropdownOption<T>): void => {
    if (option.disabled) return
    onSelect?.(option.value)
    setClosing(true)
    setTimeout(() => { setOpen(false); setClosing(false) }, 200)
  }
  const openPanel = (): void => {
    const selectedIndex = (options || []).findIndex((option) => isSelectedOption(option.value) && !option.disabled)
    setActiveOptionIndex(selectedIndex >= 0 ? selectedIndex : (enabledOptionIndices()[0] ?? -1))
    setClosing(false)
    setOpen(true)
  }
  const closePanel = (restoreFocus = false): void => {
    if (!open) return
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
      if (restoreFocus) triggerRef.current?.focus()
    }, 200)
  }
  const moveActiveOption = (direction: 1 | -1): void => {
    const indices = enabledOptionIndices()
    if (indices.length === 0) return
    const currentPosition = indices.indexOf(activeOptionIndex)
    const nextPosition = currentPosition < 0
      ? (direction === 1 ? 0 : indices.length - 1)
      : (currentPosition + direction + indices.length) % indices.length
    setActiveOptionIndex(indices[nextPosition])
  }
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openPanel()
      else moveActiveOption(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openPanel()
      else moveActiveOption(-1)
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveOptionIndex(enabledOptionIndices()[0] ?? -1)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      const indices = enabledOptionIndices()
      setActiveOptionIndex(indices[indices.length - 1] ?? -1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        openPanel()
        return
      }
      const option = options?.[activeOptionIndex]
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closePanel(true)
      return
    }
    if (event.key === 'Tab' && open) closePanel()
  }
  const getOptionLabels = useCallback((source?: DropdownOption<T>[]): string[] => {
    return (source || []).map((option) => String(option.label))
  }, [])
  const measureTextMinWidth = (targetButton: HTMLElement, labels: string[]): number | null => {
    const ctx = getMeasureContext()
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
      const displayText = resolvedDisplay
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
  }, [buttonMinWidthPx, getOptionLabels, minWidthStrategy, options, panelMinWidthPx, panelWidthStrategy, resolvedDisplay])

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

  const menuContent = renderPanel ? (
    <div id={panelId} className="max-h-60 overflow-y-auto">{renderPanel()}</div>
  ) : (
    <div
      id={panelId}
      role="listbox"
      aria-label={ariaLabel ?? label ?? resolvedDisplay}
      aria-labelledby={ariaLabelledBy}
      className="max-h-60 overflow-y-auto"
    >
      {(options || []).map((option, index) => {
        const selected = isSelectedOption(option.value)
        const active = activeOptionIndex === index
        return (
          <UiOptionButton
            key={String(option.value)}
            id={`${panelId}-option-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={selected}
            active={selected}
            variant="menu"
            className={`w-full rounded-none border-0 px-3 py-2 transition-colors duration-200 ${option.disabled
              ? 'cursor-not-allowed opacity-50'
              : selected
                ? `${UI_DROPDOWN_OPTION_ACTIVE_CLASS} cursor-pointer`
                : 'cursor-pointer'
            } ${active ? 'ring-1 ring-accent ring-inset' : ''}`}
            onMouseEnter={() => setActiveOptionIndex(index)}
            onClick={() => selectOption(option)}
          >
            <span className={`block truncate whitespace-nowrap ${optionLabelClassName || 'text-sm'}`}>{option.label}</span>
          </UiOptionButton>
        )
      })}
    </div>
  )

  return (
    <div className={`relative inline-block ${className || ''}`} ref={ref}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiButton
        ref={triggerRef}
        type="button"
        disabled={disabled}
        variant="muted"
        onClick={() => {
          if (disabled) return
          if (open) {
            closePanel()
          } else {
            openPanel()
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        data-dropdown-button
        aria-haspopup="listbox"
        aria-expanded={open && !closing}
        aria-controls={panelId}
        aria-activedescendant={open && activeOptionIndex >= 0 ? `${panelId}-option-${activeOptionIndex}` : undefined}
        aria-label={ariaLabelledBy ? undefined : ariaLabel ?? label ?? resolvedDisplay}
        aria-labelledby={ariaLabelledBy}
        className={
          `${UI_TRIGGER_BUTTON_CLASS} rounded-lg px-3 py-2 ${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${buttonClassName || 'w-full'}`
        }
        style={{
          outline: 'none',
          boxShadow: 'none',
          ...(buttonMinWidthPx ? { minWidth: `${buttonMinWidthPx}px` } : {})
        }}
      >
        <span className={`${buttonLabelClassName || 'text-sm'} truncate`}>{resolvedDisplay}</span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform duration-200 ml-2 ${open ? 'rotate-180' : ''}`} />
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
              {menuContent}
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
            {menuContent}
          </div>
        )
      )}
    </div>
  )
}
