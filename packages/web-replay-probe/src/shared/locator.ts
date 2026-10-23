import type { ElementInfo, Locator, Rect } from '../protocol'

import { DEFAULT_LOCATOR_OPTIONS, type LocatorOptions } from './locatorOptions'

export { DEFAULT_LOCATOR_OPTIONS, type LocatorOptions }

const INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role],[tabindex],[contenteditable=""],[contenteditable="true"]'

function cssPath(element: Element): string {
  const parts: string[] = []
  let node: Element | null = element
  while (node && node !== document.body && node !== document.documentElement) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    const index = Array.prototype.indexOf.call(parent.children, node) + 1
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`)
    node = parent
  }
  return parts.join('>')
}

function accessibleName(element: Element): string | undefined {
  const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? (element instanceof HTMLInputElement ? element.placeholder : null)
  const text = label ?? element.textContent ?? ''
  const name = text.replace(/\s+/g, ' ').trim().slice(0, 60)
  return name || undefined
}

function roleOf(element: Element): string | undefined {
  return element.getAttribute('role') ?? (element.matches('button') ? 'button' : element.matches('a[href]') ? 'link' : element.matches('input,textarea') ? 'textbox' : undefined)
}

function anchorIdOf(element: Element): string | undefined {
  const anchor = element.closest('[id]')
  return anchor?.id || undefined
}

/** The element that best represents what the user acted on: explicit id, action, then interactive ancestor. */
export function representativeElement(target: Element, options: LocatorOptions = DEFAULT_LOCATOR_OPTIONS): Element {
  return target.closest(`[${options.idAttribute}]`)
    ?? options.actionAttributes.map(a => target.closest(`[${a}]`)).find(Boolean)
    ?? target.closest(INTERACTIVE)
    ?? target
}

export function describeLocator(element: Element, options: LocatorOptions = DEFAULT_LOCATOR_OPTIONS): Locator {
  const locator: Locator = { tag: element.tagName.toLowerCase(), path: cssPath(element) }
  const replayId = element.getAttribute(options.idAttribute)
  if (replayId) locator.replayId = replayId
  for (const attribute of options.actionAttributes) {
    const name = element.getAttribute(attribute)
    if (name) { locator.act = { name, anchor: anchorIdOf(element.parentElement ?? element) }; break }
  }
  const role = roleOf(element)
  if (role) locator.role = role
  const name = accessibleName(element)
  if (name) locator.name = name
  return locator
}

function rectOf(element: Element): Rect {
  const r = element.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

export function describeElementAt(target: EventTarget | null, x: number, y: number, options: LocatorOptions = DEFAULT_LOCATOR_OPTIONS): ElementInfo | undefined {
  if (!(target instanceof Element)) return undefined
  const element = representativeElement(target, options)
  const rect = rectOf(element)
  const offset: [number, number] = [rect.width > 0 ? clamp01((x - rect.x) / rect.width) : 0.5, rect.height > 0 ? clamp01((y - rect.y) / rect.height) : 0.5]
  return { locator: describeLocator(element, options), rect, offset }
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)) }

function visible(element: Element): boolean {
  const r = element.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** Finds the element a locator names in the current page, strongest identity first. */
export function resolveLocator(locator: Locator, options: LocatorOptions = DEFAULT_LOCATOR_OPTIONS): Element | null {
  const escape = (v: string): string => CSS.escape(v)
  if (locator.replayId) {
    const found = [...document.querySelectorAll(`[${options.idAttribute}="${escape(locator.replayId)}"]`)].find(visible)
    if (found) return found
  }
  if (locator.act) {
    const candidates = options.actionAttributes.flatMap(a => [...document.querySelectorAll(`[${a}="${escape(locator.act!.name)}"]`)]).filter(visible)
    const anchored = locator.act.anchor ? candidates.filter(c => anchorIdOf(c.parentElement ?? c) === locator.act!.anchor) : candidates
    const pool = anchored.length ? anchored : candidates
    const named = pool.filter(c => !locator.name || accessibleName(c) === locator.name)
    const pick = (named.length ? named : pool)
    if (pick.length === 1 || (pick.length > 1 && locator.act.anchor && anchored.length)) return pick[0]
  }
  if (locator.path) {
    try {
      const found = document.body.querySelector(`:scope>${locator.path}`)
      if (found && found.tagName.toLowerCase() === locator.tag) return found
    } catch { /* stale path */ }
  }
  return null
}

/** Viewport point for an element and an in-element offset. */
export function pointIn(element: Element, offset: [number, number]): { x: number; y: number; rect: Rect } {
  const rect = rectOf(element)
  return { x: rect.x + rect.width * offset[0], y: rect.y + rect.height * offset[1], rect }
}
