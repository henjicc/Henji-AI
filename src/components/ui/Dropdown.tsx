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
import { UI_FIELD_INLINE_ROW_CLASS, UI_FIELD_LABEL_CLASS, UI_FIELD_LABEL_INLINE_CLASS, UI_TRIGGER_PANEL_PADDING_CLASS, UI_TRIGGER_PANEL_SURFACE_CLASS, type UiFieldSize, type UiTriggerPanelPadding, type UiTriggerPanelSurface } from './styleTokens'
import { UiFieldLayoutContext, useUiFieldLayout } from './fieldLayout'
import { UiFieldTrigger, UiOptionButton } from './primitives'
import { UI_DURATION } from './motion'
import { resolveDropdownDisplay, resolveDropdownMenuWidth } from './dropdownUtils'
import { resolveUiOverlayTarget, UiOverlayLayerProvider, useUiOverlayLayer } from './overlayOwnership'
import { measureElementTextWidth } from './textMeasurement'
import { Check } from 'lucide-react'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { isDomNode, ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'

const DROPDOWN_PANEL_GAP_PX = 8

export type DropdownOption<T extends string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
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
  /** 触发器的布局类（宽度、最大宽度、弹性）。外观只由 size / appearance 决定（check:surface 规则 E）。默认 `w-full`。 */
  buttonClassName?: string
  /** 触发器与选项的尺寸档：sm 28 / md 32（默认）/ lg 36，字号随档位。 */
  size?: UiFieldSize
  /** 浮层表面：默认实底；压在画布、图片、视频、3D 视口上时传 `glass`。 */
  surface?: UiTriggerPanelSurface
  /** 浮层内边距档；浮层外壳表面不接受覆盖。 */
  panelPadding?: UiTriggerPanelPadding
  ariaLabel?: string
  ariaLabelledBy?: string
  portal?: boolean
  zIndex?: number
  minWidthStrategy?: 'options' | 'display' | 'none'
  /**
   * 菜单宽度：`options`（默认）= 不窄于触发器，选项更长时按最长选项（含选中勾槽与滚动条）加宽，封顶 360 再截断；
   * `button` = 严格等于触发器宽度，只给“菜单必须与触发器对齐”的场合。
   * 任务 5.3 改默认值：触发器按当前值定宽（minWidthStrategy="display"）时，按触发器宽度的菜单必然截断更长的选项。
   */
  panelWidthStrategy?: 'button' | 'options'
  /**
   * `text` 用于标题栏等弱化入口：静息态只有文字与箭头，浮层仍使用统一菜单表面。
   * 不传时随字段排布：`UiFieldLayoutContext` 为 `toolbar` 时取 `text`，否则 `field`。
   */
  appearance?: 'field' | 'text'
  /** 菜单开合通知（宿主需要在菜单打开期间保持自身可见时用，如视频查看器的控制条）。 */
  onOpenChange?: (open: boolean) => void
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
    size = 'md',
    panelPadding = 'none',
    surface = 'solid',
    ariaLabel,
    ariaLabelledBy,
    portal = true,
    zIndex = Z_LAYERS.popover,
    minWidthStrategy = 'display',
    panelWidthStrategy = 'options',
    appearance: appearanceOverride,
    onOpenChange,
  } = props
  const fieldLayout = useUiFieldLayout()
  const toolbarLayout = fieldLayout === 'toolbar'
  const appearance = appearanceOverride ?? (toolbarLayout ? 'text' : 'field')
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
  const overlay = useUiOverlayLayer(open)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const menuShown = open && !closing
  const notifiedOpenRef = useRef(false)
  useEffect(() => {
    if (notifiedOpenRef.current === menuShown) return
    notifiedOpenRef.current = menuShown
    onOpenChangeRef.current?.(menuShown)
  }, [menuShown])
  const ref = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dropdownId = useId().replace(/:/g, '')
  const panelId = `dropdown-panel-${dropdownId}`
  const [fixedPos, setFixedPos] = useState<{
    top: number
    left: number
    width: number
    placement: 'above' | 'below'
  } | null>(null)
  const [buttonMinWidthPx, setButtonMinWidthPx] = useState<number | null>(null)
  const [panelMinWidthPx, setPanelMinWidthPx] = useState<number | null>(null)
  const lastButtonMinWidthRef = useRef<number | null>(null)
  const lastPanelMinWidthRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // 选项超过可视高度时列表出现竖向滚动条，它占用的宽度要加到菜单宽度上，
  // 否则带勾的选中项会被挤成“5.”“智…”（任务 5.3）。打开后、绘制前测量一次。
  const [scrollGutterPx, setScrollGutterPx] = useState(0)
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
    setTimeout(() => { setOpen(false); setClosing(false) }, UI_DURATION.base)
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
      // 这次 Escape 只属于打开中的下拉：不再冒泡到文档，否则外层弹窗（设置等）的焦点陷阱会把整个弹窗一起关掉
      event.stopPropagation()
      closePanel(true)
      return
    }
    if (event.key === 'Tab' && open) closePanel()
  }
  const getOptionLabels = useCallback((source?: DropdownOption<T>[]): string[] => {
    return (source || []).map((option) => String(option.label))
  }, [])
  const measureTextMinWidth = (targetButton: HTMLElement, labels: string[]): number | null => {
    const computedStyle = ownerWindowOf(targetButton).getComputedStyle(targetButton)
    const paddingLeft = parseFloat(computedStyle.paddingLeft || '12')
    const paddingRight = parseFloat(computedStyle.paddingRight || '12')
    const arrowSpace = 24
    const borderWidth = parseFloat(computedStyle.borderLeftWidth || '0') + parseFloat(computedStyle.borderRightWidth || '0')
    return measureElementTextWidth(
      targetButton,
      labels,
      paddingLeft + paddingRight + arrowSpace + borderWidth,
    )
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current || !isDomNode(e.target)) return
      const target = e.target
      const inTrigger = ref.current.contains(target)
      // 自身面板与在面板里打开的子浮层都算内部（浮层归属，任务 4.3）
      const inPanel = (panelRef.current?.contains(target) ?? false)
        || resolveUiOverlayTarget(target, overlay.id) !== 'outside'
      if (!inTrigger && !inPanel) {
        if (open) {
          setClosing(true)
          setTimeout(() => { setOpen(false); setClosing(false) }, UI_DURATION.base)
        }
      }
    }
    // 捕获阶段监听：画布内多处控件会在冒泡阶段 stopPropagation（避免触发节点拖拽），
    // 用捕获阶段确保点击节点内其它空白处也能正常关闭下拉
    // 按触发器所在文档监听，系统浮窗中的下拉在浮窗内关闭；主窗口行为不变。
    const ownerDocument = ownerDocumentOf(ref.current)
    ownerDocument.addEventListener('mousedown', handler, true)
    return () => ownerDocument.removeEventListener('mousedown', handler, true)
  }, [open, overlay.id])

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
      // 菜单宽度按菜单项自己的留白（含选中勾槽）计算，不借用触发器留白（任务 4.3）
      const textWidth = measureElementTextWidth(btn, panelLabels, 0)
      // 自定义面板（renderPanel）没有选中勾，按动作菜单留白；选项列表是选值菜单，预留勾槽
      const nextPanelMinWidth = textWidth === null ? null : resolveDropdownMenuWidth(textWidth, size, renderPanel ? 'none' : 'single')
      if (nextPanelMinWidth !== null && lastPanelMinWidthRef.current !== nextPanelMinWidth) {
        lastPanelMinWidthRef.current = nextPanelMinWidth
        setPanelMinWidthPx(nextPanelMinWidth)
      }
    }
    computeMinWidth()
  }, [buttonMinWidthPx, getOptionLabels, minWidthStrategy, options, panelMinWidthPx, panelWidthStrategy, renderPanel, resolvedDisplay, size])

  useLayoutEffect(() => {
    const updatePos = () => {
      if (!ref.current) return
      const el = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
      const target = el || ref.current
      const rect = target.getBoundingClientRect()
      const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 0
      const panelWidth = panelWidthStrategy === 'options' && panelMinWidthPx
        ? Math.max(rect.width, panelMinWidthPx + scrollGutterPx)
        : rect.width
      const viewportPadding = 8
      const viewport = ownerWindowOf(ref.current)
      const spaceBelow = viewport.innerHeight - rect.bottom - viewportPadding
      const placement = panelHeight > spaceBelow ? 'above' : 'below'
      const top = placement === 'above'
        ? Math.max(viewportPadding, rect.top - panelHeight - DROPDOWN_PANEL_GAP_PX)
        : Math.min(rect.bottom + DROPDOWN_PANEL_GAP_PX, viewport.innerHeight - viewportPadding)
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, viewport.innerWidth - panelWidth - viewportPadding)
      )
      setFixedPos({ top, left, width: rect.width, placement })
    }
    if (open) {
      updatePos()
      const onScrollOrResize = () => updatePos()
      const ownerWindow = ownerWindowOf(ref.current)
      ownerWindow.addEventListener('scroll', onScrollOrResize, true)
      ownerWindow.addEventListener('resize', onScrollOrResize)
      return () => {
        ownerWindow.removeEventListener('scroll', onScrollOrResize, true)
        ownerWindow.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [open, panelMinWidthPx, panelWidthStrategy, scrollGutterPx])

  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const gutter = Math.max(0, list.offsetWidth - list.clientWidth)
    if (gutter !== scrollGutterPx) setScrollGutterPx(gutter)
  }, [fixedPos, open, options, scrollGutterPx])

  const optionsPanelWidth = panelWidthStrategy === 'options' && panelMinWidthPx
    ? panelMinWidthPx + scrollGutterPx
    : null

  const menuBody = renderPanel ? (
    <div id={panelId} className="max-h-60 overflow-y-auto">
      {/* 浮层里的字段一律按表单排布，不继承触发器所在工具条的排布 */}
      <UiFieldLayoutContext.Provider value="form">{renderPanel()}</UiFieldLayoutContext.Provider>
    </div>
  ) : (
    <div
      ref={listRef}
      id={panelId}
      role="listbox"
      aria-label={ariaLabel ?? label ?? resolvedDisplay}
      aria-labelledby={ariaLabelledBy}
      className="max-h-60 overflow-y-auto p-1"
    >
      {(options || []).map((option, index) => {
        const selected = isSelectedOption(option.value)
        return (
          <UiOptionButton
            key={String(option.value)}
            id={`${panelId}-option-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={selected}
            active={selected}
            highlighted={activeOptionIndex === index && !selected}
            variant="menu"
            size={size}
            disabled={option.disabled}
            className="w-full cursor-pointer justify-between gap-2"
            onMouseEnter={() => setActiveOptionIndex(index)}
            onClick={() => selectOption(option)}
          >
            <span className="block min-w-0 truncate whitespace-nowrap">{option.label}</span>
            {/* 当前值：淡强调底 + 强调色勾（重要记录 012），标签保持主要文字 */}
            {selected ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent-text" /> : null}
          </UiOptionButton>
        )
      })}
    </div>
  )
  const menuContent = <UiOverlayLayerProvider id={overlay.id}>{menuBody}</UiOverlayLayerProvider>

  return (
    <div className={`relative ${toolbarLayout ? UI_FIELD_INLINE_ROW_CLASS : 'inline-block'} ${className || ''}`} ref={ref}>
      {label ? <label className={toolbarLayout ? UI_FIELD_LABEL_INLINE_CLASS : UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiFieldTrigger
        ref={triggerRef}
        disabled={disabled}
        size={size}
        appearance={appearance === 'text' ? 'quiet' : 'field'}
        open={open && !closing}
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
        className={`${disabled ? '' : 'cursor-pointer'} ${buttonClassName || 'w-full'}`}
        style={buttonMinWidthPx ? { minWidth: `${buttonMinWidthPx}px` } : undefined}
      >
        {resolvedDisplay}
      </UiFieldTrigger>
      {(open || closing) && (
        portal && fixedPos ? (
          createPortal(
            <div
              ref={panelRef}
              className={`${UI_TRIGGER_PANEL_SURFACE_CLASS[surface]} ${UI_TRIGGER_PANEL_PADDING_CLASS[panelPadding]} ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
              style={{
                position: 'fixed',
                top: fixedPos.top,
                left: fixedPos.left,
                width: optionsPanelWidth !== null
                  ? Math.max(fixedPos.width, optionsPanelWidth)
                  : fixedPos.width,
                zIndex
              }}
              data-dropdown-portal="true"
              data-dropdown-placement={fixedPos.placement}
              {...overlay.layerProps}
            >
              {menuContent}
            </div>,
            // 挂到触发器所在文档：系统浮窗里的下拉留在浮窗内。
            ownerDocumentOf(ref.current).body
          )
        ) : (
          <div
            ref={panelRef}
            // 非 portal 面板在触发器所在的层叠上下文里展开，只需盖住同一上下文里的兄弟内容：下拉档即可
            className={`absolute left-0 z-dropdown ${fixedPos?.placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'} ${panelWidthStrategy === 'options' ? 'w-auto' : 'w-full'} ${UI_TRIGGER_PANEL_SURFACE_CLASS[surface]} ${UI_TRIGGER_PANEL_PADDING_CLASS[panelPadding]} ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
            // 非 portal 面板与触发器同一定位上下文：不窄于触发器（100%），选项更长时按内容加宽
            style={optionsPanelWidth !== null ? { minWidth: `max(100%, ${optionsPanelWidth}px)` } : undefined}
            data-dropdown-portal="true"
            data-dropdown-placement={fixedPos?.placement ?? 'below'}
            {...overlay.layerProps}
          >
            {menuContent}
          </div>
        )
      )}
    </div>
  )
}
