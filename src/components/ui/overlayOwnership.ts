import { createContext, createElement, useContext, useId, useLayoutEffect, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { UiFormRowLabelContext } from './formRowLabel'

/**
 * 浮层归属（任务 4.3，语义参照 Floating UI 的 FloatingTree）。
 *
 * 每个浮层（`PanelTrigger`、`Dropdown`、资产面板及其卡片菜单/右键菜单/预览……）是一层：
 * - 层的根节点写 `data-ui-overlay-id`，层内容用 `UiOverlayLayerProvider` 包住，于是在它内部打开的
 *   子浮层（即使 portal 到 body、甚至系统浮窗文档）都通过 React 上下文认得父层；
 * - 点外判定用 `resolveUiOverlayTarget`：点在自身 = `self`，点在任一后代层 = `descendant`，否则 `outside`。
 *   嵌套浮层里的点击因此不会关掉父浮层；在所有层之外点击，各层各自关闭。
 * - 打开中的层按打开顺序入栈，Escape 只由栈顶处理（`isTopmostUiOverlay`）。
 *
 * 不在同一棵 React 树里渲染的浮层（tiptap `ReactRenderer` 挂出的提示词候选）拿不到上下文，
 * 根节点写 `data-ui-overlay-detached`：它们跟随输入焦点出现，总被视为当前层的后代。
 *
 * 此前三份平行白名单（`panelTriggerClosePolicy` 的 portal 选择器、资产面板子浮层选择器表、
 * 画布模型参数控件自己的 refs 判断）都收敛到这里。
 */

export const UI_OVERLAY_ID_ATTRIBUTE = 'data-ui-overlay-id'
export const UI_OVERLAY_DETACHED_ATTRIBUTE = 'data-ui-overlay-detached'

export type UiOverlayTargetRelation = 'self' | 'descendant' | 'outside'

const UiOverlayParentContext = createContext<string | null>(null)

/** 已挂载的层 → 父层（挂载期间登记，跨 portal 与文档判断祖先链）。 */
const overlayParents = new Map<string, string | null>()
/** 打开中的层，按打开顺序；末尾是栈顶。 */
const openOverlayStack: string[] = []
/** 打开中的模态层（全屏查看器等）：其内容可能不在层根节点 DOM 内，打开期间祖先层不响应点外关闭。 */
const openModalOverlays = new Set<string>()
/** 模态层开合的订阅者：从浮层里打开弹窗时，父浮层要让开（见 useHasOpenModalUiOverlayDescendant）。 */
const modalOverlayListeners = new Set<() => void>()
function notifyModalOverlayListeners(): void {
  for (const listener of modalOverlayListeners) listener()
}
function subscribeModalOverlays(listener: () => void): () => void {
  modalOverlayListeners.add(listener)
  return () => { modalOverlayListeners.delete(listener) }
}

export interface UiOverlayLayer {
  id: string
  parentId: string | null
  /** 展开到浮层根节点上的属性 */
  layerProps: { [UI_OVERLAY_ID_ATTRIBUTE]: string }
}

/**
 * 声明一个浮层。`open` 为真时入栈（Escape 只关栈顶）。
 * 浮层内容必须用 `UiOverlayLayerProvider id={layer.id}` 包住，子浮层才能认出父层。
 */
export function useUiOverlayLayer(open: boolean, options?: { modal?: boolean }): UiOverlayLayer {
  const modal = options?.modal === true
  const parentId = useContext(UiOverlayParentContext)
  const id = `ui-overlay-${useId().replace(/:/g, '')}`

  useLayoutEffect(() => {
    overlayParents.set(id, parentId)
    return () => {
      overlayParents.delete(id)
    }
  }, [id, parentId])

  useLayoutEffect(() => {
    if (!open) return
    // 同一次提交里父子层一起打开时，子层的 layout effect 先执行、先入栈；父层必须插在已打开的后代层之下，
    // 否则父层成了栈顶，子层（如资产预览里的全屏查看器）永远收不到 Escape（5.6 第二批 B-43）
    const firstDescendant = openOverlayStack.findIndex((openId) => isAncestorOverlay(id, openId))
    if (firstDescendant >= 0) openOverlayStack.splice(firstDescendant, 0, id)
    else openOverlayStack.push(id)
    if (modal) {
      openModalOverlays.add(id)
      notifyModalOverlayListeners()
    }
    return () => {
      const index = openOverlayStack.lastIndexOf(id)
      if (index >= 0) openOverlayStack.splice(index, 1)
      if (openModalOverlays.delete(id)) notifyModalOverlayListeners()
    }
  }, [id, modal, open])

  return { id, parentId, layerProps: { [UI_OVERLAY_ID_ATTRIBUTE]: id } }
}

export function UiOverlayLayerProvider({ id, children }: { id: string; children?: ReactNode }): ReactElement {
  // 浮层内容不继承打开它的那一行表单标签（portal 仍在同一棵 React 树里，上下文会穿透过来，任务 5.8）
  return createElement(
    UiOverlayParentContext.Provider,
    { value: id },
    createElement(UiFormRowLabelContext.Provider, { value: null }, children),
  )
}

/** 当前所在的浮层（无则为 null）。 */
export function useUiOverlayParent(): string | null {
  return useContext(UiOverlayParentContext)
}

function isAncestorOverlay(ancestorId: string, overlayId: string): boolean {
  let current = overlayParents.get(overlayId) ?? null
  const visited = new Set<string>()
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true
    visited.add(current)
    current = overlayParents.get(current) ?? null
  }
  return false
}

