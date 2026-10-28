import { installKeyboardScroll } from './keyboardScroll'
import { ScrollCurve } from './scrollCurve'

/**
 * Smooth scrolling on page time. The browser animates smooth scrolls on the real clock, which a lockstep
 * replay does not follow (the scroll would take as long as the wall time those frames happen to cost).
 * Here every smooth scroll the browser would animate is moved frame by frame on the page's own animation
 * frames instead, with Chromium's curves (scrollCurve.ts):
 * - programmatic scrolls (scrollTo/scrollBy/scrollIntoView and scrollTop/scrollLeft assignments) that are
 *   smooth by argument or by CSS `scroll-behavior: smooth`: the target is found with an instant scroll,
 *   and the scroll moves there ease-in-out over min(sqrt(distance px), 12) / 60 seconds;
 * - keyboard scrolls (keyboardScroll.ts).
 * Wheel scrolls need nothing: the engine sends wheel input as precise pixel deltas, which Chromium
 * applies at once without an animation.
 */

type Scroller = Element
type Point = [number, number]
type ScrollFn = (this: Element, ...args: unknown[]) => void
interface Move { from: Point; to: Point }
interface Running { curve: ScrollCurve; start: number }

export function smoothScrollDurationMs(distancePx: number): number { return Math.min(Math.sqrt(Math.abs(distancePx)), 12) / 60 * 1000 }

/** Scroll animations on page time, one per scroller; a new one on the same scroller replaces the old. */
export class ScrollAnimator {
  private readonly running = new Map<Scroller, Running>()
  constructor(private readonly place: (el: Scroller, to: Point) => void) {}

  run(el: Scroller, curve: ScrollCurve): void {
    const animation = { curve, start: performance.now() }
    this.running.set(el, animation)
    const step = (): void => {
      if (this.running.get(el) !== animation) return
      const t = performance.now() - animation.start
      this.place(el, animation.curve.value(t))
      if (t < animation.curve.duration) requestAnimationFrame(step)
      else this.running.delete(el)
    }
    requestAnimationFrame(step)
  }

  current(el: Scroller): Running | undefined { return this.running.get(el) }

  /** An instant scroll by the page stops the animation, as it does in the browser. */
  cancel(el: Scroller): void { this.running.delete(el) }
}

export function installSmoothScroll(): void {
  const proto = Element.prototype
  const nativeIntoView = proto.scrollIntoView
  const nativeTo = proto.scrollTo as unknown as ScrollFn
  const nativeBy = proto.scrollBy as unknown as ScrollFn
  const nativeWindowTo = window.scrollTo.bind(window) as (...args: unknown[]) => void
  const nativeWindowBy = window.scrollBy.bind(window) as (...args: unknown[]) => void
  const root = (): Element => document.scrollingElement ?? document.documentElement
  const offsets = (el: Scroller): Point => [el.scrollLeft, el.scrollTop]
  const place = (el: Scroller, [left, top]: Point): void => nativeTo.call(el, { left, top, behavior: 'instant' as ScrollBehavior })
  const animator = new ScrollAnimator(place)

  const cssSmooth = (el: Scroller): boolean => getComputedStyle(el).scrollBehavior === 'smooth'
  const smooth = (el: Scroller, behavior: unknown): boolean => {
    if (behavior === 'smooth') return true
    if (behavior !== undefined && behavior !== 'auto') return false
    return cssSmooth(el)
  }

  const animate = (moves: Map<Scroller, Move>): void => {
    let distance = 0
    for (const { from, to } of moves.values()) distance = Math.max(distance, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))
    if (!distance) return
    const duration = smoothScrollDurationMs(distance)
    for (const [el, move] of moves) {
      place(el, move.from)
      animator.run(el, new ScrollCurve(move.from, move.to, 'programmatic', duration))
    }
  }

  /**
   * Runs `scroll` instantly to learn where every scroll container ends up; the ones `animated` accepts
   * go back and animate there, the others stay where the instant scroll put them.
   */
  const capture = (candidates: Scroller[], scroll: () => void, animated: (el: Scroller) => boolean = () => true): void => {
    const before = new Map(candidates.map(el => [el, offsets(el)] as const))
    scroll()
    const moves = new Map<Scroller, Move>()
    for (const [el, from] of before) {
      const to = offsets(el)
      if (to[0] === from[0] && to[1] === from[1]) continue
      if (animated(el)) moves.set(el, { from, to })
      else animator.cancel(el)
    }
    for (const [el, move] of moves) place(el, move.from)
    animate(moves)
  }

  /** Every box that could scroll `el` into view, across shadow boundaries up to the root scroller. */
  const ancestors = (el: Element): Scroller[] => {
    const out: Scroller[] = []
    const up = (node: Element): Element | null => node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)
    for (let node = up(el); node; node = up(node)) out.push(node)
    if (!out.includes(root())) out.push(root())
    return out
  }

  proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    const options = typeof arg === 'object' && arg ? arg : typeof arg === 'boolean' ? { block: arg ? 'start' : 'end', inline: 'nearest' } as ScrollIntoViewOptions : {}
    const behavior = options.behavior
    if (behavior !== undefined && behavior !== 'auto' && behavior !== 'smooth') return nativeIntoView.call(this, arg)
    // `auto` is smooth only for the scroll containers whose CSS says so, each on its own.
    capture(ancestors(this), () => nativeIntoView.call(this, { ...options, behavior: 'instant' as ScrollBehavior }), behavior === 'smooth' ? undefined : cssSmooth)
  }
  /** scrollTo(options) or scrollTo(x, y), as options. */
  const asOptions = (args: unknown[]): ScrollToOptions => typeof args[0] === 'object' && args[0] ? args[0] as ScrollToOptions : { left: Number(args[0]), top: Number(args[1]) }
  const override = (native: typeof nativeTo) => function (this: Element, ...args: unknown[]) {
    const options = asOptions(args)
    if (!smooth(this, options.behavior)) { animator.cancel(this); return native.apply(this, args) }
    capture([this], () => native.call(this, { ...options, behavior: 'instant' as ScrollBehavior }))
  }
  proto.scrollTo = override(nativeTo) as typeof proto.scrollTo
  proto.scroll = proto.scrollTo
  proto.scrollBy = override(nativeBy) as typeof proto.scrollBy
  const windowOverride = (native: typeof nativeWindowTo) => (...args: unknown[]) => {
    const options = asOptions(args)
    if (!smooth(root(), options.behavior)) { animator.cancel(root()); return native(...args) }
    capture([root()], () => native({ ...options, behavior: 'instant' as ScrollBehavior }))
  }
  window.scrollTo = windowOverride(nativeWindowTo) as typeof window.scrollTo
  window.scroll = window.scrollTo
  window.scrollBy = windowOverride(nativeWindowBy) as typeof window.scrollBy

  // Assigning scrollTop/scrollLeft is a scroll with behavior auto: smooth when the CSS says so.
  for (const [name, axis] of [['scrollTop', 'top'], ['scrollLeft', 'left']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (!descriptor?.get || !descriptor.set) continue
    const nativeSet = descriptor.set
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(this: Element, value: unknown) {
        if (!cssSmooth(this)) { animator.cancel(this); nativeSet.call(this, value); return }
        capture([this], () => nativeTo.call(this, { [axis]: Number(value) || 0, behavior: 'instant' as ScrollBehavior }))
      },
    })
  }

  installKeyboardScroll(animator)
}
