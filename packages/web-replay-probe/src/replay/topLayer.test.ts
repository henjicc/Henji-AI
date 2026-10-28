/** @vitest-environment jsdom */
import { beforeAll, expect, it } from 'vitest'

// jsdom has no top layer: a list stands in for it, the last element shown drawn on top, like the browser's.
const layer: Element[] = []
const toggled = (el: Element, type: string, newState: string): void => { el.dispatchEvent(Object.assign(new Event(type), { newState })) }
const proto = HTMLElement.prototype as unknown as Record<string, unknown>
const seenByPage: Array<EventTarget | null> = []
beforeAll(async () => {
  proto.showPopover = function (this: Element) {
    if (layer.includes(this)) throw new DOMException('already showing', 'InvalidStateError')
    toggled(this, 'beforetoggle', 'open')
    layer.push(this)
    toggled(this, 'toggle', 'open')
  }
  proto.hidePopover = function (this: Element) {
    const at = layer.indexOf(this)
    if (at < 0) return
    layer.splice(at, 1)
    toggled(this, 'toggle', 'closed')
  }
  proto.togglePopover = function (this: HTMLElement) { if (layer.includes(this)) (this as unknown as { hidePopover(): void }).hidePopover(); else (this as unknown as { showPopover(): void }).showPopover(); return layer.includes(this) }
  ;(HTMLDialogElement.prototype as unknown as Record<string, unknown>).showModal = function (this: Element) { layer.push(this) }
  const matches = Element.prototype.matches
  Element.prototype.matches = function (this: Element, selector: string) {
    return [':popover-open', ':modal', ':fullscreen'].includes(selector) ? layer.includes(this) : matches.call(this, selector)
  }
  Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
  // The runtime installs the hooks before any page script; the page's listeners come after.
  const { installTopLayer } = await import('./topLayer')
  installTopLayer()
  for (const type of ['beforetoggle', 'toggle']) addEventListener(type, event => seenByPage.push(event.target), { capture: true })
})

const overlays = (): HTMLElement[] => [...document.documentElement.children].filter((el): el is HTMLElement => el.id.startsWith('__henji_replay_overlay_'))

it('页面没有顶层元素时帧标记与鼠标层是普通定位；页面打开弹层、模态对话框后升到顶层最上面，帧标记压在鼠标层之上，全部关掉后退回', async () => {
  const { installCursorOverlay } = await import('./cursorOverlay')
  const { installCaptureToken } = await import('./captureToken')
  installCursorOverlay()
  const token = installCaptureToken()
  token.show(0)
  const [cursor, square] = overlays()
  expect(layer).toEqual([])
  expect(cursor.hasAttribute('popover')).toBe(false)

  // Script opens a modal dialog and a popover.
  const dialog = document.body.appendChild(document.createElement('dialog'))
  ;(dialog as unknown as { showModal(): void }).showModal()
  expect(layer).toEqual([dialog, cursor, square])
  const menu = document.body.appendChild(document.createElement('div'))
  ;(menu as unknown as { showPopover(): void }).showPopover()
  expect(layer.slice(-2)).toEqual([cursor, square])
  // Our own backdrops never paint the page's ::backdrop scrim.
  const sheet = (document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets[0]
  expect([...sheet.cssRules].map(rule => rule.cssText).join(' ')).toContain(`#${square.id}::backdrop`)

  // A page replacing its adopted sheets wholesale drops ours; the next frame puts it back.
  const adopted = document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }
  const pageSheet = new CSSStyleSheet()
  adopted.adoptedStyleSheets = [pageSheet]
  token.show(5)
  expect(adopted.adoptedStyleSheets).toEqual([pageSheet, sheet])

  // A page closing "every open popover" leaves ours alone.
  for (const host of [cursor, square]) (host as unknown as { hidePopover(): void }).hidePopover()
  expect(layer.slice(-2)).toEqual([cursor, square])

  // Opened without script (popovertarget): announced first, shown afterwards; the next frame's token goes back on top.
  const tip = document.body.appendChild(document.createElement('div'))
  toggled(tip, 'beforetoggle', 'open')
  layer.push(tip)
  token.show(1)
  expect(layer.slice(-2)).toEqual([cursor, square])
  expect(layer.filter(el => el === square)).toHaveLength(1)

  // Closing: the overlays stay up while anything of the page is open, and leave the top layer after the last one.
  layer.splice(layer.indexOf(dialog), 1)
  dialog.dispatchEvent(new Event('close'))
  ;(menu as unknown as { hidePopover(): void }).hidePopover()
  expect(layer.slice(-2)).toEqual([cursor, square])
  layer.splice(layer.indexOf(tip), 1)
  toggled(tip, 'toggle', 'closed')
  expect(layer).toEqual([])
  expect(square.hasAttribute('popover')).toBe(false)

  // The page never heard our overlays' own toggle events.
  expect(seenByPage.filter(target => target === cursor || target === square)).toEqual([])
  expect(seenByPage).toContain(menu)
})
