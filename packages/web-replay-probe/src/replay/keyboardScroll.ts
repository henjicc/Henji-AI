import { ScrollCurve } from './scrollCurve'
import type { ScrollAnimator } from './smoothScroll'

/**
 * Keyboard scrolling on page time. Chromium animates arrow, PageUp/PageDown, Home/End and space scrolls
 * on the real clock (its ScrollAnimator: 150 ms ease-in-out per key, retargeted while keys repeat). Here
 * a key the page left alone becomes the same scroll animated on page time, and the browser's own scroll
 * is cancelled with preventDefault. What a key scrolls and how far follows Blink (keyboard_event_manager.cc,
 * scroll_manager.cc, scrollable_area.cc, cc/input/scroll_utils.cc): the focused element, else the last
 * pressed node, bubbling up to the first box that can still scroll that way (overscroll-behavior other
 * than auto stops the bubbling); a line is 40 px, a page max(87.5 %, length - 40 device px), Home/End
 * the whole range. Keys the browser hands to form controls, editable text or media controls stay
 * native, and so do scrollers with scroll snapping (picking the snap target is the browser's job).
 * Focus inside a closed shadow root or a custom element stays native too: what it holds is not visible.
 * Only the behaviour is reproduced (no Chromium code is copied); the constants are Chromium's.
 *
 * The page's handlers decide first: the check runs in a listener added to window during the capture
 * phase, which places it after every bubble-phase listener the page has on window.
 */

type Point = [number, number]
type Granularity = 'line' | 'page' | 'document'
interface KeyScroll { axis: 0 | 1; sign: 1 | -1; granularity: Granularity }

const LINE_PX = 40
const PAGE_FRACTION = 0.875
const PAGE_OVERLAP_DEVICE_PX = 40
const OWN_KEYS = 'input, textarea, select, video, audio, iframe, embed, object'
const OWN_SPACE = 'button, summary'
/** Elements that can hold focus themselves (anything else holding it has the focus inside its shadow root). */
const SELF_FOCUSABLE = 'a[href], area[href], button, input, select, textarea, summary, iframe, embed, object, video, audio, [contenteditable], [tabindex]'
const SCROLLING = new Set(['auto', 'scroll', 'overlay'])

function keyScroll(event: KeyboardEvent): KeyScroll | null {
  if (event.isComposing || event.metaKey || event.altKey) return null
  if (event.type === 'keypress') return event.key === ' ' && !event.ctrlKey ? { axis: 1, sign: event.shiftKey ? -1 : 1, granularity: 'page' } : null
  if (event.shiftKey || (event.ctrlKey && event.key !== 'Home' && event.key !== 'End')) return null
  switch (event.key) {
    case 'ArrowUp': return { axis: 1, sign: -1, granularity: 'line' }
    case 'ArrowDown': return { axis: 1, sign: 1, granularity: 'line' }
    case 'ArrowLeft': return { axis: 0, sign: -1, granularity: 'line' }
    case 'ArrowRight': return { axis: 0, sign: 1, granularity: 'line' }
    case 'PageUp': return { axis: 1, sign: -1, granularity: 'page' }
    case 'PageDown': return { axis: 1, sign: 1, granularity: 'page' }
    case 'Home': return { axis: 1, sign: -1, granularity: 'document' }
    case 'End': return { axis: 1, sign: 1, granularity: 'document' }
    default: return null
  }
}

const flatParent = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null)

