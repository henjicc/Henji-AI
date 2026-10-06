import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shouldClosePanelAfterInternalClick } from './panelTriggerClosePolicy'
import {
  hasOpenModalUiOverlayAbove,
  isTopmostUiOverlay,
  resolveUiOverlayTarget,
  UiOverlayLayerProvider,
  useHasOpenModalUiOverlayDescendant,
  useUiOverlayLayer,
} from './overlayOwnership'
import {
  resolveFloatingPanelPosition,
  type FloatingPanelAnchorRect,
  type FloatingPanelPosition,
} from './floatingPanelPosition'
import { UI_FIELD_INLINE_ROW_CLASS, UI_FIELD_LABEL_CLASS, UI_FIELD_LABEL_INLINE_CLASS, UI_TRIGGER_PANEL_PADDING_CLASS, UI_TRIGGER_PANEL_SURFACE_CLASS, type UiFieldSize, type UiTriggerPanelPadding, type UiTriggerPanelSurface } from './styleTokens'
import { UiFieldLayoutContext, useUiFieldLayout } from './fieldLayout'
import { useUiFormRowLabelling } from './formRowLabel'
import { measureElementTextWidth } from './textMeasurement'
import { MENU_TEXT_ROUNDING_SLACK_PX, resolveMenuItemHorizontalChrome, type UiMenuSelection } from './dropdownUtils'
import { UiFieldTrigger } from './primitives'
import { UI_DURATION } from './motion'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { isDomNode, isElementNode, ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'

type PanelTriggerProps = {
  label?: string
  display?: string
  disabled?: boolean
  className?: string
  /** 触发器的布局类（宽度、最大宽度、弹性）。外观只由 size 决定（check:surface 规则 E）。默认 `w-full`。 */
  buttonClassName?: string
  /** 触发器尺寸档：sm 28 / md 32（默认）/ lg 36，字号随档位。 */
  size?: UiFieldSize
  /**
   * 触发器外观：`field` = raised 字段表面；`quiet` = 静默按钮皮肤（工具条里的入口）。
   * 不传时随字段排布：`UiFieldLayoutContext` 为 `toolbar` 时取 `quiet`，否则 `field`。
   */
  appearance?: 'field' | 'quiet'
  /** 浮层表面：默认实底；压在画布、图片、视频、3D 视口上时传 `glass`。 */
  surface?: UiTriggerPanelSurface
  /** 浮层内边距档（none / menu 4px / content 12px）；浮层外壳表面不接受覆盖。 */
  panelPadding?: UiTriggerPanelPadding
  zIndex?: number
  /** 浮层宽度：像素值；`content` = 按内容自然宽度（受视口约束），右键菜单这类没有触发器宽度可参照的浮层用。不传时取触发器宽度。 */
  panelWidth?: number | 'content'
  /** 可选的最近宿主边界，如画布可见区域。 */
  boundarySelector?: string
  /** 纯文字菜单可传入全部项目文案，在打开前按最长项计算稳定宽度。 */
  panelWidthLabels?: readonly string[]
  /** 配合 `panelWidthLabels`：`none` 动作菜单（默认，项上没有勾，不留勾槽）/ `single` 选值菜单（预留选中勾槽）。 */
  menuSelection?: UiMenuSelection
  /** bottomLeft：下方左对齐；bottomRight：下方右缘对齐（卡片角上的“更多”按钮）；aboveCenter：上方居中。空间不足时自动翻到另一侧。 */
  alignment?: 'bottomLeft' | 'bottomRight' | 'aboveCenter'
  /** aboveCenter 对齐时面板底部与触发按钮顶部的间距（默认 45；工具条排布下默认 8；与画布节点行内紧凑触发器保持一致时可调小） */
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
  /** 受控打开：父组件需要从外部打开浮层（如生成前校验失败时定位到收起的参数）时使用。 */
  controlsRef?: React.MutableRefObject<PanelTriggerControls | null>
  /**
   * 受控开合：传入后由父组件持有开合状态。浮层自己发起的收起（点外、Escape、面板内点击）在收起动画结束后
   * 回调 `onOpenChange(false)`；触发器打开时回调 `onOpenChange(true)`。
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * 锚点模式（任务 5.9）：不渲染内置触发器，浮层定位到外部元素或一个矩形（右键菜单的指针位置、
   * 卡片角上的“更多”按钮）。传元素时按其实时位置定位，且点在该元素上不算点外（由它自己切换开合）。
   * 与 `open` / `onOpenChange` 配合使用；浮层归属、Escape 只关最上层、宽度与选中态都与普通面板相同。
   */
  anchor?: Element | FloatingPanelAnchorRect | null
}

function isAnchorElement(anchor: Element | FloatingPanelAnchorRect | null | undefined): anchor is Element {
  return isElementNode(anchor)
}

/** 矩形锚点按数值比较，调用点每次渲染新建字面量也不会触发重新定位。 */
function anchorDependencyKey(anchor: Element | FloatingPanelAnchorRect | null | undefined): Element | string | null {
  if (!anchor) return null
  if (isAnchorElement(anchor)) return anchor
  return `${anchor.left},${anchor.top},${anchor.bottom},${anchor.width}`
}

export type PanelTriggerControls = {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
}

/**
 * 排到当前事件分发结束之后执行（宏任务）。MessageChannel 不像 setTimeout 那样在后台窗口被节流到秒级。
 */
function runAfterCurrentEvent(callback: () => void): void {
  if (typeof MessageChannel === 'undefined') {
    window.setTimeout(callback, 0)
    return
  }
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    callback()
  }
  channel.port2.postMessage(null)
}