/** 判断事件目标相对某个浮层的位置：自身、后代浮层，或外部。 */
export function resolveUiOverlayTarget(target: EventTarget | null, overlayId: string): UiOverlayTargetRelation {
  const element = elementOfEventTarget(target)
  if (!element) return 'outside'
  const layerElement = element.closest(`[${UI_OVERLAY_ID_ATTRIBUTE}]`)
  const layerId = layerElement?.getAttribute(UI_OVERLAY_ID_ATTRIBUTE) ?? null
  if (layerId === overlayId) {
    // 层内又嵌着一个独立树浮层的情况由下一条处理；这里点在自身内容上。
    return element.closest(`[${UI_OVERLAY_DETACHED_ATTRIBUTE}]`) ? 'descendant' : 'self'
  }
  if (layerId && isAncestorOverlay(overlayId, layerId)) return 'descendant'
  if (element.closest(`[${UI_OVERLAY_DETACHED_ATTRIBUTE}]`)) return 'descendant'
  return 'outside'
}

/** 该层是否是当前打开的最上层（Escape 只关最上层）。未登记打开时视为最上层。 */
export function isTopmostUiOverlay(overlayId: string): boolean {
  if (!openOverlayStack.includes(overlayId)) return true
  return openOverlayStack[openOverlayStack.length - 1] === overlayId
}

/** 是否有打开中的后代浮层（父层的 Escape / 点外关闭应让位）。 */
export function hasOpenUiOverlayDescendant(overlayId: string): boolean {
  return openOverlayStack.some((id) => id !== overlayId && isAncestorOverlay(overlayId, id))
}

/** 是否有打开中的模态后代层（祖先层在此期间不响应点外关闭）。 */
export function hasOpenModalUiOverlayDescendant(overlayId: string): boolean {
  return [...openModalOverlays].some((id) => isAncestorOverlay(overlayId, id))
}

/**
 * 订阅版：本层的模态后代（从浮层里打开的弹窗、查看器）是否打开中（任务 5.8）。
 * 浮层层级（popover 75）高于弹窗（modal 50），父浮层若照常显示会压在它打开的弹窗上；
 * 打开期间父浮层隐藏但保持挂载，弹窗关闭后原样回来。
 */
export function useHasOpenModalUiOverlayDescendant(overlayId: string): boolean {
  return useSyncExternalStore(subscribeModalOverlays, () => hasOpenModalUiOverlayDescendant(overlayId))
}

/** 是否有任何打开中的浮层。 */
export function hasAnyOpenUiOverlay(): boolean {
  return openOverlayStack.length > 0
}