export function installKeyboardScroll(animator: ScrollAnimator, trusted: (event: Event) => boolean = event => event.isTrusted): void {
  const root = (): Element => document.scrollingElement ?? document.documentElement
  const closedHosts = new WeakSet<Element>()
  const attachShadow = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const shadow = attachShadow.call(this, init)
    if (init.mode === 'closed') closedHosts.add(this)
    return shadow
  }
  /** The focused element, followed down through open shadow roots; a closed one stops at its host. */
  const deepFocus = (): Element | null => {
    let el = document.activeElement
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
    return el
  }
  /**
   * Focus we cannot see into: a host whose closed shadow root we saw attached, a custom element without
   * an open root, or an element that cannot take focus itself yet holds it, so the focus is inside a
   * shadow root we could not follow. The last case covers declarative `<template shadowrootmode="closed">`,
   * which never calls attachShadow; it also leaves a few focused non-inputs (a focused modal <dialog>)
   * to the browser, which is the safe side.
   */
  const hiddenFocus = (el: Element): boolean => {
    if (el.shadowRoot) return false
    if (closedHosts.has(el) || el.localName.includes('-')) return true
    return el !== document.body && el !== document.documentElement && !el.matches(SELF_FOCUSABLE)
  }
  let pressed: Element | null = null
  addEventListener('mousedown', event => { const node = event.composedPath()[0]; pressed = node instanceof Element ? node : null }, { capture: true, passive: true })

  const range = (el: Element, axis: 0 | 1): number => Math.max(0, axis ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth)
  const scrolls = (el: Element, axis: 0 | 1): boolean => {
    if (el === root()) {
      // The viewport takes its overflow from <html>, or from <body> when <html> leaves it visible.
      const html = getComputedStyle(document.documentElement)
      const style = (axis ? html.overflowY : html.overflowX) === 'visible' && document.body ? getComputedStyle(document.body) : html
      const overflow = axis ? style.overflowY : style.overflowX
      return overflow !== 'hidden' && overflow !== 'clip' && range(el, axis) > 0
    }
    const style = getComputedStyle(el)
    return SCROLLING.has(axis ? style.overflowY : style.overflowX) && range(el, axis) > 0
  }
  const desired = (el: Element): Point => {
    const running = animator.current(el)
    return running && running.curve.kind === 'keyboard' ? [...running.curve.target] : [el.scrollLeft, el.scrollTop]
  }
  const step = (el: Element, { axis, granularity }: KeyScroll): number => {
    if (granularity === 'line') return LINE_PX
    if (granularity === 'document') return range(el, axis)
    const length = axis ? el.clientHeight : el.clientWidth
    return Math.max(1, Math.floor(length * PAGE_FRACTION), length - PAGE_OVERLAP_DEVICE_PX / (devicePixelRatio || 1))
  }

  /** The scroller this key moves and where to; null when nothing moves or the browser must decide. */
  const plan = (start: Element, key: KeyScroll): { el: Element; to: Point } | 'native' | null => {
    const chain: Element[] = []
    let bubbles = true
    for (let el: Element | null = start; el && bubbles; el = flatParent(el)) {
      if (el === document.documentElement || el === document.body || !scrolls(el, key.axis)) continue
      chain.push(el)
      const style = getComputedStyle(el)
      const overscroll = key.axis ? style.overscrollBehaviorY : style.overscrollBehaviorX
      if (overscroll && overscroll !== 'auto') bubbles = false
    }
    if (bubbles && scrolls(root(), key.axis)) chain.push(root())
    for (const el of chain) {
      const snap = getComputedStyle(el).scrollSnapType
      if (snap && snap !== 'none') return 'native'
      const from = desired(el)
      const to: Point = [...from]
      to[key.axis] = Math.min(range(el, key.axis), Math.max(0, from[key.axis] + key.sign * step(el, key)))
      if (to[key.axis] !== from[key.axis]) return { el, to }
    }
    return null
  }

  const decide = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || !trusted(event)) return
    const key = keyScroll(event)
    if (!key) return
    const target = deepFocus() ?? event.composedPath()[0]
    if (!(target instanceof Element) || document.designMode === 'on') return
    if (hiddenFocus(target)) return
    if ((target as HTMLElement).isContentEditable || target.closest(OWN_KEYS) || (event.type === 'keypress' && target.closest(OWN_SPACE))) return
    const focused = target !== document.body && target !== document.documentElement
    const start = focused ? target : pressed?.isConnected ? pressed : root()
    const move = plan(start, key)
    if (!move || move === 'native') return
    event.preventDefault()
    const running = animator.current(move.el)
    if (running && running.curve.kind === 'keyboard') running.curve.updateTarget(performance.now() - running.start, move.to)
    else animator.run(move.el, new ScrollCurve([move.el.scrollLeft, move.el.scrollTop], move.to, 'keyboard'))
  }

  for (const type of ['keydown', 'keypress'] as const) {
    let pending: ((event: Event) => void) | null = null
    addEventListener(type, event => {
      // A listener left over from an event whose propagation the page stopped before it reached window again.
      if (pending) removeEventListener(type, pending)
      const last = (seen: Event): void => {
        removeEventListener(type, last)
        pending = null
        if (seen === event) decide(seen as KeyboardEvent)
      }
      pending = last
      addEventListener(type, last)
    }, { capture: true })
  }
}
