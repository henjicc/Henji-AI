/**
 * Smooth programmatic scrolling on page time. The browser animates `behavior: 'smooth'` on the real
 * clock, which a lockstep replay does not follow (the scroll would take as long as the wall time those
 * frames happen to cost). Here the target is found with an instant scroll, and the scroll then moves
 * there frame by frame on the page's own animation frames, with Chromium's curve for programmatic
 * smooth scrolls: ease-in-out, min(sqrt(distance px), 12) / 60 seconds.
 */

type Scroller = Element
type ScrollFn = (this: Element, ...args: unknown[]) => void
interface Move { from: [number, number]; to: [number, number] }

const EASE = (t: number): number => {
  // cubic-bezier(0.42, 0, 0.58, 1), solved for x by bisection (monotonic).
  const bezier = (p1: number, p2: number, s: number): number => 3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3
  let lo = 0, hi = 1
  for (let k = 0; k < 30; k += 1) { const mid = (lo + hi) / 2; if (bezier(0.42, 0.58, mid) < t) lo = mid; else hi = mid }
  const s = (lo + hi) / 2
  return bezier(0, 1, s)
}

export function smoothScrollDurationMs(distancePx: number): number { return Math.min(Math.sqrt(Math.abs(distancePx)), 12) / 60 * 1000 }

export function installSmoothScroll(): void {
  const proto = Element.prototype
  const nativeIntoView = proto.scrollIntoView
  const nativeTo = proto.scrollTo as unknown as ScrollFn
  const nativeBy = proto.scrollBy as unknown as ScrollFn
  const nativeWindowTo = window.scrollTo.bind(window) as (...args: unknown[]) => void
  const nativeWindowBy = window.scrollBy.bind(window) as (...args: unknown[]) => void
  const root = (): Element => document.scrollingElement ?? document.documentElement
  const offsets = (el: Scroller): [number, number] => [el.scrollLeft, el.scrollTop]
  const place = (el: Scroller, [left, top]: [number, number]): void => nativeTo.call(el, { left, top, behavior: 'instant' as ScrollBehavior })
  const running = new Map<Scroller, number>()

  const smooth = (el: Scroller | null, behavior: unknown): boolean => {
    if (behavior === 'smooth') return true
    if (behavior !== undefined && behavior !== 'auto') return false
    return !!el && getComputedStyle(el).scrollBehavior === 'smooth'
  }

  const animate = (moves: Map<Scroller, Move>): void => {
    let distance = 0
    for (const { from, to } of moves.values()) distance = Math.max(distance, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))
    if (!distance) return
    const duration = smoothScrollDurationMs(distance)
    const start = performance.now()
    for (const [el, move] of moves) {
      const id = (running.get(el) ?? 0) + 1
      running.set(el, id)
      place(el, move.from)
      const step = (): void => {
        if (running.get(el) !== id) return
        const t = Math.min(1, (performance.now() - start) / duration)
        const k = EASE(t)
        place(el, [move.from[0] + (move.to[0] - move.from[0]) * k, move.from[1] + (move.to[1] - move.from[1]) * k])
        if (t < 1) requestAnimationFrame(step)
        else running.delete(el)
      }
      requestAnimationFrame(step)
    }
  }

  /** Runs `scroll` instantly to learn where every scroll container ends up, puts them back and animates there. */
  const capture = (candidates: Scroller[], scroll: () => void): void => {
    const before = new Map(candidates.map(el => [el, offsets(el)] as const))
    scroll()
    const moves = new Map<Scroller, Move>()
    for (const [el, from] of before) {
      const to = offsets(el)
      if (to[0] !== from[0] || to[1] !== from[1]) moves.set(el, { from, to })
    }
    for (const [el, move] of moves) place(el, move.from)
    animate(moves)
  }

  const ancestors = (el: Element): Scroller[] => {
    const out: Scroller[] = []
    for (let node: Element | null = el.parentElement; node; node = node.parentElement) out.push(node)
    if (!out.includes(root())) out.push(root())
    return out
  }

  proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    const options = typeof arg === 'object' && arg ? arg : undefined
    // Only an explicit smooth request is taken over; `auto` under CSS scroll-behavior: smooth stays native.
    if (!options || options.behavior !== 'smooth') return nativeIntoView.call(this, arg)
    capture(ancestors(this), () => nativeIntoView.call(this, { ...options, behavior: 'instant' as ScrollBehavior }))
  }
  /** scrollTo(options) or scrollTo(x, y), as options. */
  const asOptions = (args: unknown[]): ScrollToOptions => typeof args[0] === 'object' && args[0] ? args[0] as ScrollToOptions : { left: Number(args[0]), top: Number(args[1]) }
  const override = (native: typeof nativeTo) => function (this: Element, ...args: unknown[]) {
    const options = asOptions(args)
    if (!smooth(this, options.behavior)) return native.apply(this, args)
    capture([this], () => native.call(this, { ...options, behavior: 'instant' as ScrollBehavior }))
  }
  proto.scrollTo = override(nativeTo) as typeof proto.scrollTo
  proto.scroll = proto.scrollTo
  proto.scrollBy = override(nativeBy) as typeof proto.scrollBy
  const windowOverride = (native: typeof nativeWindowTo) => (...args: unknown[]) => {
    const options = asOptions(args)
    if (!smooth(root(), options.behavior)) return native(...args)
    capture([root()], () => native({ ...options, behavior: 'instant' as ScrollBehavior }))
  }
  window.scrollTo = windowOverride(nativeWindowTo) as typeof window.scrollTo
  window.scroll = window.scrollTo
  window.scrollBy = windowOverride(nativeWindowBy) as typeof window.scrollBy
}
