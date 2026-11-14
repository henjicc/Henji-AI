import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
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
import { UI_FIELD_INLINE_ROW_CLASS, UI_FIELD_LABEL_CLASS, UI_FIELD_LABEL_INLINE_CLASS, UI_TRIGGER_PANEL_SIZE_CLASS, type UiTriggerPanelSize, UI_TRIGGER_PANEL_PADDING_CLASS, UI_TRIGGER_PANEL_SURFACE_CLASS, type UiFieldSize, type UiTriggerPanelPadding, type UiTriggerPanelSurface } from './styleTokens'
import { UiFieldLayoutContext, useUiFieldLayout } from './fieldLayout'
import { useUiFormRowLabelling } from './formRowLabel'
import { UiFieldTrigger, UiOptionButton } from './primitives'
import { UI_POPOVER_TRANSITION_MS } from './motion'
import { useDialogTransition } from './useDialogTransition'
import { resolveDropdownDisplay, resolveDropdownMenuWidth } from './dropdownUtils'
import { resolvePopoverMotionStyle } from './floatingPanelPosition'
import { UiBooleanAppearanceContext } from './booleanAppearance'
import { hasOpenModalUiOverlayAbove, resolveUiOverlayTarget, UiOverlayLayerProvider, useHasOpenModalUiOverlayDescendant, useUiOverlayLayer } from './overlayOwnership'
import { measureElementTextWidth } from './textMeasurement'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { isDomNode, ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'

const DROPDOWN_PANEL_GAP_PX = 8

export type DropdownOption<T extends string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
  tooltip?: string
}

type DropdownProps<T extends string | number | boolean> = {
  label?: string
  value?: T
  display?: string
  options?: DropdownOption<T>[]
  /** 普通选项下拉为空时的占位；自定义 renderPanel 不受选项数量影响。 */
  emptyLabel?: string
  onSelect?: (value: T) => void
  onPreview?: (value: T | undefined) => void
  renderPanel?: () => React.ReactNode
  disabled?: boolean
  disabledReason?: string
  className?: string
  /** 触发器的布局类（宽度、最大宽度、弹性）。外观只由 size / appearance 决定（check:surface 规则 E）。默认 `w-full`。 */
  buttonClassName?: string
  /** 触发器与选项的尺寸档：sm 28 / md 32（默认）/ lg 36，字号随档位。 */
  size?: UiFieldSize
  /** 浮层表面：默认实底；压在画布、图片、视频、3D 视口上时传 `glass`。 */
  surface?: UiTriggerPanelSurface
  /** 浮层内边距档；浮层外壳表面不接受覆盖。 */
  panelSize?: UiTriggerPanelSize
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
  /** `text` 外观下取值偏离默认（筛选已生效）时传 true，文字提亮；`field` 外观不受影响。 */
  changed?: boolean
  /** 菜单开合通知（宿主需要在菜单打开期间保持自身可见时用，如视频查看器的控制条）。 */
  onOpenChange?: (open: boolean) => void
  /**
   * 放在表单行里时的宽度：默认 `content`，按最长选项定宽并吸附 72 / 112 / 152 三档（超过 152 按内容，不超过控件列）；
   * 选项是用户内容或很长的动态名称（序列、素材、设备）时传 `fill` 铺满控件列。
   */
  width?: 'content' | 'fill'
}

/** 表单行里取值下拉的宽度档：同一面板里控件右缘只落在这几处，不随每个选项的字数参差。 */
const DROPDOWN_ROW_WIDTH_TIERS_PX = [72, 112, 152] as const

function dropdownRowWidth(measured: number): number {
  return DROPDOWN_ROW_WIDTH_TIERS_PX.find(tier => tier >= measured) ?? Math.ceil(measured)
}