const PANEL_VIEWPORT_GUTTER_PX = 8
const PANEL_VIEWPORT_TOP_INSET_PX = 48
// 标准文字菜单：列表内边距 p-1（8）+ 菜单项留白 + 边框（2）+ 取整余量。
// 菜单项留白只有选值菜单才含选中勾槽（4.3 补勾槽；5.9 动作菜单不再预留，否则两侧空出 56px）。
function resolvePanelTextMenuHorizontalChrome(selection: UiMenuSelection): number {
  return 8 + resolveMenuItemHorizontalChrome('md', selection) + 2 + MENU_TEXT_ROUNDING_SLACK_PX
}

export default function PanelTrigger(props: PanelTriggerProps): React.ReactElement {
  const {
    label,
    display,
    disabled,
    className,
    buttonClassName,
    size = 'md',
    appearance,
    panelPadding = 'none',
    surface = 'solid',
    zIndex = Z_LAYERS.popover,
    panelWidth,
    boundarySelector,
    panelWidthLabels,
    menuSelection = 'none',
    alignment = 'bottomLeft',
    gap: gapOverride,
    panelHeight: _panelHeight,
    closeOnPanelClick,
    renderPanel,
    stableHeight,
    stableHeightKey,
    freezePositionOnOpen = false,
    children,
    controlsRef,
    open: openProp,
    onOpenChange,
    anchor,
  } = props
  const anchorMode = anchor !== undefined
  const contentWidth = panelWidth === 'content'
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const anchorKey = anchorDependencyKey(anchor)
  const fieldLayout = useUiFieldLayout()
  // 放在 UiFormRow 里的内置触发器：读作“行标签 + 当前值”（任务 5.8，B-50）
  const triggerId = `panel-trigger-${useId().replace(/:/g, '')}`
  const formRowLabelling = useUiFormRowLabelling()
  const rowLabelledBy = !label && formRowLabelling ? `${formRowLabelling.labelId} ${triggerId}` : undefined
  const toolbarLayout = fieldLayout === 'toolbar'
  const resolvedAppearance = appearance ?? (toolbarLayout ? 'quiet' : 'field')
  // 表单排布的触发器在输入区顶部，浮层要越过整块输入区；工具条里的触发器就近弹出。
  const gapProp = gapOverride ?? (toolbarLayout ? 8 : 45)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const overlay = useUiOverlayLayer(open)
  // 从面板里打开的弹窗期间面板让开（浮层层级高于弹窗，否则压在弹窗上），保持挂载，弹窗关闭后原样回来（任务 5.8）
  const yieldToModal = useHasOpenModalUiOverlayDescendant(overlay.id)
  const [pos, setPos] = useState<FloatingPanelPosition | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const anchorRectRef = useRef<FloatingPanelAnchorRect | null>(null)
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
      resolvePanelTextMenuHorizontalChrome(menuSelection),
    )
    if (nextWidth !== null && lastMeasuredPanelWidthRef.current !== nextWidth) {
      lastMeasuredPanelWidthRef.current = nextWidth
      setMeasuredPanelWidth(nextWidth)
    }
  }, [menuSelection, panelWidthLabels])

  const resolvedPanelWidth = typeof panelWidth === 'number' ? panelWidth : (contentWidth ? null : measuredPanelWidth)

  /** 浮层定位的锚点：锚点模式取外部元素实时位置或给定矩形，否则取内置触发器。 */
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const readAnchorRect = useCallback((): FloatingPanelAnchorRect | null => {
    if (anchorMode) {
      const current = anchorRef.current
      if (!current) return null
      return isAnchorElement(current) ? current.getBoundingClientRect() : current
    }
    if (!ref.current) return null
    const btn = ref.current.querySelector('[data-panel-trigger-button]') as HTMLElement | null
    return (btn || ref.current).getBoundingClientRect()
  }, [anchorMode])

  useEffect(() => {
    maxHeightRef.current = 0
  }, [stableHeightKey])

  const updatePanelPosition = useCallback((rect: FloatingPanelAnchorRect, reveal: boolean): void => {
    anchorRectRef.current = rect
    const measuredPanelHeight = Math.max(
      _panelHeight ?? 0,
      panelRef.current?.scrollHeight ?? 0,
      panelRef.current?.getBoundingClientRect().height ?? 0,
    )
    const position = resolveFloatingPanelPosition({
      anchor: rect,
      boundary: boundarySelector ? ref.current?.closest(boundarySelector)?.getBoundingClientRect() : undefined,
      panelWidth: resolvedPanelWidth ?? (contentWidth ? (panelRef.current?.offsetWidth ?? 0) : rect.width),
      panelHeight: measuredPanelHeight,
      viewportWidth: ownerWindowOf(ref.current).innerWidth,
      viewportHeight: ownerWindowOf(ref.current).innerHeight,
      preferredPlacement: alignment === 'aboveCenter' ? 'above' : 'below',
      horizontalAlign: alignment === 'aboveCenter' ? 'center' : alignment === 'bottomRight' ? 'right' : 'left',
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
  }, [_panelHeight, alignment, boundarySelector, contentWidth, gapProp, resolvedPanelWidth, stableHeight])

  const computePanelPosition = useCallback((): void => {
    const rect = readAnchorRect()
    if (!rect) return
    setReady(false)
    updatePanelPosition(rect, false)
  }, [readAnchorRect, updatePanelPosition])

  // 收起动画期间（UI_DURATION.base）再次点触发器应当留在打开态，而不是被当成“已打开 → 关闭”：
  // 收起计时器可被取消（界面重设计 3.5：剪辑面板的新建/更多菜单连续使用时暴露）。
  const closeTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  // 收起完成：计时器或收起动画结束，谁先到算谁（界面重设计 5.5 VE-06）。窗口在后台或被遮挡时 Chromium 会把
  // 计时器节流到秒级甚至分钟级，只靠计时器时，已经关掉的菜单会长时间停在收起态、仍挂在页面上。
  const finishClose = useCallback((): void => {
    if (closeTimerRef.current === undefined) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
    setOpen(false)
    setClosing(false)
    onOpenChangeRef.current?.(false)
  }, [])

  const closePanel = useCallback((): void => {
    setClosing(true)
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(finishClose, UI_DURATION.base)
  }, [finishClose])

  const openPanel = useCallback((): void => {
    if (disabled) return
    computePanelPosition()
    setOpen(true)
    onOpenChangeRef.current?.(true)
  }, [computePanelPosition, disabled])

  // 收起动画结束即完成收起（原生事件监听：与 React 的动画事件名探测无关，jsdom 与 Chromium 一致）
  useEffect(() => {
    const panel = panelRef.current
    if (!closing || !panel) return
    const onEnd = (event: Event): void => { if (event.target === panel) finishClose() }
    panel.addEventListener('animationend', onEnd)
    return () => panel.removeEventListener('animationend', onEnd)
  }, [closing, finishClose])

  // 受控开合：父组件打开、关闭，或在打开期间换锚点（在另一处再次右键）。
  const openStateRef = useRef({ open, closing })
  openStateRef.current = { open, closing }
  useEffect(() => {
    if (openProp === undefined) return
    const { open: isOpen, closing: isClosing } = openStateRef.current
    if (openProp) {
      if (!isOpen) {
        computePanelPosition()
        setOpen(true)
        return
      }
      // 已打开或正在收起：取消收起，按新锚点就位
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = undefined
      if (isClosing) setClosing(false)
      const rect = readAnchorRect()
      if (rect) updatePanelPosition(rect, true)
      return
    }
    if (isOpen && !isClosing) closePanel()
    // 只响应受控值与锚点变化；其余依赖经 ref 读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProp, anchorKey])

  const togglePanel = useCallback((): void => {
    if (disabled) return
    if (open && closing) {
      // 仍在收起动画中：取消收起即可，面板保持原位（不重新定位，避免停在未就绪的隐藏态）。
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = undefined
      setClosing(false)
      return
    }
    if (open) {
      closePanel()
      return
    }
    openPanel()
  }, [closePanel, closing, disabled, open, openPanel])

  useEffect(() => {
    if (!controlsRef) return
    controlsRef.current = { open, openPanel, closePanel, togglePanel }
    return () => { controlsRef.current = null }
  }, [closePanel, controlsRef, open, openPanel, togglePanel])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!isDomNode(e.target)) return
      const target = e.target
      // 触发器可能挂在系统浮窗（另一 realm）里，不能用 instanceof 判定。
      const anchorElement = anchorRef.current
      const inTrigger = (!!ref.current && ref.current.contains(target))
        || (isAnchorElement(anchorElement) && anchorElement.contains(target))
      const relation = resolveUiOverlayTarget(target, overlay.id)
      if (inTrigger) return
      // 子浮层（嵌套的 PanelTrigger / Dropdown / 弹窗 / 提示词候选）里的点击归属本面板，不关闭
      if (relation === 'descendant') return
      // 从面板里打开的模态层（弹窗、查看器）期间，面板不响应点外关闭
      if (hasOpenModalUiOverlayAbove(overlay.id)) return
      // 面板内的点击在 click 冒泡阶段才收起（见下）：按下时就收起会让面板先进入不可交互的收起态，选项收不到 click
      if (relation === 'self') return
      if (open) {
        closePanel()
      }
    }
    // 面板内点击：选项自己的 onClick 先执行，这次点击分发完再按 closeOnPanelClick 收起（5.5 VE-06）。
    // 在捕获阶段判定、点击分发结束后执行（任务 5.8）：不能等点击冒泡到文档——面板所在的 React 树里
    // 祖先常有 onClick 阻止冒泡（生成输入卡片），文档根本收不到，生成页选完模型面板就不收起；
    // 选项的 onClick 也可能同步重渲染，把被点的节点换掉，冒泡时再判“是否在本面板内”会落空。
    // 用 MessageChannel 排到本次事件之后：不受后台窗口计时器节流影响。
    const clickCaptureHandler = (e: MouseEvent) => {
      if (!open || !isDomNode(e.target)) return
      if (resolveUiOverlayTarget(e.target, overlay.id) !== 'self') return
      if (!shouldClosePanelAfterInternalClick(closeOnPanelClick, e.target)) return
      runAfterCurrentEvent(closePanel)
    }
    // 按触发器所在文档监听：浮窗中的面板在浮窗内打开与关闭，主窗口行为不变。
    const ownerDocument = ownerDocumentOf(ref.current)
    // 同时听 pointerdown：时间线、画布这类在 pointerdown 里 preventDefault 的区域不会再派发 mousedown，
    // 只听 mousedown 时点那里关不掉菜单（剪辑时间线右键菜单点空白不关）。
    ownerDocument.addEventListener('pointerdown', handler, true)
    ownerDocument.addEventListener('mousedown', handler, true)
    ownerDocument.addEventListener('click', clickCaptureHandler, true)
    return () => {
      ownerDocument.removeEventListener('pointerdown', handler, true)
      ownerDocument.removeEventListener('mousedown', handler, true)
      ownerDocument.removeEventListener('click', clickCaptureHandler, true)
    }
  }, [closePanel, open, closeOnPanelClick, overlay.id])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 嵌套时只关最上层
      if (!isTopmostUiOverlay(overlay.id)) return
      // 焦点不在本浮层里（如文本框上弹出的粘贴菜单）：这次 Escape 只属于最上层浮层，不再传给焦点元素
      // （否则文本框自己的 Escape 也会执行，例如取消正在输入的预设名）。焦点在浮层内时照常传递。
      if (resolveUiOverlayTarget(event.target, overlay.id) === 'outside') event.stopPropagation()
      closePanel()
    }
    // 捕获阶段处理：浮层内的输入框常为避免触发画布快捷键而阻止按键冒泡，冒泡阶段收不到 Escape
    const ownerDocument = ownerDocumentOf(ref.current)
    ownerDocument.addEventListener('keydown', handler, true)
    return () => ownerDocument.removeEventListener('keydown', handler, true)
  }, [closePanel, open, overlay.id])

  useEffect(() => {
    const updateAnchor = (reveal: boolean) => {
      const rect = readAnchorRect()
      if (!rect) return
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
      const boundary = boundarySelector ? ref.current?.closest(boundarySelector) : null
      const ownerWindow = ownerWindowOf(ref.current)
      // 没有 ResizeObserver 的环境（jsdom 单测）只靠滚动与窗口尺寸事件重新定位
      const boundaryObserver = boundary && ownerWindow.ResizeObserver ? new ownerWindow.ResizeObserver(onScrollOrResize) : null
      if (boundary) boundaryObserver?.observe(boundary)
      ownerWindow.addEventListener('scroll', onScrollOrResize, true)
      ownerWindow.addEventListener('resize', onScrollOrResize)
      return () => {
        boundaryObserver?.disconnect()
        ownerWindow.removeEventListener('scroll', onScrollOrResize, true)
        ownerWindow.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [boundarySelector, freezePositionOnOpen, open, readAnchorRect, updatePanelPosition])

  useLayoutEffect(() => {
    if (!open) return
    if (!anchorRectRef.current) return
    updatePanelPosition(anchorRectRef.current, true)
  }, [open, updatePanelPosition])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const PanelResizeObserver = ownerWindowOf(panelRef.current).ResizeObserver
    if (!PanelResizeObserver) return
    const obs = new PanelResizeObserver(() => {
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

  // 锚点模式没有内置触发器：留一个隐藏节点，用来得知所在文档（主窗口或剪辑系统浮窗）。
  const anchorOnly = anchorMode && !children
  return (
    <div
      className={anchorOnly ? undefined : `relative ${toolbarLayout ? UI_FIELD_INLINE_ROW_CLASS : 'inline-block'} ${className || ''}`}
      hidden={anchorOnly || undefined}
      ref={ref}
    >
      {!anchorOnly && label ? <label className={toolbarLayout ? UI_FIELD_LABEL_INLINE_CLASS : UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      {anchorOnly ? null : children ? children({ open, openPanel, closePanel, togglePanel }) : (
        <UiFieldTrigger
          disabled={disabled}
          size={size}
          appearance={resolvedAppearance}
          open={open && !closing}
          onClick={togglePanel}
          data-panel-trigger-button
          id={triggerId}
          aria-labelledby={rowLabelledBy}
          aria-expanded={open && !closing}
          className={`${disabled ? '' : 'cursor-pointer'} ${buttonClassName || 'w-full'}`}
        >
          {display ?? ''}
        </UiFieldTrigger>
      )}
      {(open || closing) && pos && createPortal(
        <div
          ref={panelRef}
          className={`${UI_TRIGGER_PANEL_SURFACE_CLASS[surface]} ${UI_TRIGGER_PANEL_PADDING_CLASS[panelPadding]} flex flex-col ${contentWidth ? 'w-max' : ''} ${closing ? 'pointer-events-none animate-scale-out' : 'animate-scale-in'}`}
          // 收起中的面板已经关闭：不再接收指针与键盘，也不再暴露给读屏与按角色查找（否则会和新打开的菜单并存、被点中）
          aria-hidden={closing || undefined}
          {...(closing ? { inert: '' } : {})}
          style={{
            position: 'fixed',
            top: pos.placement === 'above' ? undefined : pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: contentWidth ? undefined : pos.width,
            maxWidth: contentWidth ? ownerWindowOf(ref.current).innerWidth - PANEL_VIEWPORT_GUTTER_PX * 2 : undefined,
            maxHeight: pos.maxHeight,
            minHeight: stableHeight && maxHeightRef.current ? Math.min(maxHeightRef.current, pos.maxHeight) : undefined,
            zIndex,
            opacity: ready ? 1 : 0,
            visibility: ready && !yieldToModal ? 'visible' : 'hidden'
          }}
          data-panel-placement={pos.placement}
          {...overlay.layerProps}
        >
          <div
            data-panel-scroll-region
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {/* 浮层里的字段一律按表单排布，不继承触发器所在工具条的排布 */}
            <UiOverlayLayerProvider id={overlay.id}>
              <UiFieldLayoutContext.Provider value="form">
                {renderPanel()}
              </UiFieldLayoutContext.Provider>
            </UiOverlayLayerProvider>
          </div>
        </div>,
        // 面板挂到触发器所在文档：系统浮窗里的菜单留在浮窗内。
        ownerDocumentOf(ref.current).body
      )}
    </div>
  )
}
