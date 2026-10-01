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

/** 节点所在文档；未挂载或缺省时回落到当前主文档。 */
export function ownerDocumentOf(node: Node | null | undefined): Document {
  if (!node) return document
  return nodeType(node) === 9 ? node as Document : node.ownerDocument ?? document
}

/** 节点所在窗口；子窗口已关闭（defaultView 为 null）时回落到当前主窗口。 */
export function ownerWindowOf(node: Node | null | undefined): Window & typeof globalThis {
  return ownerDocumentOf(node).defaultView ?? window
}