export default function Dropdown<T extends string | number | boolean>(props: DropdownProps<T>) {
  const {
    label,
    value,
    display,
    options,
    emptyLabel,
    onSelect,
    onPreview,
    renderPanel,
    disabled: disabledOverride,
    disabledReason,
    className,
    buttonClassName,
    size = 'md',
    panelPadding = 'none',
    panelSize,
    surface = 'solid',
    ariaLabel,
    ariaLabelledBy,
    portal = true,
    zIndex = Z_LAYERS.popover,
    minWidthStrategy: minWidthStrategyOverride = 'display',
    panelWidthStrategy = 'options',
    appearance: appearanceOverride,
    changed = false,
    onOpenChange,
    width,
  } = props
  const { t } = useTranslation('ui')
  const empty = !renderPanel && !options?.length
  const disabled = disabledOverride || empty
  const formRowLabelling = useUiFormRowLabelling()
  const fieldLayout = useUiFieldLayout()
  // 表单行里的取值下拉按选项定宽；调用点自己给了宽度、量宽方式或自定义面板时照旧
  const rowContent = Boolean(formRowLabelling) && fieldLayout !== 'toolbar' && width !== 'fill' && !renderPanel
    && className === undefined && buttonClassName === undefined && props.minWidthStrategy === undefined
  const fillControl = (formRowLabelling?.fillControl === true || width === 'fill') && !rowContent
  const minWidthStrategy = fillControl || rowContent ? 'none' : minWidthStrategyOverride
  const toolbarLayout = !fillControl && !rowContent && fieldLayout === 'toolbar'
  const appearance = appearanceOverride ?? (toolbarLayout ? 'text' : 'field')
  // 停靠属性面板里与读数同一种静默外观：静息无底，悬停或打开才出字段底
  const triggerAppearance = appearance === 'text' ? 'quiet' : fieldLayout === 'property' ? 'property' : 'field'
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusOnCloseRef = useRef(false)
  const { shouldRender, closing } = useDialogTransition(open, UI_POPOVER_TRANSITION_MS, true, {
    exitRef: panelRef,
    onExited: () => {
      if (restoreFocusOnCloseRef.current) triggerRef.current?.focus()
      restoreFocusOnCloseRef.current = false
    },
  })
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview
  const scheduleClose = useCallback((restoreFocus = false): void => {
    previewRef.current?.(undefined)
    restoreFocusOnCloseRef.current = restoreFocus
    setOpen(false)
  }, [])
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
  const overlay = useUiOverlayLayer(shouldRender)
  // 从下拉面板里打开的弹窗期间面板让开（同 PanelTrigger，任务 5.8）
  const yieldToModal = useHasOpenModalUiOverlayDescendant(overlay.id)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const menuShown = open && !closing && !disabled
  const notifiedOpenRef = useRef(false)
  useEffect(() => {
    if (notifiedOpenRef.current === menuShown) return
    notifiedOpenRef.current = menuShown
    onOpenChangeRef.current?.(menuShown)
  }, [menuShown])
  const ref = useRef<HTMLDivElement | null>(null)
  const dropdownId = useId().replace(/:/g, '')
  const panelId = `dropdown-panel-${dropdownId}`
  const triggerId = `dropdown-trigger-${dropdownId}`
  // 放在 UiFormRow 里且没有自己的名称：读作“行标签 + 当前值”（任务 5.8，B-50）
  const rowLabelledBy = !ariaLabel && !label && !ariaLabelledBy && formRowLabelling ? `${formRowLabelling.labelId} ${triggerId}` : undefined
  const [fixedPos, setFixedPos] = useState<{
    top: number
    left: number
    width: number
    placement: 'above' | 'below'
    /** 触发器的左缘与宽度：进出场的缩放中心落在触发器中线上 */
    anchor: { left: number; top: number; width: number; height: number }
  } | null>(null)
  const [buttonMinWidthPx, setButtonMinWidthPx] = useState<number | null>(null)
  const [rowWidthPx, setRowWidthPx] = useState<number | null>(null)
  const [panelMinWidthPx, setPanelMinWidthPx] = useState<number | null>(null)
  const lastButtonMinWidthRef = useRef<number | null>(null)
  const lastPanelMinWidthRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // 选项超过可视高度时列表出现竖向滚动条，它占用的宽度要加到菜单宽度上，
  // 否则带勾的选中项会被挤成“5.”“智…”（任务 5.3）。打开后、绘制前测量一次。
  const [scrollGutterPx, setScrollGutterPx] = useState(0)
  const resolvedDisplay = empty
    ? emptyLabel ?? t('dropdown.emptyLabel', { defaultValue: '暂无可选项' })
    : (!renderPanel && !display?.trim() && !options?.some(option => option.value === value)
      ? t('dropdown.unselectedLabel')
      : resolveDropdownDisplay(display, value, options).trim() || t('dropdown.unselectedLabel'))
  useEffect(() => {
    if (!disabled || (!open && !closing)) return
    setOpen(false)
    setActiveOptionIndex(-1)
  }, [disabled, open, closing])
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
    scheduleClose()
  }
  const openPanel = (): void => {
    const selectedIndex = (options || []).findIndex((option) => isSelectedOption(option.value) && !option.disabled)
    setActiveOptionIndex(selectedIndex >= 0 ? selectedIndex : (enabledOptionIndices()[0] ?? -1))
    setOpen(true)
  }
  const closePanel = (restoreFocus = false): void => {
    if (!open) return
    scheduleClose(restoreFocus)
  }
  const moveActiveOption = (direction: 1 | -1): void => {
    const indices = enabledOptionIndices()
    if (indices.length === 0) return
    const currentPosition = indices.indexOf(activeOptionIndex)
    const nextPosition = currentPosition < 0
      ? (direction === 1 ? 0 : indices.length - 1)
      : (currentPosition + direction + indices.length) % indices.length
    setActiveOptionIndex(indices[nextPosition])
    onPreview?.(options?.[indices[nextPosition]].value)
  }
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!menuShown) openPanel()
      else moveActiveOption(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!menuShown) openPanel()
      else moveActiveOption(-1)
      return
    }
    if (event.key === 'Home' && menuShown) {
      event.preventDefault()
      setActiveOptionIndex(enabledOptionIndices()[0] ?? -1)
      return
    }
    if (event.key === 'End' && menuShown) {
      event.preventDefault()
      const indices = enabledOptionIndices()
      setActiveOptionIndex(indices[indices.length - 1] ?? -1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!menuShown) {
        openPanel()
        return
      }
      const option = options?.[activeOptionIndex]
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape' && menuShown) {
      event.preventDefault()
      // 这次 Escape 只属于打开中的下拉：不再冒泡到文档，否则外层弹窗（设置等）的焦点陷阱会把整个弹窗一起关掉
      event.stopPropagation()
      closePanel(true)
      return
    }
    if (event.key === 'Tab' && menuShown) closePanel()
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
      // 下拉打开后又弹出的模态层（如全局确认框）期间，下拉不响应点外关闭（5.8）
      if (!inTrigger && !inPanel && !hasOpenModalUiOverlayAbove(overlay.id)) {
        if (open) scheduleClose()
      }
    }
    // 捕获阶段监听：画布内多处控件会在冒泡阶段 stopPropagation（避免触发节点拖拽），
    // 用捕获阶段确保点击节点内其它空白处也能正常关闭下拉
    // 按触发器所在文档监听，系统浮窗中的下拉在浮窗内关闭；主窗口行为不变。
    const ownerDocument = ownerDocumentOf(ref.current)
    // 同时听 pointerdown：在 pointerdown 里 preventDefault 的区域（时间线、画布）不会再派发 mousedown
    ownerDocument.addEventListener('pointerdown', handler, true)
    ownerDocument.addEventListener('mousedown', handler, true)
    return () => { ownerDocument.removeEventListener('pointerdown', handler, true); ownerDocument.removeEventListener('mousedown', handler, true) }
  }, [open, overlay.id, scheduleClose])

  // 调用方常每次渲染都传新的 options 数组与 renderPanel 函数；按文字内容决定要不要重新量宽，
  // 否则父组件每次重绘（如拖动播放头）都会读计算样式、强制重算样式并重新量一遍文字。
  const optionLabelsKey = JSON.stringify(getOptionLabels(options))
  const customPanel = Boolean(renderPanel)
  useLayoutEffect(() => {
    if (!ref.current) return
    const btn = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
    if (!btn) return
    const computeMinWidth = () => {
      const displayText = resolvedDisplay
      const optionLabels = JSON.parse(optionLabelsKey) as string[]
      if (rowContent) {
        // 当前显示文字也量进去：占位（“选择对象”“未选择”）或不在选项里的显示值可能比所有选项都长
        const measured = measureTextMinWidth(btn, [...optionLabels, displayText])
        const next = measured === null ? null : dropdownRowWidth(measured)
        if (next !== rowWidthPx) setRowWidthPx(next)
      } else if (rowWidthPx !== null) setRowWidthPx(null)
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
      const nextPanelMinWidth = textWidth === null ? null : resolveDropdownMenuWidth(textWidth, size, customPanel ? 'none' : 'single')
      if (nextPanelMinWidth !== null && lastPanelMinWidthRef.current !== nextPanelMinWidth) {
        lastPanelMinWidthRef.current = nextPanelMinWidth
        setPanelMinWidthPx(nextPanelMinWidth)
      }
    }
    computeMinWidth()
  }, [buttonMinWidthPx, customPanel, minWidthStrategy, optionLabelsKey, panelMinWidthPx, panelWidthStrategy, resolvedDisplay, rowContent, rowWidthPx, size])

  const hasFixedPosition = fixedPos !== null
  useLayoutEffect(() => {
    const updatePos = () => {
      if (!ref.current) return
      const el = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
      const target = el || ref.current
      const rect = target.getBoundingClientRect()
      const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 0
      const panelWidth = panelSize ? (panelRef.current?.getBoundingClientRect().width ?? rect.width) : panelWidthStrategy === 'options' && panelMinWidthPx
        ? Math.max(rect.width, panelMinWidthPx + scrollGutterPx)
        : rect.width
      const viewportPadding = 8
      const viewport = ownerWindowOf(ref.current)
      const spaceBelow = viewport.innerHeight - rect.bottom - viewportPadding
      const placement = panelHeight > spaceBelow ? 'above' : 'below'
      const top = placement === 'above'
        ? Math.max(viewportPadding, rect.top - panelHeight - DROPDOWN_PANEL_GAP_PX)
        : Math.min(rect.bottom + DROPDOWN_PANEL_GAP_PX, viewport.innerHeight - viewportPadding)
      // 一行参数条里的触发器只有值那么宽，菜单常比它宽：居中对齐触发器；表单字段左缘对齐
      const preferredLeft = toolbarLayout ? rect.left + rect.width / 2 - panelWidth / 2 : rect.left
      const left = Math.min(
        Math.max(viewportPadding, preferredLeft),
        Math.max(viewportPadding, viewport.innerWidth - panelWidth - viewportPadding)
      )
      setFixedPos({ top, left, width: rect.width, placement, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } })
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
  }, [open, shouldRender, panelMinWidthPx, panelWidthStrategy, scrollGutterPx, panelSize, hasFixedPosition, toolbarLayout])

  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const gutter = Math.max(0, list.offsetWidth - list.clientWidth)
    if (gutter !== scrollGutterPx) setScrollGutterPx(gutter)
  }, [fixedPos, open, shouldRender, options, scrollGutterPx])

  const optionsPanelWidth = panelWidthStrategy === 'options' && panelMinWidthPx
    ? panelMinWidthPx + scrollGutterPx
    : null

  const menuBody = renderPanel ? (
    <div id={panelId} className={panelSize ? "max-h-[var(--trigger-panel-max-height)] overflow-y-auto" : "max-h-60 overflow-y-auto"}>
      {/* 浮层里的字段一律按表单排布，不继承触发器所在工具条的排布 */}
      <UiFieldLayoutContext.Provider value="form"><UiBooleanAppearanceContext.Provider value="pill">{renderPanel()}</UiBooleanAppearanceContext.Provider></UiFieldLayoutContext.Provider>
    </div>
  ) : (
    <div
      ref={listRef}
      id={panelId}
      role="listbox"
      aria-label={ariaLabel ?? label ?? resolvedDisplay}
      aria-labelledby={ariaLabelledBy}
      className={panelSize ? "max-h-[var(--trigger-panel-max-height)] overflow-y-auto p-1" : "max-h-60 overflow-y-auto p-1"}
    >
      {(options || []).map((option, index) => {
        const selected = isSelectedOption(option.value)
        const button = (
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
            tooltip={option.tooltip}
            disabledReason={option.disabled ? option.tooltip : undefined}
            className="w-full cursor-pointer justify-between gap-2"
            onMouseEnter={() => { setActiveOptionIndex(index); if (!option.disabled) onPreview?.(option.value) }}
            onMouseLeave={() => onPreview?.(undefined)}
            onFocus={() => { if (!option.disabled) onPreview?.(option.value) }}
            onBlur={() => onPreview?.(undefined)}
            onClick={() => selectOption(option)}
          >
            <span className="block min-w-0 truncate whitespace-nowrap">{option.label}</span>
            {/* 当前值：淡强调底 + 强调色勾（重要记录 012），标签保持主要文字 */}
            {selected ? <Check aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-accent-text`} /> : null}
          </UiOptionButton>
        )
        return button
      })}
    </div>
  )
  const menuContent = <UiOverlayLayerProvider id={overlay.id}>{menuBody}</UiOverlayLayerProvider>

  return (
    <div className={`relative ${fillControl ? 'block min-w-0' : rowContent ? 'inline-block min-w-0 max-w-full align-middle' : toolbarLayout ? UI_FIELD_INLINE_ROW_CLASS : 'inline-block'} ${className || ''}`} style={fillControl ? { width: '100%' } : undefined} ref={ref}>
      {label ? <label htmlFor={triggerId} className={toolbarLayout ? UI_FIELD_LABEL_INLINE_CLASS : UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiFieldTrigger
        disabledReason={disabledReason}
        ref={triggerRef}
        disabled={disabled}
        size={size}
        appearance={triggerAppearance}
        changed={changed}
        open={menuShown}
        onClick={() => {
          if (disabled) return
          // 收起中再次点击触发器视为重新打开（与 PanelTrigger 一致）
          if (menuShown) {
            closePanel()
          } else {
            openPanel()
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        data-dropdown-button
        aria-haspopup="listbox"
        aria-expanded={menuShown}
        aria-controls={panelId}
        aria-activedescendant={open && activeOptionIndex >= 0 ? `${panelId}-option-${activeOptionIndex}` : undefined}
        id={triggerId}
        aria-label={ariaLabelledBy || rowLabelledBy ? undefined : ariaLabel ?? label ?? resolvedDisplay}
        aria-labelledby={ariaLabelledBy ?? rowLabelledBy}
        className={`${disabled ? '' : 'cursor-pointer'} ${rowContent ? 'max-w-full' : fillControl ? 'w-full' : buttonClassName || 'w-full'}`}
        style={rowContent ? (rowWidthPx ? { width: `${rowWidthPx}px` } : undefined) : buttonMinWidthPx ? { minWidth: `${buttonMinWidthPx}px` } : undefined}
      >
        {resolvedDisplay}
      </UiFieldTrigger>
      {!disabled && shouldRender && (
        portal && fixedPos ? (
          createPortal(
            <div
              ref={panelRef}
              className={`${panelSize ? UI_TRIGGER_PANEL_SIZE_CLASS[panelSize] : ''} ${UI_TRIGGER_PANEL_SURFACE_CLASS[surface]} ${UI_TRIGGER_PANEL_PADDING_CLASS[panelPadding]} ${closing ? 'pointer-events-none animate-scale-out' : 'animate-scale-in'}`}
              // 收起中的面板已经关闭：不再接收指针与键盘，也不再按角色暴露（与 PanelTrigger 一致）
              aria-hidden={closing || undefined}
              {...(closing ? { inert: '' } : {})}
              style={{
                ...resolvePopoverMotionStyle(fixedPos.anchor, fixedPos.left, optionsPanelWidth !== null ? Math.max(fixedPos.width, optionsPanelWidth) : fixedPos.width, fixedPos.placement),
                position: 'fixed',
                top: fixedPos.top,
                left: fixedPos.left,
                maxWidth: panelSize ? 'min(calc(100vw - 16px), var(--trigger-panel-max-width, 100vw))' : 'calc(100vw - 16px)',
                width: panelSize ? undefined : optionsPanelWidth !== null
                  ? Math.max(fixedPos.width, optionsPanelWidth)
                  : fixedPos.width,
                zIndex,
                ...(yieldToModal ? { visibility: 'hidden' as const } : {}),
              }}
              data-dropdown-portal="true"
              data-dropdown-placement={fixedPos.placement}
              data-anchor-rect={[fixedPos.anchor.left, fixedPos.anchor.top, fixedPos.anchor.width, fixedPos.anchor.height].map(Math.round).join(',')}
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
            className={`absolute left-0 z-dropdown ${fixedPos?.placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'} ${panelSize ? '' : panelWidthStrategy === 'options' ? 'w-auto' : 'w-full'} ${panelSize ? UI_TRIGGER_PANEL_SIZE_CLASS[panelSize] : ''} ${UI_TRIGGER_PANEL_SURFACE_CLASS[surface]} ${UI_TRIGGER_PANEL_PADDING_CLASS[panelPadding]} ${closing ? 'pointer-events-none animate-scale-out' : 'animate-scale-in'}`}
              // 收起中的面板已经关闭：不再接收指针与键盘，也不再按角色暴露（与 PanelTrigger 一致）
              aria-hidden={closing || undefined}
              {...(closing ? { inert: '' } : {})}
            // 非 portal 面板与触发器同一定位上下文：不窄于触发器（100%），选项更长时按内容加宽
            style={panelSize ? { maxWidth: 'min(calc(100vw - 16px), var(--trigger-panel-max-width, 100vw))' } : optionsPanelWidth !== null ? { minWidth: `max(100%, ${optionsPanelWidth}px)` } : undefined}
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
