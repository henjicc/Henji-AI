/**
 * 跨 realm 的 DOM 判定。剪辑系统浮窗由主窗口 React portal 渲染进同源子窗口，
 * 子窗口里的节点属于子窗口自己的全局对象：主窗口的 `instanceof Element/HTMLElement/Node`
 * 对它们恒为 false。需要判定事件目标或决定挂载/监听位置时统一用这里的函数。
 */

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

function nodeType(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const type = (value as { nodeType?: unknown }).nodeType
  return typeof type === 'number' ? type : undefined
}

export function isDomNode(value: unknown): value is Node {
  return nodeType(value) !== undefined
}

export function isElementNode(value: unknown): value is Element {
  return nodeType(value) === 1
}

export function isHtmlElementNode(value: unknown): value is HTMLElement {
  return isElementNode(value) && value.namespaceURI === XHTML_NAMESPACE
}

/** 事件目标是文本节点时取其父元素，供 `closest` 判定使用。 */
export function elementOfEventTarget(value: unknown): Element | null {
  if (isElementNode(value)) return value
  return isDomNode(value) && isElementNode(value.parentElement) ? value.parentElement : null
}

/**
 * React 合成事件沿组件树冒泡，会穿过 portal：从这里打开、挂到 body 的弹窗与菜单里的点击也会到达这里的处理函数。
 * 只该处理 DOM 上真正落在自身里的事件（按下即捕获指针、弹右键菜单这类）时，用它排除 portal 里冒上来的事件。
 */
export function isEventInsideCurrentTarget(event: { currentTarget: unknown; target: unknown }): boolean {
  return isDomNode(event.currentTarget) && isDomNode(event.target) && event.currentTarget.contains(event.target)
}

/** 节点所在文档；未挂载或缺省时回落到当前主文档。 */
export function ownerDocumentOf(node: Node | null | undefined): Document {
  if (!node) return document
  return nodeType(node) === 9 ? node as Document : node.ownerDocument ?? document
}

/** 节点所在窗口；子窗口已关闭（defaultView 为 null）时回落到当前主窗口。 */
export function ownerWindowOf(node: Node | null | undefined): Window & typeof globalThis {
  return ownerDocumentOf(node).defaultView ?? window
}
